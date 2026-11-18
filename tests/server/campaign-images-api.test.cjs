'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createAPI, MAP } = require('../../src/server/campaign.cjs');
const { MAX_IMAGE_BYTES } = require('../../src/server/images.cjs');
const C = require('../../src/shared/core.js');
const PHRASE = 'test-image-edit-passphrase';
const ID = '11111111-2222-4333-8444-555555555555';
const PATHNAME = `campaigns/demo-map/${ID}.png`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5cAAAAASUVORK5CYII=', 'base64');
const imageInput = () => ({ id: ID, pathname: PATHNAME, name: '营地.png', type: 'image/png', width: 1, height: 1, data: PNG.toString('base64') });
async function call(handler, { method = 'GET', body, cookie, origin = 'http://localhost:8780', headers = {}, url = '/api/images' } = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(raw ? [raw] : []);
  req.method = method; req.url = url;
  req.headers = { host: 'localhost:8780', ...(origin === null ? {} : { origin }), ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers };
  req.socket = { remoteAddress: '127.0.0.1' };
  if (body !== undefined) req.body = body;
  const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(value) {
    this.body = Buffer.isBuffer(value) || value === undefined ? value : JSON.parse(value);
  } };
  await handler(req, res); return res;
}
async function setup(t, { env: override = {}, imageSDK, remote = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seerjourney-images-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const env = { CAMPAIGN_STORE: remote ? 'redis' : 'file', CAMPAIGN_DATA_FILE: path.join(directory, 'campaign.json'), CAMPAIGN_PASSPHRASES: JSON.stringify([PHRASE]), SESSION_SECRET: 'image-test-secret-'.repeat(4), ...override };
  let stored = { revision: 0, session: C.freshSession(MAP), updatedAt: new Date().toISOString() };
  const store = { read: async () => structuredClone(stored), rateLimit: async () => ({ allowed: true }), compareSwap: async (revision, next) => {
    if (revision !== stored.revision) return { ok: false, campaign: structuredClone(stored) };
    stored = structuredClone(next); return { ok: true, campaign: stored };
  } };
  const api = createAPI({ env, imageSDK, ...(remote ? { store } : {}) });
  const login = await call(api.auth, { method: 'POST', body: { passphrase: PHRASE } });
  assert.equal(login.statusCode, 200);
  return { api, env, cookie: login.headers['set-cookie'].split(';')[0], directory };
}
const post = (api, cookie, body, more) => call(api.images, { method: 'POST', cookie, body, ...more });

test('image uploads require an editor and same-origin requests', async t => {
  const { api, cookie } = await setup(t);
  assert.deepEqual((await call(api.images)).body, { mode: 'local', maxBytes: MAX_IMAGE_BYTES, prefix: 'campaigns/demo-map/', campaignId: 'demo-map' });
  assert.equal((await post(api, undefined, { op: 'local', ...imageInput() })).statusCode, 401);
  assert.equal((await post(api, cookie, { op: 'local', ...imageInput() }, { origin: 'https://elsewhere.example' })).statusCode, 403);
});

test('local uploads persist immutable image bytes, canonical metadata and public reads', async t => {
  const { api, cookie, env } = await setup(t);
  const uploaded = await post(api, cookie, { op: 'local', ...imageInput() });
  assert.equal(uploaded.statusCode, 200);
  assert.equal(uploaded.body.size, PNG.length);
  assert.equal(uploaded.body.name, '营地.png');
  assert.equal(uploaded.body.url, `/api/images?pathname=${encodeURIComponent(PATHNAME)}`);
  const reloaded = createAPI({ env });
  const response = await call(reloaded.images, { url: uploaded.body.url });
  assert.deepEqual(response.body, PNG);
  assert.equal(response.headers['content-type'], 'image/png');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal((await post(api, cookie, { op: 'local', ...imageInput() })).statusCode, 409);
  const confirmed = await post(api, cookie, { op: 'confirm', ...imageInput() });
  assert.equal(confirmed.statusCode, 200);
  assert.deepEqual(confirmed.body, uploaded.body);
});

test('image routes reject traversal, mismatched IDs, invalid formats and oversized images', async t => {
  const { api, cookie } = await setup(t);
  for (const change of [
    { pathname: '../.env' }, { pathname: 'https://elsewhere.example/photo.png' },
    { pathname: PATHNAME.replace('demo-map', 'other') }, { id: 'wrong' },
    { type: 'image/svg+xml' }, { data: Buffer.from('<svg/>').toString('base64') },
    { data: 'abc' }, { data: PNG.toString('base64').slice(0, -2) + '=Z' }, { width: 0 }, { height: 32769 }, { width: 32768, height: 32768 },
    { name: 'x\r\nHeader: injected' }
  ]) assert.equal((await post(api, cookie, { op: 'local', ...imageInput(), ...change })).statusCode, 400);
  const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1); PNG.copy(oversized);
  assert.equal((await post(api, cookie, { op: 'local', ...imageInput(), data: oversized.toString('base64') })).statusCode, 400);
  assert.equal((await call(api.images, { url: '/api/images?pathname=..%2F.env' })).statusCode, 400);
});

test('the exact 8 MiB limit is accepted locally', async t => {
  const { api, cookie } = await setup(t);
  const boundary = Buffer.alloc(MAX_IMAGE_BYTES); PNG.copy(boundary);
  const uploaded = await post(api, cookie, { op: 'local', ...imageInput(), data: boundary.toString('base64') });
  assert.equal(uploaded.statusCode, 200);
  assert.equal(uploaded.body.size, MAX_IMAGE_BYTES);
});

test('presigned tokens are scoped to one path and format with 8 MiB limits and no overwrite', async t => {
  let issued, signed;
  const sdk = {
    issueSignedToken: async options => { issued = options; return { delegationToken: 'not-a-real-token', clientSigningToken: 'not-a-real-secret', validUntil: options.validUntil }; },
    handleUploadPresigned: async options => { signed = await options.getSignedToken(options.body.payload.pathname); return { type: 'blob.generate-presigned-url', presignedUrlPayload: { test: true } }; }
  };
  const { api, cookie } = await setup(t, { remote: true, env: { BLOB_STORE_ID: 'store_test', BLOB_WEBHOOK_PUBLIC_KEY: 'test-public-key' }, imageSDK: sdk });
  const payload = { type: 'blob.generate-presigned-url', payload: { pathname: PATHNAME, multipart: false } };
  assert.equal((await post(api, undefined, payload)).statusCode, 401);
  const response = await post(api, cookie, payload);
  assert.equal(response.statusCode, 200);
  assert.equal(issued.pathname, PATHNAME);
  assert.deepEqual(issued.operations, ['put']);
  assert.deepEqual(issued.allowedContentTypes, ['image/png']);
  assert.equal(issued.maximumSizeInBytes, MAX_IMAGE_BYTES);
  assert.equal(issued.storeId, 'store_test');
  assert.ok(issued.validUntil > Date.now() && issued.validUntil <= Date.now() + 600000);
  assert.equal(signed.urlOptions.allowOverwrite, false);
  assert.equal(signed.urlOptions.addRandomSuffix, false);
  assert.equal(signed.urlOptions.maximumSizeInBytes, MAX_IMAGE_BYTES);
  assert.equal((await post(api, cookie, { ...payload, payload: { ...payload.payload, multipart: true } })).statusCode, 400);
  assert.equal((await post(api, cookie, { ...payload, payload: { pathname: 'arbitrary/file.svg' } })).statusCode, 400);
  assert.equal((await post(api, cookie, { op: 'local', ...imageInput() })).statusCode, 405);
});

test('confirmed remote images use own-store head and reject unsafe or oversized results', async t => {
  const actual = { pathname: PATHNAME, url: `https://test.public.blob.vercel-storage.com/${PATHNAME}`, size: PNG.length, contentType: 'image/png' };
  let result = actual, usedPath, usedOptions;
  const { api, cookie } = await setup(t, { remote: true, env: { BLOB_STORE_ID: 'store_test' }, imageSDK: { head: async (pathname, options) => { usedPath = pathname; usedOptions = options; return result; } } });
  assert.equal((await post(api, cookie, { op: 'confirm', ...imageInput() })).statusCode, 200);
  assert.equal(usedPath, PATHNAME); assert.equal(usedOptions.storeId, 'store_test');
  for (const change of [{ size: MAX_IMAGE_BYTES + 1 }, { contentType: 'image/svg+xml' }, { pathname: 'wrong.png' }, { url: 'https://attacker.example/a.png' }, { url: actual.url + '?token=x' }]) {
    result = { ...actual, ...change };
    assert.equal((await post(api, cookie, { op: 'confirm', ...imageInput() })).statusCode, 400);
  }
});

test('production never uses the development image filesystem', async t => {
  const { api, cookie } = await setup(t, { remote: true, env: { CAMPAIGN_STORE: 'file', NODE_ENV: 'production' } });
  assert.equal((await call(api.images)).body.mode, 'blob');
  assert.equal((await post(api, cookie, { op: 'local', ...imageInput() })).statusCode, 405);
  assert.equal((await call(api.images, { url: '/api/images?pathname=' + encodeURIComponent(PATHNAME) })).statusCode, 404);
});

test('unsigned upload callbacks cannot bypass editor authentication', async t => {
  const { api } = await setup(t, { remote: true, env: { BLOB_STORE_ID: 'store_test', BLOB_WEBHOOK_PUBLIC_KEY: 'test-public-key' } });
  const callback = { type: 'blob.upload-completed', payload: {} };
  assert.equal((await post(api, undefined, callback)).statusCode, 401);
  assert.equal((await post(api, undefined, callback, { origin: null, headers: { 'x-vercel-signature': 'forged' } })).statusCode, 403);
  assert.equal((await post(api, undefined, { op: 'confirm', ...imageInput() }, { headers: { 'x-vercel-signature': 'forged' } })).statusCode, 401);
});

test('campaign saves validate new attachments and retain them on subsequent edits', async t => {
  const { api, cookie } = await setup(t);
  const image = (await post(api, cookie, { op: 'local', ...imageInput() })).body;
  const snapshot = (await call(api.campaign)).body;
  snapshot.session.tripDays = [{ id: 'day-0', day: 0, note: 'Camp image', hex: null, attachments: [image] }];
  const first = await call(api.campaign, { method: 'PUT', cookie, body: snapshot });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.session.tripDays[0].attachments, [image]);
  const next = structuredClone(first.body);
  next.session.tripDays[0].note = 'An updated note';
  assert.equal((await call(api.campaign, { method: 'PUT', cookie, body: next })).statusCode, 200);
  const forged = structuredClone((await call(api.campaign)).body);
  forged.session.tripDays[0].attachments[0].url = 'https://other.public.blob.vercel-storage.com/' + PATHNAME;
  assert.equal((await call(api.campaign, { method: 'PUT', cookie, body: forged })).statusCode, 400);
});

test('old editor saves preserve images while explicit removal and day deletion still work', async t => {
  const { api, cookie } = await setup(t);
  const image = (await post(api, cookie, { op: 'local', ...imageInput() })).body;
  const snapshot = (await call(api.campaign)).body;
  snapshot.session.tripDays = [{ id: 'day-0', day: 0, note: 'Camp', hex: null, attachments: [image] }];
  let saved = await call(api.campaign, { method: 'PUT', cookie, body: snapshot });
  assert.equal(saved.statusCode, 200);
  const oldEditor = structuredClone(saved.body);
  delete oldEditor.session.tripDays[0].attachments;
  oldEditor.session.tripDays[0].note = 'Edited by an older tab';
  saved = await call(api.campaign, { method: 'PUT', cookie, body: oldEditor });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.session.tripDays[0].attachments, [image]);
  const removed = structuredClone(saved.body);
  removed.session.tripDays[0].attachments = [];
  saved = await call(api.campaign, { method: 'PUT', cookie, body: removed });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.session.tripDays[0].attachments, []);
  const restored = structuredClone(saved.body);
  restored.session.tripDays[0].attachments = [image];
  saved = await call(api.campaign, { method: 'PUT', cookie, body: restored });
  const deleted = structuredClone(saved.body);
  deleted.session.tripDays = [];
  saved = await call(api.campaign, { method: 'PUT', cookie, body: deleted });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.session.tripDays, []);
});
