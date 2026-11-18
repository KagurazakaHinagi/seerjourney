'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { createAPI, BODY_LIMIT, SESSION_SECONDS } = require('../../src/server/campaign.cjs');
const { createRedisStore } = require('../../src/server/storage.cjs');

const PASSPHRASE = 'test-only-long-passphrase';
async function setup(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seerjourney-api-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const env = { CAMPAIGN_STORE: 'file', CAMPAIGN_DATA_FILE: path.join(directory, 'campaign.json'),
    CAMPAIGN_PASSPHRASES: JSON.stringify([PASSPHRASE, 'another-test-passphrase']), SESSION_SECRET: crypto.randomBytes(32).toString('hex'), ...overrides };
  let timestamp = Date.now();
  const api = createAPI({ env, now: () => timestamp });
  return { api, env, advance: milliseconds => { timestamp += milliseconds; } };
}
async function request(handler, { method = 'GET', body, cookie, origin = 'http://localhost:8780', headers = {}, stream = false } = {}) {
  const raw = typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(raw ? [raw] : []);
  req.method = method;
  req.headers = { host: 'localhost:8780', ...(origin === null ? {} : { origin }), ...(cookie ? { cookie } : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers };
  req.socket = { remoteAddress: '127.0.0.1' };
  if (!stream && body !== undefined) req.body = body;
  const response = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(text) { this.body = JSON.parse(text); } };
  await handler(req, response);
  return response;
}
async function login(api, passphrase = PASSPHRASE) {
  const result = await request(api.auth, { method: 'POST', body: { passphrase } });
  assert.equal(result.statusCode, 200);
  return result.headers['set-cookie'].split(';')[0];
}
const get = api => request(api.campaign);
const put = (api, cookie, campaign) => request(api.campaign, { method: 'PUT', cookie, body: { revision: campaign.revision, session: campaign.session } });

test('guests read one persistent fresh demo campaign without secrets', async t => {
  const { api, env } = await setup(t);
  const first = await get(api), second = await get(createAPI({ env }));
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.revision, 0);
  assert.equal(first.body.session.mapId, 'demo-map');
  assert.equal(first.body.session.name, 'Demo expedition');
  assert.deepEqual(first.body.session.revealed, []);
  assert.deepEqual(first.body.session.tripDays, []);
  assert.equal(first.body.session.id, second.body.session.id);
  assert.match(first.headers['cache-control'], /no-store/);
  assert.ok(!JSON.stringify(first.body).includes(env.SESSION_SECRET));
  assert.deepEqual((await request(api.auth)).body, { editable: false });
});

test('a stored campaign from another map is rejected without replacing its progress', async t => {
  const { api, env } = await setup(t);
  const cookie = await login(api);
  const original = (await get(api)).body;
  const disk = JSON.parse(await fs.readFile(env.CAMPAIGN_DATA_FILE, 'utf8'));
  disk.campaign.session.mapId = 'another-map';
  disk.campaign.session.name = 'Preserve this campaign';
  await fs.writeFile(env.CAMPAIGN_DATA_FILE, JSON.stringify(disk));
  for (const result of [await get(api), await put(api, cookie, original)]) {
    assert.equal(result.statusCode, 409);
    assert.equal(result.body.error, 'map_mismatch');
  }
  const after = JSON.parse(await fs.readFile(env.CAMPAIGN_DATA_FILE, 'utf8'));
  assert.deepEqual(after.campaign, disk.campaign);
});

test('guest cannot change progress', async t => {
  const { api } = await setup(t);
  const campaign = (await get(api)).body;
  campaign.session.name = 'unauthorized edit';
  assert.equal((await put(api, null, campaign)).statusCode, 401);
  assert.equal((await get(api)).body.revision, 0);
});

test('allowed passphrases create an HttpOnly SameSite session and logout clears it', async t => {
  const { api } = await setup(t);
  const result = await request(api.auth, { method: 'POST', body: { passphrase: PASSPHRASE } });
  assert.equal(result.body.editable, true);
  assert.match(result.headers['set-cookie'], /HttpOnly/);
  assert.match(result.headers['set-cookie'], /SameSite=Strict/);
  assert.ok(!result.headers['set-cookie'].includes(PASSPHRASE));
  const cookie = result.headers['set-cookie'].split(';')[0];
  assert.equal((await request(api.auth, { cookie })).body.editable, true);
  const logout = await request(api.auth, { method: 'DELETE', cookie });
  assert.equal(logout.body.editable, false);
  assert.match(logout.headers['set-cookie'], /Max-Age=0/);
});

test('production cookies use Secure and auth works with Vercel-origin HTTPS', async () => {
  const api = createAPI({ env: { VERCEL: '1', SESSION_SECRET: 's'.repeat(64), CAMPAIGN_PASSPHRASES: JSON.stringify([PASSPHRASE]) },
    store: { rateLimit: async () => ({ allowed: true }) } });
  const result = await request(api.auth, { method: 'POST', origin: 'https://campaign.example', headers: { host: 'campaign.example' }, body: { passphrase: PASSPHRASE } });
  assert.equal(result.statusCode, 200);
  assert.match(result.headers['set-cookie'], /; Secure/);
});

test('wrong, malformed and tampered credentials are refused', async t => {
  const { api } = await setup(t);
  for (const passphrase of ['wrong', 123, null, 'x'.repeat(513)]) {
    assert.equal((await request(api.auth, { method: 'POST', body: { passphrase } })).statusCode, 401);
  }
  const cookie = await login(api);
  const [name, token] = cookie.split('=');
  const [payload, signature] = token.split('.');
  const edited = Buffer.from(JSON.stringify({ v: 1, exp: Date.now() + 999999999, credential: '0'.repeat(64) })).toString('base64url');
  for (const forged of [`${name}=${edited}.${signature}`, `${name}=${payload}.bad`, `${cookie}; ${cookie}`, `${name}=nonsense`]) {
    assert.equal((await request(api.auth, { cookie: forged })).body.editable, false);
  }
});

test('session expires and removing a permitted passphrase revokes its sessions', async t => {
  const { api, env, advance } = await setup(t);
  const cookie = await login(api);
  env.CAMPAIGN_PASSPHRASES = JSON.stringify(['another-test-passphrase']);
  assert.equal((await request(api.auth, { cookie })).body.editable, false);
  env.CAMPAIGN_PASSPHRASES = JSON.stringify([PASSPHRASE]);
  assert.equal((await request(api.auth, { cookie })).body.editable, true);
  advance(SESSION_SECONDS * 1000 + 1);
  assert.equal((await request(api.auth, { cookie })).body.editable, false);
});

test('cross-site and missing-origin mutation requests are rejected', async t => {
  const { api } = await setup(t);
  const cookie = await login(api), campaign = (await get(api)).body;
  for (const origin of ['https://evil.example', 'null', null]) {
    assert.equal((await request(api.campaign, { method: 'PUT', body: campaign, cookie, origin })).statusCode, 403);
    assert.equal((await request(api.auth, { method: 'POST', body: { passphrase: PASSPHRASE }, origin })).statusCode, 403);
    assert.equal((await request(api.auth, { method: 'DELETE', cookie, origin })).statusCode, 403);
  }
});

test('signed-in changes persist and cannot propagate camera or visibility', async t => {
  const { api, env } = await setup(t);
  const cookie = await login(api), campaign = (await get(api)).body;
  campaign.session.name = '我们的远征';
  campaign.session.view = { x: 100, y: 100, scale: 2 };
  campaign.session.showJourney = false;
  campaign.session.tripDays = [{ id: 'day-zero', day: 0, note: '抵达楚尔特。', hex: null }];
  const saved = await put(api, cookie, campaign);
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.revision, 1);
  assert.equal(saved.body.session.view, null);
  assert.equal(saved.body.session.showJourney, true);
  const reloaded = (await get(createAPI({ env }))).body;
  assert.deepEqual(reloaded, saved.body);
  assert.equal(reloaded.session.tripDays[0].note, '抵达楚尔特。');
});

test('stale and simultaneous editors cannot silently overwrite each other', async t => {
  const { api, env } = await setup(t);
  const api2 = createAPI({ env });
  const cookie = await login(api), campaign = (await get(api)).body;
  const left = structuredClone(campaign), right = structuredClone(campaign);
  left.session.name = 'left'; right.session.name = 'right';
  const results = await Promise.all([put(api, cookie, left), put(api2, cookie, right)]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
  const successful = results.find(result => result.statusCode === 200);
  const conflict = results.find(result => result.statusCode === 409);
  assert.deepEqual(conflict.body.campaign, successful.body);
  assert.equal((await get(api)).body.revision, 1);
});

test('signed-in tomb bookmarks in grey persist and remain readable to guests', async t => {
  const { api, env } = await setup(t);
  const cookie = await login(api), campaign = (await get(api)).body;
  campaign.session.markers = [{ hex: '46,22', title: '古墓', note: '入口藏在藤蔓后。', kind: 'tomb', color: 'grey' }];
  const saved = await put(api, cookie, campaign);
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.session.markers, campaign.session.markers);
  const publicView = await get(createAPI({ env }));
  assert.equal(publicView.statusCode, 200);
  assert.deepEqual(publicView.body.session.markers, campaign.session.markers);
});

test('invalid foreign-map sessions, day numbers, cells, marker types and revisions are rejected', async t => {
  const { api } = await setup(t);
  const cookie = await login(api), campaign = (await get(api)).body;
  const mutations = [
    value => { value.session.mapId = 'chult'; },
    value => { value.session.revealed = ['999,999']; },
    value => { value.session.tripDays = [{ id: 'day', day: -1, note: '', hex: null }]; },
    value => { value.session.tripDays = [{ id: 'day', day: 1.2, note: '', hex: null }]; },
    value => { value.session.tripDays = [{ id: 'day', day: 0, note: '', hex: null }, { id: 'two', day: 0, note: '', hex: null }]; },
    value => { value.session.markers = [{ hex: '46,22', title: 'A', note: '', color: 'gold', kind: 'script' }]; },
    value => { value.revision = -1; },
    value => { value.revision = 1.1; },
    value => { value.session.name = ''; }
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(campaign); mutate(invalid);
    assert.equal((await put(api, cookie, invalid)).statusCode, 400);
  }
  assert.equal((await get(api)).body.revision, 0);
});

test('body limits, JSON format and content type are enforced for parsed and streaming bodies', async t => {
  const { api } = await setup(t);
  const cookie = await login(api);
  for (const stream of [false, true]) {
    assert.equal((await request(api.campaign, { method: 'PUT', cookie, body: { padding: 'x'.repeat(BODY_LIMIT) }, stream })).statusCode, 413);
    assert.equal((await request(api.campaign, { method: 'PUT', cookie, body: '{', stream })).statusCode, 400);
    assert.equal((await request(api.campaign, { method: 'PUT', cookie, body: [], stream })).statusCode, 400);
  }
  assert.equal((await request(api.campaign, { method: 'PUT', cookie, body: {}, headers: { 'content-type': 'text/plain' } })).statusCode, 415);
});

test('rate limiting persists across instances and resets after its window', async t => {
  const { api, env, advance } = await setup(t);
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await request(api.auth, { method: 'POST', body: { passphrase: 'wrong' } })).statusCode, 401);
  }
  const throttled = await request(createAPI({ env }).auth, { method: 'POST', body: { passphrase: PASSPHRASE } });
  assert.equal(throttled.statusCode, 429);
  assert.ok(Number(throttled.headers['retry-after']) > 0);
  advance(901000);
  assert.equal((await request(api.auth, { method: 'POST', body: { passphrase: PASSPHRASE } })).statusCode, 200);
});

test('production refuses local-file fallback and missing/unsafe auth configuration', async t => {
  const { env } = await setup(t);
  assert.equal((await get(createAPI({ env: { ...env, VERCEL: '1' } }))).statusCode, 503);
  assert.equal((await get(createAPI({ env: { ...env, NODE_ENV: 'production' } }))).statusCode, 503);
  assert.equal((await get(createAPI({ env: {} }))).statusCode, 503);
  for (const invalid of [{ SESSION_SECRET: 'short' }, { CAMPAIGN_PASSPHRASES: '[]' }, { CAMPAIGN_PASSPHRASES: '["tiny"]' }, { CAMPAIGN_PASSPHRASES: 'bad-json' }]) {
    const result = await request(createAPI({ env: { ...env, ...invalid } }).auth);
    assert.equal(result.statusCode, 503);
    assert.deepEqual(Object.keys(result.body).sort(), ['error', 'message']);
  }
});

test('corrupted local state is not overwritten with a fresh campaign', async t => {
  const { api, env } = await setup(t);
  await fs.writeFile(env.CAMPAIGN_DATA_FILE, '{corrupt');
  assert.equal((await get(api)).statusCode, 503);
  assert.equal(await fs.readFile(env.CAMPAIGN_DATA_FILE, 'utf8'), '{corrupt');
});

test('Redis failures fail closed without leaking credentials', async () => {
  const secret = 'never-return-this-redis-token';
  const api = createAPI({ env: { UPSTASH_REDIS_REST_URL: 'https://redis.example', UPSTASH_REDIS_REST_TOKEN: secret },
    fetch: async () => { throw new Error(`Failed ${secret}`); } });
  const result = await get(api);
  assert.equal(result.statusCode, 503);
  assert.ok(!JSON.stringify(result.body).includes(secret));
});

test('Vercel integration KV env aliases are supported', async () => {
  const snapshot = { revision: 0, session: { mapId: 'demo-map' }, updatedAt: '2026-01-01T00:00:00.000Z' };
  const api = createAPI({ env: { KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'a-server-token' },
    fetch: async () => ({ ok: true, json: async () => ({ result: JSON.stringify(snapshot) }) }) });
  assert.deepEqual((await get(api)).body, snapshot);
});

test('Redis writes use a single atomic comparison and never send credentials in URLs', async () => {
  let observed;
  const next = { revision: 1, session: {}, updatedAt: 'now' };
  const store = createRedisStore({ url: 'https://redis.example', token: 'a-server-token', namespace: 'test', initial: () => ({ revision: 0 }),
    fetch: async (url, options) => {
      observed = { url, options };
      return { ok: true, json: async () => ({ result: [1, JSON.stringify(next)] }) };
    } });
  assert.deepEqual(await store.compareSwap(0, next), { ok: true, campaign: next });
  assert.equal(observed.url, 'https://redis.example/');
  assert.equal(observed.options.headers.Authorization, 'Bearer a-server-token');
  const command = JSON.parse(observed.options.body);
  assert.equal(command[0], 'EVAL');
  assert.equal(command[4], '0');
  assert.equal(observed.options.redirect, 'error');
});

test('Redis CAS preserves empty arrays and Chinese notes on both saves and conflicts', async () => {
  // Command-level REST mock: Redis transports a two-element Lua return as an
  // array, retaining the exact stored JSON string. No Redis daemon is required.
  let stored;
  const initial = { revision: 0, session: { revealed: [], markers: [], tripDays: [], name: '楚尔特远征' }, updatedAt: 'before' };
  const next = structuredClone(initial);
  next.revision = 1;
  next.session.tripDays = [{ id: 'first', day: 0, note: '在营地停留。', hex: null }];
  const store = createRedisStore({ url: 'https://redis.example', token: 'a-server-token', namespace: 'test', initial: () => initial,
    fetch: async (_, options) => {
      const [operation, script, count, key, revision, candidate, seed] = JSON.parse(options.body);
      assert.equal(operation, 'EVAL');
      assert.equal(count, '1');
      assert.equal(key, 'seerjourney:test:campaign');
      // Re-encoding in cjson would turn empty revealed/markers arrays into {}.
      assert.doesNotMatch(script, /cjson\.encode/);
      stored ??= seed;
      const ok = JSON.parse(stored).revision === Number(revision);
      if (ok) stored = candidate;
      return { ok: true, json: async () => ({ result: [ok ? 1 : 0, stored] }) };
    } });
  const saved = await store.compareSwap(0, next);
  const conflict = await store.compareSwap(0, initial);
  assert.equal(saved.ok, true);
  assert.equal(conflict.ok, false);
  for (const result of [saved, conflict]) {
    assert.deepEqual(result.campaign, next);
    assert.ok(Array.isArray(result.campaign.session.revealed));
    assert.ok(Array.isArray(result.campaign.session.markers));
    assert.equal(result.campaign.session.tripDays[0].note, '在营地停留。');
  }
  const emptied = { ...initial, revision: 2 };
  assert.deepEqual((await store.compareSwap(1, emptied)).campaign.session.tripDays, []);
});
