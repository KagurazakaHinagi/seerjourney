'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createAPI, MAP, SESSION_SECONDS } = require('../../src/server/campaign.cjs');
const C = require('../../src/shared/core.js');

const PHRASE = 'test-participants-passphrase';
const day = (number, hex = null, participants) => ({ id: `day-${number}`, day: number, note: '', hex,
  ...(participants === undefined ? {} : { participants }) });
const pairs = route => route.segments.map(segment => [segment.from.day, segment.to.day]);

async function call(handler, { method = 'GET', body, cookie, origin = 'http://localhost:8780' } = {}) {
  const req = Readable.from([]);
  req.method = method; req.url = '/api/campaign'; req.body = body;
  req.headers = { host: 'localhost:8780', origin, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
  req.socket = { remoteAddress: '127.0.0.1' };
  const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(value) { this.body = value === undefined ? undefined : JSON.parse(value); } };
  await handler(req, res);
  return res;
}

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seerjourney-participants-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const env = { CAMPAIGN_STORE: 'file', CAMPAIGN_DATA_FILE: path.join(directory, 'campaign.json'),
    CAMPAIGN_PASSPHRASES: JSON.stringify([PHRASE]), SESSION_SECRET: 'participant-test-secret-'.repeat(3) };
  let timestamp = Date.now();
  const api = createAPI({ env, now: () => timestamp });
  const login = await call(api.auth, { method: 'POST', body: { passphrase: PHRASE } });
  assert.equal(login.statusCode, 200);
  return { api, env, cookie: login.headers['set-cookie'].split(';')[0], advance: milliseconds => { timestamp += milliseconds; } };
}

const save = (api, cookie, campaign) => call(api.campaign, { method: 'PUT', cookie, body: campaign });

test('participants normalize Unicode, spaces and case while retaining first display spelling', () => {
  assert.deepEqual(C.normalizeParticipants(['  E\u0301owyn\u00a0  II  ', 'éOWYN II', ' 楚尔特  游侠 ', '楚尔特\u3000游侠', 'БОБ', 'боб']),
    ['Éowyn II', '楚尔特 游侠', 'БОБ']);
  assert.equal(C.participantKey('  E\u0301OWYN\u2003II '), C.participantKey('éowyn II'));
  assert.equal(C.participantKey('БОБ'), C.participantKey('боб'));
  assert.deepEqual(C.normalizeParticipants(['😀'.repeat(40)]), ['😀'.repeat(40)]);
  assert.deepEqual(C.normalizeParticipants([]), []);
});

test('participant validation rejects invalid arrays, empty names, controls and limits', () => {
  for (const names of [null, {}, 'Alice', [null], [42], [''], [' \u3000 '], ['A\nB'], ['A\tB'], ['A\u0000B'], ['A\u007fB'], ['A\u202eB'], ['a'.repeat(81)], ['😀'.repeat(41)], Array(33).fill('Alice')]) {
    assert.throws(() => C.normalizeParticipants(names));
  }
  assert.equal(C.normalizeParticipants(Array.from({ length: 32 }, (_, i) => `Character ${i}`)).length, 32);
});

test('participant suggestions sort and deduplicate across days without a campaign-wide limit', () => {
  const logs = [day(0), day(1, null, ['Zelda', 'Alice']), day(2, null, ['alice', 'Bob'])];
  assert.deepEqual(C.participantNames(logs), ['Alice', 'Bob', 'Zelda']);
  assert.equal(C.participantNames(Array.from({ length: 40 }, (_, i) => day(i, null, [`Person ${i}`]))).length, 40);
  assert.deepEqual(C.participantNames([]), []);
});

test('session validation preserves optional participants and normalizes supplied names', () => {
  const original = { ...C.freshSession(MAP), tripDays: [day(0), day(1, null, []), day(2, '30,10', [' E\u0301owyn ', 'ÉOWYN'])] };
  const result = C.validateSession(JSON.parse(JSON.stringify(original)), MAP);
  assert.equal(Object.hasOwn(result.tripDays[0], 'participants'), false);
  assert.deepEqual(result.tripDays[1].participants, []);
  assert.deepEqual(result.tripDays[2].participants, ['Éowyn']);
  for (const participants of [null, [''], ['A\nB'], Array(33).fill('A')]) {
    assert.throws(() => C.validateSession({ ...original, tripDays: [day(0, null, participants)] }, MAP));
  }
});

test('a character route breaks across any mapped day where that character is absent', () => {
  const logs = [day(4, '30,18', ['Alice']), day(0, '30,10', ['Alice']), day(1, '30,12', ['Bob']), day(3, '30,16', ['ALICE'])];
  const route = C.journey(logs, MAP.grid, ' alice ');
  assert.deepEqual(route.stops.map(stop => stop.day), [0, 3, 4]);
  assert.deepEqual(pairs(route), [[3, 4]]);
  assert.deepEqual(new Set(route.visited), new Set(['30,10', '30,16', '30,17', '30,18']));
  assert.deepEqual(pairs(C.journey(logs, MAP.grid)), [[0, 1], [1, 3], [3, 4]]);
  assert.deepEqual(C.journey(logs, MAP.grid, 'Nobody'), { stops: [], segments: [], visited: [] });
});

test('notes-only absence and legacy days break routes, while matching notes-only days preserve them', () => {
  for (const participants of [undefined, [], ['Bob']]) {
    const logs = [day(0, '30,10', ['Alice']), day(1, null, participants), day(2, '30,14', ['Alice'])];
    assert.deepEqual(pairs(C.journey(logs, MAP.grid, 'Alice')), []);
    assert.deepEqual(new Set(C.journey(logs, MAP.grid, 'Alice').visited), new Set(['30,10', '30,14']));
  }
  const matching = [day(0, '30,10', ['Alice']), day(1, null, ['ALICE']), day(2, '30,14', ['Alice'])];
  assert.deepEqual(pairs(C.journey(matching, MAP.grid, 'Alice')), [[0, 2]]);
});

test('unrecorded calendar gaps retain route endpoints for dashed rendering and count crossed cells', () => {
  const logs = [day(0, '30,10', ['Alice']), day(7, '30,14', ['Alice']), day(8, '30,14', ['Alice'])];
  const route = C.journey(logs, MAP.grid, 'Alice');
  assert.deepEqual(pairs(route), [[0, 7], [7, 8]]);
  assert.equal(route.segments[0].to.day - route.segments[0].from.day > 1, true);
  assert.equal(route.segments[1].to.day - route.segments[1].from.day, 1);
  assert.deepEqual(new Set(route.visited), new Set(['30,10', '30,11', '30,12', '30,13', '30,14']));
});

test('participant changes persist and are publicly readable after reloading the campaign', async t => {
  const { api, env, cookie } = await setup(t);
  const campaign = (await call(api.campaign)).body;
  campaign.session.tripDays = [day(0, '30,10', [' Alice ', 'ALICE', '游侠'])];
  const saved = await save(api, cookie, campaign);
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.session.tripDays[0].participants, ['Alice', '游侠']);
  const reloaded = (await call(createAPI({ env }).campaign)).body;
  assert.deepEqual(reloaded.session.tripDays, saved.body.session.tripDays);
});

test('guest, expired-session and cross-origin requests cannot modify participants', async t => {
  const { api, cookie, advance } = await setup(t);
  const campaign = (await call(api.campaign)).body;
  campaign.session.tripDays = [day(0, null, ['Alice'])];
  assert.equal((await save(api, undefined, campaign)).statusCode, 401);
  assert.equal((await call(api.campaign, { method: 'PUT', cookie, body: campaign, origin: 'https://other.example' })).statusCode, 403);
  advance((SESSION_SECONDS + 1) * 1000);
  assert.equal((await save(api, cookie, campaign)).statusCode, 401);
  assert.equal((await call(api.campaign)).body.revision, 0);
});

test('old clients preserve participants by day ID; explicit empty lists and day deletion remove them', async t => {
  const { api, cookie } = await setup(t);
  let campaign = (await call(api.campaign)).body;
  campaign.session.tripDays = [{ ...day(0, null, ['Alice']), attachments: [] }, day(1, null, ['Bob'])];
  campaign = (await save(api, cookie, campaign)).body;
  delete campaign.session.tripDays[0].participants;
  delete campaign.session.tripDays[0].attachments;
  campaign.session.tripDays[0].note = 'Edited from an older open tab.';
  campaign = (await save(api, cookie, campaign)).body;
  assert.deepEqual(campaign.session.tripDays[0].participants, ['Alice']);
  assert.deepEqual(campaign.session.tripDays[0].attachments, []);
  campaign.session.tripDays[0].participants = [];
  campaign.session.tripDays = [campaign.session.tripDays[0], day(2)];
  campaign = (await save(api, cookie, campaign)).body;
  assert.deepEqual(campaign.session.tripDays[0].participants, []);
  assert.equal(campaign.session.tripDays.some(log => log.id === 'day-1'), false);
  assert.equal(Object.hasOwn(campaign.session.tripDays[1], 'participants'), false);
});

test('invalid participant metadata is rejected before the shared campaign is written', async t => {
  const { api, cookie } = await setup(t);
  const campaign = (await call(api.campaign)).body;
  for (const participants of [null, [''], [42], ['A\u0000B'], ['A'.repeat(81)], Array(33).fill('A')]) {
    const invalid = structuredClone(campaign);
    invalid.session.tripDays = [day(0, null, participants)];
    const response = await save(api, cookie, invalid);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, 'invalid_session');
  }
  assert.equal((await call(api.campaign)).body.revision, 0);
});
