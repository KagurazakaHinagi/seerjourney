'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const C = require('../../src/shared/core.js');
const { createAPI, MAP, SESSION_SECONDS } = require('../../src/server/campaign.cjs');

const PHRASE = 'test-adventure-notes-passphrase';
const CREATED = '2026-11-16T10:00:00.000Z';
const UPDATED = '2026-11-17T14:30:12.123Z';
const note = (id = 'note-1', changes = {}) => ({ id, title: '冒险笔记', body: '营地线索。\nVisit the old temple.', createdAt: CREATED, updatedAt: UPDATED, ...changes });
const session = notes => ({ ...C.freshSession(MAP), adventureNotes: notes });

async function call(handler, { method = 'GET', body, cookie, origin = 'http://localhost:8780' } = {}) {
  const req = Readable.from([]);
  req.method = method; req.url = '/api/campaign'; req.body = body;
  req.headers = { host: 'localhost:8780', origin, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
  req.socket = { remoteAddress: '127.0.0.1' };
  const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(value) { this.body = value === undefined ? undefined : JSON.parse(value); } };
  await handler(req, res); return res;
}

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seerjourney-adventure-notes-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const env = { CAMPAIGN_STORE: 'file', CAMPAIGN_DATA_FILE: path.join(directory, 'campaign.json'),
    CAMPAIGN_PASSPHRASES: JSON.stringify([PHRASE]), SESSION_SECRET: 'adventure-note-test-secret-'.repeat(3) };
  let timestamp = Date.now();
  const api = createAPI({ env, now: () => timestamp });
  const login = await call(api.auth, { method: 'POST', body: { passphrase: PHRASE } });
  assert.equal(login.statusCode, 200);
  return { api, env, cookie: login.headers['set-cookie'].split(';')[0], advance: milliseconds => { timestamp += milliseconds; } };
}

const save = (api, cookie, campaign) => call(api.campaign, { method: 'PUT', cookie, body: campaign });

test('fresh sessions explicitly reset adventure notes while legacy omission stays absent', () => {
  const first = C.freshSession(MAP), second = C.freshSession(MAP);
  assert.deepEqual(first.adventureNotes, []);
  first.adventureNotes.push(note());
  assert.deepEqual(second.adventureNotes, []);
  const legacy = { ...first }; delete legacy.adventureNotes;
  const parsed = C.validateSession(JSON.parse(JSON.stringify(legacy)), MAP);
  assert.equal(Object.hasOwn(parsed, 'adventureNotes'), false);
});

test('adventure notes roundtrip Unicode and plain text, trim titles, and drop unknown fields', () => {
  const input = note('first', { title: '  楚尔特：远征线索  ', body: '<script>alert(1)</script>\n**Ancient inscriptions**\n\n营地待办。', ignored: true });
  const output = C.validateSession(JSON.parse(JSON.stringify(session([input, note('second', { body: '' })]))), MAP);
  assert.deepEqual(output.adventureNotes, [{ id: 'first', title: '楚尔特：远征线索', body: input.body, createdAt: CREATED, updatedAt: UPDATED }, note('second', { body: '' })]);
});

test('adventure note count, identifier, title and body boundaries are enforced', () => {
  assert.equal(C.validateSession(session(Array.from({ length: 200 }, (_, i) => note(`n-${i}`))), MAP).adventureNotes.length, 200);
  const exact = note('i'.repeat(128), { title: ' 标'.repeat(80), body: '文'.repeat(50000) });
  assert.equal(C.validateSession(session([exact]), MAP).adventureNotes[0].body.length, 50000);
  for (const notes of [null, {}, '', Array.from({ length: 201 }, (_, i) => note(`n-${i}`)), [null], [[]], ['text']]) {
    assert.throws(() => C.validateSession(session(notes), MAP));
  }
  for (const changes of [{ id: '' }, { id: '  ' }, { id: 1 }, { id: 'i'.repeat(129) }, { title: '' }, { title: ' \u3000 ' },
    { title: null }, { title: 42 }, { title: 't'.repeat(161) }, { body: null }, { body: {} }, { body: 'b'.repeat(50001) }]) {
    assert.throws(() => C.validateSession(session([note('n', changes)]), MAP));
  }
  assert.throws(() => C.validateSession(session([note('same'), note('same')]), MAP), /duplicate ID/);
});

test('note timestamps accept timezone-qualified ISO times and real leap days', () => {
  for (const timestamp of [CREATED, '2024-02-29T00:00:00Z', '2000-02-29T12:30:00.1+08:00', '2026-11-16T09:10:11.12-08:00']) {
    const output = C.validateSession(session([note('n', { createdAt: timestamp, updatedAt: timestamp })]), MAP);
    assert.equal(output.adventureNotes[0].createdAt, timestamp);
    assert.equal(output.adventureNotes[0].updatedAt, timestamp);
  }
});

test('note timestamps reject missing fields, non-ISO values and impossible calendar dates', () => {
  const invalid = [undefined, null, 0, new Date(CREATED), '', 'yesterday', '2026-11-16', '2026-11-16T10:00:00',
    '2026-11-16 10:00:00Z', '2023-02-29T00:00:00.000Z', '1900-02-29T00:00:00Z', '2026-04-31T10:00:00Z',
    '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z', '2026-11-16T24:00:00Z',
    '2026-11-16T10:60:00Z', '2026-11-16T10:00:60Z', '2026-11-16T10:00:00+25:00', '2026-11-16T10:00:00+08:99'];
  for (const timestamp of invalid) {
    for (const field of ['createdAt', 'updatedAt']) {
      assert.throws(() => C.validateSession(session([note('n', { [field]: timestamp })]), MAP), /timestamp/, `${field}: ${timestamp}`);
    }
  }
});

test('editors create, update and delete shared notes while guests can read them after reload', async t => {
  const { api, env, cookie } = await setup(t);
  let campaign = (await call(api.campaign)).body;
  assert.deepEqual(campaign.session.adventureNotes, []);
  campaign.session.adventureNotes = [note('first'), note('second')];
  let result = await save(api, cookie, campaign);
  assert.equal(result.statusCode, 200);
  campaign = result.body;
  assert.equal(campaign.revision, 1);
  campaign.session.adventureNotes[0].title = 'Updated title';
  campaign.session.adventureNotes[0].body = 'A new discovery.';
  campaign.session.adventureNotes[0].updatedAt = '2026-11-18T00:00:00.000Z';
  result = await save(api, cookie, campaign);
  assert.equal(result.statusCode, 200);
  campaign = result.body;
  assert.equal(campaign.session.adventureNotes[0].createdAt, CREATED);
  assert.equal(campaign.session.adventureNotes[0].body, 'A new discovery.');
  campaign.session.adventureNotes.splice(1, 1);
  result = await save(api, cookie, campaign);
  assert.equal(result.statusCode, 200);
  const reloaded = (await call(createAPI({ env }).campaign)).body;
  assert.deepEqual(reloaded.session.adventureNotes, result.body.session.adventureNotes);
  assert.equal(reloaded.session.adventureNotes.length, 1);
  assert.equal(reloaded.revision, 3);
});

test('guests, expired editor sessions and cross-origin requests cannot modify adventure notes', async t => {
  const { api, cookie, advance } = await setup(t);
  let campaign = (await call(api.campaign)).body;
  campaign.session.adventureNotes = [note()];
  campaign = (await save(api, cookie, campaign)).body;
  for (const notes of [[], [note('different')], [note('note-1', { body: 'Unauthorized change' })]]) {
    const proposed = structuredClone(campaign); proposed.session.adventureNotes = notes;
    assert.equal((await save(api, undefined, proposed)).statusCode, 401);
  }
  assert.equal((await call(api.campaign, { method: 'PUT', cookie, body: campaign, origin: 'https://elsewhere.example' })).statusCode, 403);
  advance((SESSION_SECONDS + 1) * 1000);
  assert.equal((await save(api, cookie, campaign)).statusCode, 401);
  assert.deepEqual((await call(api.campaign)).body.session.adventureNotes, [note()]);
});

test('older clients preserve shared notes on omission and current clients explicitly clear them', async t => {
  const { api, cookie } = await setup(t);
  let campaign = (await call(api.campaign)).body;
  campaign.session.adventureNotes = [note()];
  campaign.session.tripDays = [{ id: 'day-0', day: 0, note: 'Travel notes', hex: MAP.fogHexes[0], participants: ['游侠'], attachments: [] }];
  campaign.session.markers = [{ hex: MAP.fogHexes[0], title: 'Camp', note: 'Existing place', color: 'green', kind: 'camp' }];
  campaign.session.revealed = [MAP.fogHexes[0]];
  campaign = (await save(api, cookie, campaign)).body;
  const preserved = structuredClone(campaign.session);
  delete campaign.session.adventureNotes;
  delete campaign.session.tripDays[0].participants;
  delete campaign.session.tripDays[0].attachments;
  campaign.session.tripDays[0].note = 'Updated from an old tab';
  campaign = (await save(api, cookie, campaign)).body;
  assert.deepEqual(campaign.session.adventureNotes, preserved.adventureNotes);
  assert.deepEqual(campaign.session.tripDays[0].participants, ['游侠']);
  assert.deepEqual(campaign.session.tripDays[0].attachments, []);
  assert.deepEqual(campaign.session.markers, preserved.markers);
  assert.deepEqual(campaign.session.revealed, preserved.revealed);
  campaign.session.adventureNotes = [];
  campaign = (await save(api, cookie, campaign)).body;
  assert.deepEqual(campaign.session.adventureNotes, []);
  assert.equal(campaign.session.tripDays[0].note, 'Updated from an old tab');
});

test('invalid adventure notes are rejected before the shared revision advances', async t => {
  const { api, cookie } = await setup(t);
  const campaign = (await call(api.campaign)).body;
  for (const notes of [null, [note('', {})], [note('n', { title: ' ' })], [note('n', { body: false })],
    [note('n', { createdAt: '2026-02-30T00:00:00Z' })], [note('same'), note('same')]]) {
    const proposed = structuredClone(campaign); proposed.session.adventureNotes = notes;
    const result = await save(api, cookie, proposed);
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error, 'invalid_session');
  }
  assert.equal((await call(api.campaign)).body.revision, 0);
});

test('stale note edits cannot overwrite another editor and conflict responses include the latest notes', async t => {
  const { api, cookie } = await setup(t);
  const original = (await call(api.campaign)).body;
  const first = structuredClone(original), stale = structuredClone(original);
  first.session.adventureNotes = [note('first')];
  stale.session.adventureNotes = [note('second')];
  const accepted = await save(api, cookie, first);
  assert.equal(accepted.statusCode, 200);
  const conflict = await save(api, cookie, stale);
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.error, 'conflict');
  assert.deepEqual(conflict.body.campaign.session.adventureNotes, [note('first')]);
  assert.deepEqual((await call(api.campaign)).body.session.adventureNotes, [note('first')]);
});
