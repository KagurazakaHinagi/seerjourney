'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/shared/core.js');
const config = structuredClone(require('../fixtures/synthetic-grid.json'));
config.id = 'toa-chult-player-grid-v1';
config.name = 'Chult';
const grid = config.grid;
const marker = (hex = config.fogHexes[0]) => ({ hex, title: 'River camp', note: 'Water and shelter.\nReturn at dawn.', color: 'green', kind: 'camp' });
const tripDay = (day, hex = null, changes = {}) => ({ id: `trip-${day}`, day, note: '', hex, ...changes });
const session = changes => ({ ...C.freshSession(config), ...changes });
const inBounds = p => p.x >= grid.bounds.x && p.x <= grid.bounds.x + grid.bounds.width && p.y >= grid.bounds.y && p.y <= grid.bounds.y + grid.bounds.height;

test('all configured fog hexes are unique, valid, and hit their own centers', () => {
  assert.ok(config.fogHexes.length > 500, 'synthetic grid contains a substantial fog sample');
  assert.equal(new Set(config.fogHexes).size, config.fogHexes.length);
  for (const value of config.fogHexes) {
    const hex = C.parseKey(value, grid);
    assert.ok(hex, value);
    const p = C.center(hex.column, hex.row, grid);
    assert.equal(C.hexAt(p.x, p.y, grid)?.key, value);
  }
});

test('every in-frame hex center and interior vertex sample hits its own hex', () => {
  let checked = 0;
  for (let column = grid.minColumn; column <= grid.maxColumn; column++) {
    for (let row = grid.minRow; row <= grid.maxRow; row++) {
      if (!C.validCell(column, row, grid)) continue;
      const p = C.center(column, row, grid);
      const samples = [p, ...C.vertices(column, row, grid).map(([x, y]) => ({ x: p.x + (x - p.x) * .98, y: p.y + (y - p.y) * .98 }))];
      for (const sample of samples.filter(inBounds)) {
        assert.equal(C.hexAt(sample.x, sample.y, grid)?.key, C.key(column, row), JSON.stringify(sample));
        checked++;
      }
    }
  }
  assert.ok(checked > 40000);
});

test('map rectangle has no interior gaps in hex hit testing', () => {
  const bounds = grid.bounds;
  // A deterministic low-discrepancy sampling crosses edges, seas, and partial frame hexes.
  for (let i = 1; i <= 20000; i++) {
    const x = bounds.x + ((i * .61803398875) % 1) * bounds.width;
    const y = bounds.y + ((i * .41421356237) % 1) * bounds.height;
    assert.ok(C.hexAt(x, y, grid), `unselectable position ${x},${y}`);
  }
});

test('odd columns are half a row lower and clicks across sloping borders select neighbors', () => {
  const a = C.center(30, 40, grid), b = C.center(31, 40, grid);
  assert.ok(Math.abs(b.x - a.x - grid.columnStep) < 1e-9);
  assert.ok(Math.abs(b.y - a.y - grid.rowStep / 2) < 1e-9);
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const toward = (p, fraction) => ({ x: midpoint.x + (p.x - midpoint.x) * fraction, y: midpoint.y + (p.y - midpoint.y) * fraction });
  const nearA = toward(a, .001), nearB = toward(b, .001);
  assert.equal(C.hexAt(nearA.x, nearA.y, grid).key, '30,40');
  assert.equal(C.hexAt(nearB.x, nearB.y, grid).key, '31,40');
});

test('points outside the map, nonfinite coordinates, and malformed cell IDs are rejected', () => {
  const b = grid.bounds;
  for (const p of [[b.x - .01, b.y], [b.x, b.y - .01], [b.x + b.width + .01, b.y], [b.x, b.y + b.height + .01], [NaN, 1], [1, Infinity]]) {
    assert.equal(C.hexAt(...p, grid), null);
  }
  for (const value of ['', null, {}, '1.2,3', '30,40foo', '999,999', '__proto__', '30', '30,40,50']) assert.equal(C.parseKey(value, grid), null);
  assert.equal(C.parseKey('030,040', grid).key, '30,40');
  assert.equal(C.label(C.parseKey('30,40', grid)), 'C31 · R41');
});

test('one sparse brush segment visits every crossed row in travel order', () => {
  const from = C.center(30, 10, grid), to = C.center(30, 70, grid);
  const expected = Array.from({ length: 61 }, (_, i) => C.key(30, i + 10));
  assert.deepEqual(C.hexesAlongSegment(from, to, grid).map(hex => hex.key), expected);
  assert.deepEqual(C.hexesAlongSegment(to, from, grid).map(hex => hex.key), [...expected].reverse());
});

test('brush segments cross the sloping borders between both odd-column neighbors', () => {
  const from = C.center(30, 40, grid);
  for (const row of [39, 40]) {
    const to = C.center(31, row, grid);
    assert.deepEqual(C.hexesAlongSegment(from, to, grid).map(hex => hex.key), ['30,40', `31,${row}`]);
    assert.deepEqual(C.hexesAlongSegment(to, from, grid).map(hex => hex.key), [`31,${row}`, '30,40']);
  }
});

test('long diagonal brush strokes contain all dense samples and are independent of event frequency', () => {
  const from = C.center(8, 8, grid), to = C.center(70, 80, grid);
  const between = fraction => ({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction });
  const whole = C.hexesAlongSegment(from, to, grid).map(hex => hex.key);
  const dense = new Set();
  for (let i = 0; i <= 20000; i++) {
    const p = between(i / 20000);
    dense.add(C.hexAt(p.x, p.y, grid).key);
  }
  assert.ok([...dense].every(key => whole.includes(key)), 'no sampled hex is skipped');
  assert.equal(whole.length, new Set(whole).size, 'no duplicate cells');
  assert.ok(whole.length > 100, 'single event pair spans the map');
  assert.deepEqual(C.hexesAlongSegment(to, from, grid).map(hex => hex.key), [...whole].reverse());
  const subdivided = new Set();
  for (let i = 0; i < 40; i++) {
    for (const hex of C.hexesAlongSegment(between(i / 40), between((i + 1) / 40), grid)) subdivided.add(hex.key);
  }
  assert.deepEqual(subdivided, new Set(whole));
});

test('brush strokes are clipped to the map frame even when both endpoints lie outside it', () => {
  const b = grid.bounds, y = b.y + b.height * .413;
  const left = { x: b.x, y }, right = { x: b.x + b.width, y };
  const expected = C.hexesAlongSegment(left, right, grid);
  assert.ok(expected.length > 70);
  assert.deepEqual(C.hexesAlongSegment({ x: b.x - 1000, y }, { x: b.x + b.width + 1000, y }, grid), expected);
  assert.ok(expected.every(hex => C.validCell(hex.column, hex.row, grid)));
  assert.deepEqual(C.hexesAlongSegment({ x: b.x - 1000, y: b.y - 1 }, { x: b.x + b.width + 1000, y: b.y - 1 }, grid), []);
});

test('brush traversal catches a tiny hex corner crossing between pointer samples', () => {
  const p = C.center(30, 40, grid);
  // This line clips only a fraction of a map pixel near the rightmost vertex.
  const x = p.x + grid.radiusX - .001;
  const from = { x, y: p.y - 25.25 }, to = { x, y: p.y + 25.75 };
  assert.ok(C.hexesAlongSegment(from, to, grid).some(hex => hex.key === '30,40'));
  assert.notEqual(C.hexAt(from.x, from.y, grid).key, '30,40');
  assert.notEqual(C.hexAt(to.x, to.y, grid).key, '30,40');
});

test('brush taps retain point hit semantics and invalid segments change no cells', () => {
  const p = C.center(30, 40, grid);
  assert.deepEqual(C.hexesAlongSegment(p, p, grid), [C.hexAt(p.x, p.y, grid)]);
  const edge = { x: p.x + grid.radiusX, y: p.y };
  assert.deepEqual(C.hexesAlongSegment(edge, edge, grid), [C.hexAt(edge.x, edge.y, grid)]);
  const outside = { x: grid.bounds.x - 1, y: grid.bounds.y - 1 };
  assert.deepEqual(C.hexesAlongSegment(outside, outside, grid), []);
  for (const invalid of [null, undefined, {}, { x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: '1', y: 1 }]) {
    assert.deepEqual(C.hexesAlongSegment(invalid, p, grid), []);
    assert.deepEqual(C.hexesAlongSegment(p, invalid, grid), []);
  }
  assert.deepEqual(C.hexesAlongSegment(p, p, null), []);
  assert.deepEqual(C.hexesAlongSegment(p, p, { ...grid, radiusX: 0 }), []);
});

test('portable sessions roundtrip revealed cells, Unicode notes, markers, and camera', () => {
  const input = session({ name: 'Chult — expedition 🧭', revealed: config.fogHexes.slice(0, 4), markers: [marker()], view: { x: -100.5, y: 180, scale: .28 } });
  input.markers[0].note += '\n遺跡を調べる 🐾';
  const output = C.validateSession(JSON.parse(JSON.stringify(input)), config);
  assert.deepEqual(output, input);
});

test('fresh sessions are independent and validate without any revealed cells', () => {
  const a = C.freshSession(config), b = C.freshSession(config);
  assert.notEqual(a.id, b.id);
  a.revealed.push(config.fogHexes[0]);
  a.tripDays.push(tripDay(0));
  assert.equal(b.revealed.length, 0);
  assert.deepEqual(b.tripDays, []);
  assert.equal(b.showJourney, true);
  assert.equal(b.version, 3);
  assert.deepEqual(C.validateSession(b, config), b);
});

test('foreign, future, malformed, and invalid reveal sessions fail before replacing state', () => {
  const samples = [null, [], {}, session({ version: 4 }), session({ mapId: 'different-map' }), session({ format: 'other' }),
    session({ name: '' }), session({ name: ' '.repeat(8) }), session({ name: 'a'.repeat(101) }),
    session({ revealed: {} }), session({ markers: null }), session({ revealed: ['999,999'] }), session({ revealed: ['10,10'] })];
  for (const value of samples) assert.throws(() => C.validateSession(value, config));
});

test('reveal IDs are deduplicated while duplicate marker cells are rejected', () => {
  const revealed = C.validateSession(session({ revealed: [config.fogHexes[0], config.fogHexes[0]] }), config).revealed;
  assert.deepEqual(revealed, [config.fogHexes[0]]);
  assert.throws(() => C.validateSession(session({ markers: [marker(), marker()] }), config), /duplicate/);
});

test('markers can be placed on charted ocean hexes as well as originally blank hexes', () => {
  const charted = '10,10';
  assert.equal(config.fogHexes.includes(charted), false);
  const output = C.validateSession(session({ markers: [marker(charted), marker()] }), config);
  assert.equal(output.markers.length, 2);
});

test('marker note/title limits and allowed symbols are validated', () => {
  for (const change of [{ hex: '1000,1000' }, { title: '' }, { title: ' ' }, { title: 'a'.repeat(121) }, { title: 12 },
    { note: 'a'.repeat(10001) }, { note: null }, { color: '#fff' }, { kind: 'unknown' }]) {
    assert.throws(() => C.validateSession(session({ markers: [{ ...marker(), ...change }] }), config));
  }
  assert.doesNotThrow(() => C.validateSession(session({ markers: [{ ...marker(), title: 'a'.repeat(120), note: 'x'.repeat(10000) }] }), config));
});

test('tomb bookmarks and grey colors survive portable session validation', () => {
  const input = session({ markers: [{ ...marker(), title: '古墓', color: 'grey', kind: 'tomb' }] });
  const output = C.validateSession(JSON.parse(JSON.stringify(input)), config);
  assert.deepEqual(output.markers, input.markers);
});

test('HTML-like notes remain inert strings, unknown object fields are dropped', () => {
  const suspicious = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
  const output = C.validateSession(session({ markers: [{ ...marker(), title: suspicious, note: suspicious, onclick: 'alert(1)' }], evil: true }), config);
  assert.equal(output.markers[0].title, suspicious);
  assert.equal(output.markers[0].note, suspicious);
  assert.equal(output.markers[0].onclick, undefined);
  assert.equal(output.evil, undefined);
});

test('invalid camera data is safely discarded while notes are retained', () => {
  for (const view of [{ x: Infinity, y: 0, scale: .1 }, { x: 0, y: NaN, scale: .1 }, { x: 0, y: 0, scale: -1 }, { x: 0, y: 0, scale: 100001 }, 'camera']) {
    const result = C.validateSession(session({ view, markers: [marker()] }), config);
    assert.equal(result.view, null);
    assert.equal(result.markers.length, 1);
  }
});

test('viewport dimensions survive session roundtrips across phone, tablet, and desktop sizes', () => {
  for (const [width, height] of [[390, 844], [1024, 768], [1440, 900], [744.5, 1024.5], [100000, 100000]]) {
    const input = session({ view: { x: -700, y: -1200, scale: .3, width, height }, markers: [marker()] });
    const output = C.validateSession(JSON.parse(JSON.stringify(input)), config);
    assert.deepEqual(output, input);
  }
});

test('legacy or invalid viewport dimensions preserve the valid camera and session data', () => {
  const camera = { x: -700, y: -1200, scale: .3 };
  for (const dimensions of [{}, { width: 390 }, { height: 844 }, { width: 0, height: 844 },
    { width: 390, height: -1 }, { width: Infinity, height: 844 }, { width: 390, height: NaN },
    { width: '390', height: 844 }, { width: 390, height: 100001 }, { width: 100001, height: 844 }]) {
    const output = C.validateSession(session({ view: { ...camera, ...dimensions }, markers: [marker()] }), config);
    assert.deepEqual(output.view, camera);
    assert.deepEqual(output.markers, [marker()]);
  }
});

test('trip days accept only nonnegative safe decimal integers with room for a next day', () => {
  for (const [input, expected] of [[0, 0], [-0, 0], ['0', 0], ['  00012\n', 12], [71, 71], [C.MAX_TRIP_DAY, C.MAX_TRIP_DAY], [String(C.MAX_TRIP_DAY), C.MAX_TRIP_DAY]]) {
    assert.equal(C.parseTripDay(input), expected);
  }
  for (const input of ['', ' ', '+1', '-0', '-1', '1e3', '1.0', '1.2', '0x10', '1,000', '1 2', '１２', null, undefined,
    true, false, {}, [], 1.5, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, String(Number.MAX_SAFE_INTEGER)]) {
    assert.equal(C.parseTripDay(input), null, String(input));
  }
});

test('next trip day and chronological sorting preserve gaps and do not reorder the stored entries', () => {
  const logs = [tripDay(12), tripDay(0), tripDay(4)];
  assert.equal(C.nextTripDay([]), 0);
  assert.equal(C.nextTripDay(logs), 13);
  assert.deepEqual(C.sortTripDays(logs).map(log => log.day), [0, 4, 12]);
  assert.deepEqual(logs.map(log => log.day), [12, 0, 4]);
  assert.equal(C.parseTripDay(C.nextTripDay([tripDay(C.MAX_TRIP_DAY)])), null, 'limit cannot produce another accepted day');
});

test('version 1 sessions migrate without altering fog, markers, notes, identity, or camera', () => {
  const original = session({ name: 'Old expedition', revealed: config.fogHexes.slice(0, 3), markers: [marker()],
    view: { x: -350, y: -1600, scale: .25, width: 390, height: 844 } });
  const legacy = { ...original, format: 'chult-expedition', version: 1 };
  delete legacy.tripDays; delete legacy.showJourney;
  const output = C.validateSession(JSON.parse(JSON.stringify(legacy)), config);
  assert.deepEqual(output, original);
  assert.equal(legacy.version, 1, 'validation does not mutate an imported file');
  const extraFields = C.validateSession({ ...legacy, tripDays: 'unknown v1 field', showJourney: false }, config);
  assert.deepEqual(extraFields.tripDays, []);
  assert.equal(extraFields.showJourney, true);
});

test('version 3 sessions roundtrip mapped and note-only days, Unicode notes, and hidden journey state', () => {
  const input = session({ revealed: config.fogHexes.slice(0, 2), markers: [marker()], showJourney: false,
    tripDays: [tripDay(12, '34,45', { note: 'Camp by the river.\n遺跡 🧭' }), tripDay(0, '34,39'), tripDay(4, null, { note: 'Rest day — location unknown.' })] });
  const output = C.validateSession(JSON.parse(JSON.stringify(input)), config);
  assert.deepEqual(output, input);
  assert.notEqual(output.tripDays, input.tripDays);
  assert.notEqual(output.tripDays[0], input.tripDays[0]);
});

test('version 3 requires log fields and rejects malformed, duplicate, and oversized trip entries', () => {
  for (const changes of [{ tripDays: undefined }, { tripDays: null }, { tripDays: {} }, { showJourney: undefined },
    { showJourney: null }, { showJourney: 1 }, { showJourney: 'true' }]) {
    assert.throws(() => C.validateSession(session(changes), config));
  }
  for (const log of [null, [], 'day', tripDay(0, null, { id: undefined }), tripDay(0, null, { id: '' }),
    tripDay(0, null, { id: ' ' }), tripDay(0, null, { id: 3 }), tripDay(0, null, { id: 'x'.repeat(201) }),
    tripDay(-1), tripDay(1.2), tripDay(Number.MAX_SAFE_INTEGER), tripDay(Infinity), tripDay(NaN), tripDay('1'),
    tripDay(0, null, { note: undefined }), tripDay(0, null, { note: null }), tripDay(0, null, { note: 'x'.repeat(20001) }),
    tripDay(0, undefined, { hex: undefined }), tripDay(0, ''), tripDay(0, '999,999'), tripDay(0, 123)]) {
    assert.throws(() => C.validateSession(session({ tripDays: [log] }), config));
  }
  assert.throws(() => C.validateSession(session({ tripDays: [tripDay(0), tripDay(1, null, { id: 'trip-0' })] }), config), /duplicate ID/);
  assert.throws(() => C.validateSession(session({ tripDays: [tripDay(0), tripDay(0, null, { id: 'another-id' })] }), config), /duplicate day/);
  assert.doesNotThrow(() => C.validateSession(session({ tripDays: [tripDay(C.MAX_TRIP_DAY, '10,10', { id: 'x'.repeat(200), note: 'x'.repeat(20000) })] }), config));
  const many = Array.from({ length: 10000 }, (_, day) => tripDay(day));
  assert.equal(C.validateSession(session({ tripDays: many }), config).tripDays.length, 10000);
  assert.throws(() => C.validateSession(session({ tripDays: [...many, tripDay(10000)] }), config), /too many trip days/);
});

test('trip notes remain inert, extra fields are removed, and mapped hex IDs are canonicalized', () => {
  const note = '<img src=x onerror="alert(1)">\n<script>doNotRun()</script>';
  const output = C.validateSession(session({ tripDays: [tripDay(0, '034,039', { note, onclick: 'doNotRun()' })] }), config);
  assert.deepEqual(output.tripDays, [tripDay(0, '34,39', { note })]);
});

test('journeys connect mapped days chronologically across gaps and note-only entries', () => {
  const logs = [tripDay(14, '34,45'), tripDay(100, null), tripDay(0, '34,39'), tripDay(6, null), tripDay(9, '34,42')];
  const result = C.journey(logs, grid);
  assert.deepEqual(result.stops.map(stop => stop.day), [0, 9, 14]);
  assert.deepEqual(result.segments.map(segment => [segment.from.day, segment.to.day]), [[0, 9], [9, 14]]);
  assert.deepEqual(result.visited, Array.from({ length: 7 }, (_, row) => `34,${row + 39}`));
  assert.equal(result.stops.at(-1).day, 14, 'latest mapped stop remains camp when a later day has no location');
  for (const stop of result.stops) {
    const hex = C.parseKey(stop.hex, grid);
    assert.deepEqual({ x: stop.x, y: stop.y }, C.center(hex.column, hex.row, grid));
  }
  assert.deepEqual(result.segments[0].hexes.map(hex => hex.key), ['34,39', '34,40', '34,41', '34,42']);
  assert.equal(logs[0].x, undefined, 'route derivation does not mutate log entries');
  assert.deepEqual(logs.map(log => log.day), [14, 100, 0, 6, 9]);
});

test('journey hex counts include isolated stops and count revisited hexes only once', () => {
  assert.deepEqual(C.journey([], grid), { stops: [], segments: [], visited: [] });
  assert.deepEqual(C.journey([tripDay(0), tripDay(3)], grid), { stops: [], segments: [], visited: [] });
  assert.deepEqual(C.journey([tripDay(0, '34,39')], grid).visited, ['34,39']);
  const result = C.journey([tripDay(0, '34,39'), tripDay(2, '34,42'), tripDay(4, '34,39'), tripDay(5, '34,39')], grid);
  assert.equal(result.stops.length, 4);
  assert.equal(result.segments.length, 3);
  assert.deepEqual(result.visited, ['34,39', '34,40', '34,41', '34,42']);
  assert.deepEqual(result.segments[2].hexes.map(hex => hex.key), ['34,39']);
  assert.deepEqual(C.journey([tripDay(0, '2,1')], grid).visited, ['2,1'], 'partial frame hexes count as isolated stops');
});

test('editing a day number reorders route segments and changes the latest mapped stop', () => {
  const logs = [tripDay(0, '34,39'), tripDay(4, '34,42'), tripDay(8, '36,42')];
  const original = C.journey(logs, grid);
  const edited = C.journey(logs.map(log => log.day === 4 ? { ...log, day: 12 } : log), grid);
  assert.deepEqual(original.segments.map(segment => [segment.from.id, segment.to.id]), [['trip-0', 'trip-4'], ['trip-4', 'trip-8']]);
  assert.deepEqual(edited.segments.map(segment => [segment.from.id, segment.to.id]), [['trip-0', 'trip-8'], ['trip-8', 'trip-4']]);
  assert.equal(original.stops.at(-1).hex, '36,42');
  assert.equal(edited.stops.at(-1).hex, '34,42');
});

const squareGrid = {
  type: 'square', originX: 25, originY: 25, radiusX: 25, radiusY: 25,
  columnStep: 50, rowStep: 50, minColumn: 0, maxColumn: 9, minRow: 0, maxRow: 7,
  bounds: { x: 0, y: 0, width: 500, height: 400 }
};
const squareConfig = {
  id: 'castle-floor', name: 'Castle floor', width: 500, height: 400, grid: squareGrid,
  fogHexes: Array.from({ length: 80 }, (_, i) => `${i % 10},${Math.floor(i / 10)}`)
};

test('square metadata drives centers, polygon corners, hit testing, and map extents', () => {
  assert.deepEqual(C.center(3, 5, squareGrid), { x: 175, y: 275 });
  assert.deepEqual(C.vertices(0, 0, squareGrid), [[0, 0], [50, 0], [50, 50], [0, 50]]);
  assert.equal(C.points(0, 0, squareGrid).split(' ').length, 4);
  for (const key of squareConfig.fogHexes) {
    const cell = C.parseKey(key, squareGrid), p = C.center(cell.column, cell.row, squareGrid);
    for (const [dx, dy] of [[0, 0], [-24.9, -24.9], [24.9, 24.9], [-24.9, 24.9], [24.9, -24.9]]) {
      assert.equal(C.cellAt(p.x + dx, p.y + dy, squareGrid)?.key, key);
    }
  }
  assert.equal(C.cellAt(500, 400, squareGrid).key, '9,7');
  assert.equal(C.cellAt(500.1, 400, squareGrid), null);
  assert.equal(C.parseKey('10,0', squareGrid), null);
  assert.equal(C.cellAt, C.hexAt, 'legacy geometry names are aliases');
  assert.equal(C.cellsAlongSegment, C.hexesAlongSegment);
});

test('square strokes and journeys include every crossed cell and shared border', () => {
  const from = C.center(0, 2, squareGrid), to = C.center(9, 2, squareGrid);
  assert.deepEqual(C.cellsAlongSegment(from, to, squareGrid).map(cell => cell.key), Array.from({ length: 10 }, (_, i) => `${i},2`));
  const diagonal = C.cellsAlongSegment(C.center(0, 0, squareGrid), C.center(4, 4, squareGrid), squareGrid).map(cell => cell.key);
  assert.deepEqual(new Set(diagonal), new Set(['0,0', '0,1', '1,0', '1,1', '1,2', '2,1', '2,2', '2,3', '3,2', '3,3', '3,4', '4,3', '4,4']));
  const reversed = C.cellsAlongSegment(C.center(4, 4, squareGrid), C.center(0, 0, squareGrid), squareGrid).map(cell => cell.key);
  assert.deepEqual(reversed, [...diagonal].reverse());
  assert.deepEqual(C.cellsAlongSegment({ x: -1000, y: 125 }, { x: 1000, y: 125 }, squareGrid).map(cell => cell.key), Array.from({ length: 10 }, (_, i) => `${i},2`));
  const border = C.cellsAlongSegment({ x: 25, y: 50 }, { x: 225, y: 50 }, squareGrid);
  assert.equal(border.length, 10, 'a stroke on a shared edge touches both adjacent rows');
  assert.deepEqual(C.journey([tripDay(0, '0,2'), tripDay(2, '9,2')], squareGrid).visited, Array.from({ length: 10 }, (_, i) => `${i},2`));
});

const pointyGrid = {
  type: 'hex', orientation: 'pointy-top', offset: 'odd-row-right',
  originX: grid.originY, originY: grid.originX, radiusX: grid.radiusY, radiusY: grid.radiusX,
  columnStep: grid.rowStep, rowStep: grid.columnStep,
  minColumn: grid.minRow, maxColumn: grid.maxRow, minRow: grid.minColumn, maxRow: grid.maxColumn,
  bounds: { x: grid.bounds.y, y: grid.bounds.x, width: grid.bounds.height, height: grid.bounds.width }
};

test('pointy hex grids transpose flat hex geometry and shift odd rows right', () => {
  assert.deepEqual(C.center(40, 30, pointyGrid), { x: C.center(30, 40, grid).y, y: C.center(30, 40, grid).x });
  const a = C.center(40, 30, pointyGrid), b = C.center(40, 31, pointyGrid);
  assert.ok(Math.abs(b.x - a.x - pointyGrid.columnStep / 2) < 1e-9);
  assert.ok(Math.abs(b.y - a.y - pointyGrid.rowStep) < 1e-9);
  const bounds = pointyGrid.bounds;
  for (let i = 1; i <= 5000; i++) {
    const x = bounds.x + ((i * .61803398875) % 1) * bounds.width;
    const y = bounds.y + ((i * .41421356237) % 1) * bounds.height;
    const hit = C.cellAt(x, y, pointyGrid), original = C.cellAt(y, x, grid);
    assert.ok(hit);
    assert.equal(hit.column, original.row);
    assert.equal(hit.row, original.column);
  }
  for (const [x, y] of C.vertices(40, 30, pointyGrid)) {
    assert.equal(C.cellAt(a.x + (x - a.x) * .98, a.y + (y - a.y) * .98, pointyGrid).key, '40,30');
  }
});

test('pointy hex segment traversal stays complete and independent of pointer event frequency', () => {
  const from = C.center(10, 10, pointyGrid), to = C.center(80, 70, pointyGrid);
  const between = fraction => ({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction });
  const whole = C.cellsAlongSegment(from, to, pointyGrid).map(cell => cell.key);
  for (let i = 0; i <= 10000; i++) {
    const p = between(i / 10000);
    assert.ok(whole.includes(C.cellAt(p.x, p.y, pointyGrid).key));
  }
  assert.deepEqual(C.cellsAlongSegment(to, from, pointyGrid).map(cell => cell.key), [...whole].reverse());
  const split = new Set();
  for (let i = 0; i < 30; i++) {
    for (const cell of C.cellsAlongSegment(between(i / 30), between((i + 1) / 30), pointyGrid)) split.add(cell.key);
  }
  assert.deepEqual(split, new Set(whole));
});

test('even-offset hex grids honor parity, including negative indices', () => {
  const flat = { ...grid, offset: 'even-column-down' };
  assert.equal(C.center(-2, 0, flat).y, flat.originY + flat.rowStep / 2);
  assert.equal(C.center(-1, 0, flat).y, flat.originY);
  const pointy = { ...pointyGrid, offset: 'even-row-right' };
  assert.equal(C.center(0, -2, pointy).x, pointy.originX + pointy.columnStep / 2);
  assert.equal(C.center(0, -1, pointy).x, pointy.originX);
  for (const selectedGrid of [flat, pointy]) {
    for (const [column, row] of [[30, 30], [31, 31], [30, 31], [31, 30]]) {
      const p = C.center(column, row, selectedGrid);
      assert.equal(C.cellAt(p.x, p.y, selectedGrid).key, `${column},${row}`);
    }
  }
});

test('map-specific sessions preserve square-map notes and large camera scales', () => {
  const input = { ...C.freshSession(squareConfig), revealed: ['0,0', '4,7'], markers: [marker('4,7')],
    tripDays: [tripDay(0, '0,0'), tripDay(2, '4,7')], view: { x: 15, y: -200, scale: 25 } };
  assert.equal(input.name, 'Castle floor expedition');
  assert.equal(input.mapId, 'castle-floor');
  assert.equal(input.format, 'mapjourney-session');
  assert.equal(input.version, 3);
  assert.deepEqual(C.validateSession(JSON.parse(JSON.stringify(input)), squareConfig), input);
  assert.throws(() => C.validateSession(input, { ...squareConfig, id: 'another-floor' }), /different map/);
  assert.equal(C.freshSession().name, 'New expedition');
});

test('legacy Chult sessions migrate only to an explicitly compatible map', () => {
  const original = session({ revealed: config.fogHexes.slice(0, 2), markers: [marker()],
    tripDays: [tripDay(0, '34,39'), tripDay(3, null)], showJourney: false });
  const legacy = { ...original, format: 'chult-expedition', version: 2 };
  const renamedMap = { ...config, id: 'chult', legacyIds: ['toa-chult-player-grid-v1'] };
  assert.deepEqual(C.validateSession(legacy, config), original);
  assert.deepEqual(C.validateSession(legacy, renamedMap), { ...original, mapId: 'chult' });
  assert.throws(() => C.validateSession(legacy, squareConfig), /Chult map/);
  assert.throws(() => C.validateSession(legacy, { ...config, id: 'unrelated-map' }), /Chult map/);
  assert.throws(() => C.validateSession({ ...legacy, mapId: 'another-map' }, renamedMap), /supported SeerJourney/);
  assert.throws(() => C.validateSession(original, renamedMap), /different map/, 'legacy aliases cannot redirect modern sessions');
  assert.equal(legacy.version, 2, 'migration leaves the source backup unchanged');
});
