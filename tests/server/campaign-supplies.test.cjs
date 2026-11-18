'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const S = require('../../src/shared/supplies-core.js');
const C = require('../../src/shared/core.js');
const { createAPI, MAP, SESSION_SECONDS } = require('../../src/server/campaign.cjs');
const supply = changes => ({ ...S.empty(), ...changes });
const food = (id, amount, name = id) => ({ id, name, amount });
const day = (number, supplies, changes = {}) => ({ id: `day-${number}`, day: number, note: '', hex: null, ...(supplies === undefined ? {} : { supplies }), ...changes });
const session = tripDays => ({ ...C.freshSession(MAP), tripDays });

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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seerjourney-supplies-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const env = { CAMPAIGN_STORE: 'file', CAMPAIGN_DATA_FILE: path.join(directory, 'campaign.json'),
    CAMPAIGN_PASSPHRASES: JSON.stringify(['supplies-test-passphrase']), SESSION_SECRET: 'supplies-test-secret-'.repeat(4) };
  let timestamp = Date.now();
  const api = createAPI({ env, now: () => timestamp });
  const login = await call(api.auth, { method: 'POST', body: { passphrase: 'supplies-test-passphrase' } });
  assert.equal(login.statusCode, 200);
  return { api, env, cookie: login.headers['set-cookie'].split(';')[0], advance: milliseconds => { timestamp += milliseconds; } };
}
const save = (api, cookie, campaign) => call(api.campaign, { method: 'PUT', cookie, body: campaign });

test('supplies normalize bounded decimal quantities, Unicode names and optional legacy days', () => {
  const input = supply({ foods: [food('fish', 3.125, '  河鱼  ')], water: 1.001, foodConsumed: 0.125, waterConsumed: 0.001, unknown: true });
  const parsed = C.validateSession(session([day(0, input), day(1)]), MAP);
  assert.deepEqual(parsed.tripDays[0].supplies, supply({ foods: [food('fish', 3.125, '河鱼')], water: 1.001, foodConsumed: 0.125, waterConsumed: 0.001 }));
  assert.equal(Object.hasOwn(parsed.tripDays[1], 'supplies'), false);
  const a = S.empty(), b = S.empty(); a.foods.push(food('x', 1)); assert.deepEqual(b.foods, []);
  assert.deepEqual(S.ledger([]), { day: 0, food: 0, water: 0, batches: [], days: [], errors: [] });
});

test('supplies reject malformed, unbounded and overly precise inputs', () => {
  for (const value of [null, [], '', 1, {}, supply({ foods: null }), supply({ foods: [null] }), supply({ foods: [[]] }), supply({ foods: [food('', 1)] }), supply({ foods: [food(' ', 1)] }), supply({ foods: [food('a'.repeat(129), 1)] }), supply({ foods: [food('a', 1, '')] }), supply({ foods: [food('a', 1, ' '.repeat(10))] }), supply({ foods: [food('a', 1, 'x'.repeat(101))] })]) assert.throws(() => S.validate(value));
  for (const value of [undefined, null, '', '1', false, -1, NaN, Infinity, 1000000.001, 1.0001, 0.0001]) {
    for (const field of ['water', 'foodConsumed', 'waterConsumed']) assert.throws(() => S.validate(supply({ [field]: value })), `${field}: ${value}`);
    assert.throws(() => S.validate(supply({ foods: [food('a', value)] })));
  }
  assert.throws(() => S.validate(supply({ foods: [food('a', 0)] })));
  assert.throws(() => S.validate(supply({ foods: [food('a', 1), food('a', 2)] })), /duplicate/);
  assert.throws(() => S.validate(supply({ foods: Array.from({ length: 101 }, (_, i) => food(String(i), 1)) })), /100 foods/);
  assert.equal(S.validate(supply({ foods: Array.from({ length: 100 }, (_, i) => food(String(i), 1000000, '食'.repeat(100))), water: 1000000 })).foods.length, 100);
});

test('food is usable through Day 6 and expires on Day 7 without expiring water', () => {
  const logs = [day(0, supply({ foods: [food('fish', 5)], water: 9 }))];
  assert.equal(S.ledger(logs, 6).food, 5);
  assert.equal(S.ledger(logs, 6).batches[0].status, 'available');
  const expired = S.ledger(logs, 7);
  assert.equal(expired.food, 0); assert.equal(expired.water, 9);
  assert.deepEqual(expired.batches[0], { id: 'fish', name: 'fish', day: 0, expiresDay: 7, amount: 5, remaining: 5, status: 'expired' });
  assert.equal(S.ledger(logs, 8000).water, 9);
  assert.equal(S.assertLedger([...logs, day(6, supply({ foodConsumed: 5, waterConsumed: 2 }))]).food, 0);
  assert.throws(() => S.assertLedger([...logs, day(7, supply({ foodConsumed: 1 }))]), /Day 7: not enough unexpired food/);
});

test('FIFO consumes oldest unexpired named batches and same-day forage precedes consumption', () => {
  const logs = [day(4, supply({ foodConsumed: 6, waterConsumed: 4 })), day(0, supply({ foods: [food('old', 3)], water: 2 })), day(3, supply({ foods: [food('new', 5)], water: 4 })), day(5, supply({ foods: [food('today', 1)], foodConsumed: 2.5 }))];
  const before = structuredClone(logs), result = S.assertLedger(logs);
  assert.equal(result.food, 0.5); assert.equal(result.water, 2);
  assert.deepEqual(result.batches.map(batch => [batch.id, batch.remaining, batch.status]), [['old', 0, 'consumed'], ['new', 0, 'consumed'], ['today', 0.5, 'available']]);
  assert.deepEqual(result.days.map(entry => entry.day), [0, 3, 4, 5]);
  assert.deepEqual(logs, before, 'ledger never mutates session inputs');
  const sameDay = S.assertLedger([day(0, supply({ foods: [food('a', 1)], water: 1, foodConsumed: 1, waterConsumed: 1 }))]);
  assert.equal(sameDay.food, 0); assert.equal(sameDay.water, 0);
});

test('expired leftovers are skipped even across unrecorded days and future supplies cannot be borrowed', () => {
  const logs = [day(0, supply({ foods: [food('old', 4)], water: 2 })), day(7, supply({ foods: [food('fresh', 3)] })), day(10, supply({ foodConsumed: 2, waterConsumed: 1 })), day(20, supply({ foods: [food('future', 10)], water: 8 }))];
  const result = S.ledger(logs, 10);
  assert.equal(result.food, 1); assert.equal(result.water, 1); assert.equal(result.batches.length, 2);
  assert.deepEqual(result.batches.map(batch => batch.status), ['expired', 'available']);
  assert.equal(S.ledger(logs, 6).food, 4);
  assert.equal(S.ledger(logs, 8).food, 3);
  assert.equal(S.ledger([day(5, supply({ foods: [food('future', 2)] }))], 0).food, 0);
  const impossible = [day(0, supply({ foodConsumed: 2, waterConsumed: 3 })), day(1, supply({ foods: [food('future', 4)], water: 4 }))];
  const unavailable = S.ledger(impossible);
  assert.deepEqual(unavailable.errors, [{ day: 0, resource: 'food', requested: 2, available: 0 }, { day: 0, resource: 'water', requested: 3, available: 0 }]);
  assert.equal(unavailable.days[0].foodRemaining, 0); assert.equal(unavailable.days[0].waterRemaining, 0);
  assert.throws(() => C.validateSession(session(impossible), MAP), /Day 0/);
});

test('thousandths arithmetic is exact across repeated fractional consumption', () => {
  const result = S.assertLedger([day(0, supply({ foods: [food('a', 0.3), food('b', 0.007)], water: 0.307, foodConsumed: 0.1, waterConsumed: 0.1 })), day(1, supply({ foodConsumed: 0.2, waterConsumed: 0.2 })), day(2, supply({ foodConsumed: 0.006, waterConsumed: 0.006 }))]);
  assert.equal(result.food, 0.001); assert.equal(result.water, 0.001);
  assert.deepEqual(result.batches.map(batch => batch.remaining), [0, 0.001]);
});

test('retroactive deletion, quantity change and day reorganization cannot invalidate later consumption', () => {
  const original = [day(0, supply({ foods: [food('fish', 6)], water: 10 })), day(6, supply({ foodConsumed: 5, waterConsumed: 8 }))];
  assert.doesNotThrow(() => C.validateSession(session(original), MAP));
  for (const edited of [original.slice(1), [{ ...original[0], day: 8 }, original[1]], [original[0], { ...original[1], day: 8 }], [day(0, supply({ foods: [food('fish', 4)], water: 10 })), original[1]], [day(0, supply({ foods: [food('fish', 6)], water: 2 })), original[1]]]) assert.throws(() => C.validateSession(session(edited), MAP), /not enough/);
  const renamed = structuredClone(original); renamed[0].supplies.foods[0].name = '咸鱼';
  assert.equal(C.validateSession(session(renamed), MAP).tripDays[0].supplies.foods[0].name, '咸鱼');
  assert.doesNotThrow(() => C.validateSession(session(original.slice(0, 1)), MAP));
});

test('global food IDs are unique and large day numbers use exact subtraction for expiry', () => {
  assert.throws(() => C.validateSession(session([day(0, supply({ foods: [food('same', 1)] })), day(1, supply({ foods: [food('same', 1)] }))]), MAP), /duplicate ID/);
  const at = C.MAX_TRIP_DAY - 3;
  const result = S.ledger([day(at, supply({ foods: [food('last', 1)] }))], C.MAX_TRIP_DAY);
  assert.equal(result.food, 1); assert.equal(result.batches[0].expiresDay, null);
  const expired = S.ledger([day(C.MAX_TRIP_DAY - 7, supply({ foods: [food('last', 1)] }))], C.MAX_TRIP_DAY);
  assert.equal(expired.food, 0); assert.equal(expired.batches[0].expiresDay, C.MAX_TRIP_DAY);
  for (const asOf of [-1, 0.5, Infinity, '1']) assert.throws(() => S.ledger([], asOf));
  assert.throws(() => S.ledger([day(0), day(0)]), /duplicate day/);
});

test('browser and Node use the same supplies ledger and session validation', async () => {
  const context = vm.createContext({});
  vm.runInContext(await fs.readFile(path.join(__dirname, '../../src/shared/supplies-core.js'), 'utf8'), context);
  vm.runInContext(await fs.readFile(path.join(__dirname, '../../src/shared/core.js'), 'utf8'), context);
  const input = session([day(0, supply({ foods: [food('a', 3)], water: 4 })), day(1, supply({ foodConsumed: 1, waterConsumed: 1 }))]);
  assert.equal(JSON.stringify(context.MapJourneySuppliesCore.ledger(input.tripDays)), JSON.stringify(S.ledger(input.tripDays)));
  assert.equal(JSON.stringify(context.MapJourneyCore.validateSession(input, MAP)), JSON.stringify(C.validateSession(input, MAP)));
});

test('editors save shared supplies and guests read persistent records without write access', async t => {
  const { api, env, cookie, advance } = await setup(t);
  let campaign = (await call(api.campaign)).body;
  campaign.session.tripDays = [day(0, supply({ foods: [food('fruit', 10, '果实')], water: 6 })), day(1, supply({ foodConsumed: 4, waterConsumed: 2 }))];
  let result = await save(api, cookie, campaign); assert.equal(result.statusCode, 200);
  campaign = result.body;
  const freshRead = (await call(createAPI({ env }).campaign)).body;
  assert.deepEqual(freshRead.session.tripDays, campaign.session.tripDays);
  assert.equal(S.ledger(freshRead.session.tripDays).food, 6);
  campaign.session.tripDays[1].supplies.foodConsumed = 5;
  assert.equal((await save(api, undefined, campaign)).statusCode, 401);
  assert.equal((await call(api.campaign, { method: 'PUT', cookie, body: campaign, origin: 'https://elsewhere.example' })).statusCode, 403);
  advance((SESSION_SECONDS + 1) * 1000);
  assert.equal((await save(api, cookie, campaign)).statusCode, 401);
  assert.equal((await call(api.campaign)).body.revision, 1);
});

test('old-client omission preserves supplies and explicit empty record clears them', async t => {
  const { api, cookie } = await setup(t);
  let campaign = (await call(api.campaign)).body;
  const supplies = supply({ foods: [food('a', 2)], water: 4 });
  campaign.session.tripDays = [day(0, supplies, { participants: ['游侠'], attachments: [] })];
  campaign = (await save(api, cookie, campaign)).body;
  delete campaign.session.tripDays[0].supplies;
  delete campaign.session.tripDays[0].participants;
  campaign.session.tripDays[0].note = 'An old client changed notes';
  campaign = (await save(api, cookie, campaign)).body;
  assert.deepEqual(campaign.session.tripDays[0].supplies, supplies);
  assert.deepEqual(campaign.session.tripDays[0].participants, ['游侠']);
  campaign.session.tripDays[0].supplies = S.empty();
  const cleared = await save(api, cookie, campaign);
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(cleared.body.session.tripDays[0].supplies, S.empty());
});

test('server rejects overdrafts and retroactive invalidation before advancing revision', async t => {
  const { api, cookie } = await setup(t);
  let campaign = (await call(api.campaign)).body;
  campaign.session.tripDays = [day(0, supply({ foods: [food('a', 5)], water: 4 })), day(6, supply({ foodConsumed: 3, waterConsumed: 2 }))];
  campaign = (await save(api, cookie, campaign)).body;
  for (const change of [draft => { draft.tripDays[0].supplies.foods[0].amount = 1; }, draft => { draft.tripDays.shift(); }, draft => { draft.tripDays[1].day = 8; }, draft => { draft.tripDays[1].supplies.waterConsumed = 5; }]) {
    const proposed = structuredClone(campaign); change(proposed.session);
    const rejected = await save(api, cookie, proposed);
    assert.equal(rejected.statusCode, 400); assert.equal(rejected.body.error, 'invalid_session'); assert.match(rejected.body.message, /not enough/);
  }
  assert.equal((await call(api.campaign)).body.revision, 1);
  const stale = structuredClone(campaign); campaign.session.tripDays[1].supplies.foodConsumed = 4;
  const updated = await save(api, cookie, campaign); assert.equal(updated.statusCode, 200);
  const conflict = await save(api, cookie, stale); assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.campaign.session.tripDays[1].supplies.foodConsumed, 4);
});
