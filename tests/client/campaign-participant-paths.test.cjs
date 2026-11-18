'use strict';
const { sourcePath } = require('../helpers/source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { C, Element: BaseElement } = require('../helpers/campaign-game-log.cjs');
const manifest = require('../../examples/demo-map/map.json');
const root = path.resolve(__dirname, '../..');
const config = { ...manifest, fogHexes: manifest.fog.cells, tags: [] };
const day = (number, hex = null, participants) => ({ id: `day-${number}`, day: number, note: '', hex,
  ...(participants === undefined ? {} : { participants }) });
const plain = value => JSON.parse(JSON.stringify(value));

class Element extends BaseElement {
  constructor(tag = 'div') {
    super(tag); this.style = { setProperty() {} }; this.clientWidth = 390; this.clientHeight = 844;
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name), toggle(name, force) { const show = force ?? !classes.has(name); show ? classes.add(name) : classes.delete(name); return show; } };
  }
  set innerHTML(value) { throw new Error(`Names must never use HTML interpolation: ${value}`); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  setAttribute(key, value) { super.setAttribute(key, String(value)); }
  contains(element) { return element != null && descendants(this).includes(element); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() {} matches() { return false; }
}

const I = { t: (value, data = {}) => value.replace(/\{(\w+)\}/g, (match, key) => String(data[key] ?? match)), number: String, text: value => value };
const descendants = element => [element, ...element.children.flatMap(descendants)];
const buttons = element => element.querySelectorAll('button');
const button = (element, label) => { const found = buttons(element).find(node => node.textContent === label); assert.ok(found, `Missing button: ${label}`); return found; };
const pins = layer => descendants(layer).filter(node => node.attributes['data-trip-id']);
const camps = layer => pins(layer).filter(node => (node.attributes.class || '').split(' ').includes('journey-camp'));
const lines = layer => layer.children[0]?.children || [];

function baseContext(extraWindow = {}) {
  const document = { activeElement: null };
  const createElement = tag => { const element = new Element(tag); element.ownerDocument = document; return element; };
  Object.assign(document, { createElement, createElementNS: (_, tag) => createElement(tag), createDocumentFragment: () => createElement('#fragment') });
  return vm.createContext({ window: { MapJourneyI18n: I, ...extraWindow }, document });
}
function load(context, filename) { return vm.runInContext(fs.readFileSync(sourcePath(filename), 'utf8'), context); }
function filterHarness() {
  const context = baseContext(), target = new Element(), selections = [];
  load(context, 'participant-paths.js');
  const controller = context.window.MapJourneyParticipantPaths.create({ core: C, root: target, onSelect: name => selections.push(name) });
  return { controller, target, selections, document: context.document };
}
function renderer() {
  const context = baseContext(), layer = new Element('g'), opened = [];
  load(context, 'journey-view.js');
  const controller = context.window.MapJourneyJourneyView.create({ core: C, config, layer, onOpenDay: id => opened.push(id) });
  return { controller, layer, opened };
}

test('character filters are guest-accessible and leave shared logs unchanged', async () => {
  const h = filterHarness(), logs = [day(0, '30,10', ['Alice']), day(1, '30,11', ['Bob'])], before = JSON.stringify(logs);
  h.controller.update(logs);
  assert.equal(h.target.hidden, false);
  assert.equal(button(h.target, 'Alice').disabled, false);
  await button(h.target, 'Alice').click();
  assert.equal(h.controller.getValue(), 'Alice');
  assert.equal(button(h.target, 'Alice').getAttribute('aria-pressed'), 'true');
  assert.equal(button(h.target, 'Whole journey').getAttribute('aria-pressed'), 'false');
  await button(h.target, 'Whole journey').click();
  assert.equal(h.controller.getValue(), null);
  assert.deepEqual(h.selections, ['Alice', null]);
  assert.equal(JSON.stringify(logs), before);
});

test('character route tags stay alphabetized after selection without changing shared names', async () => {
  const h = filterHarness(), logs = [day(0, null, ['Zelda', 'Player 10', 'bob', 'ALICE', 'Player 2', '张三', '阿兰', '李明'])];
  const before = plain(logs);
  const expected = ['Whole journey', '阿兰', '李明', '张三', 'ALICE', 'bob', 'Player 2', 'Player 10', 'Zelda'];
  h.controller.update(logs);
  assert.deepEqual(buttons(h.target).map(node => node.textContent), expected);
  await button(h.target, 'Zelda').click();
  assert.deepEqual(buttons(h.target).map(node => node.textContent), expected, 'selected tags keep their alphabetical position');
  assert.equal(button(h.target, 'Zelda').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(logs, before);
});

test('character names render as inert text, including markup-like input', async () => {
  const h = filterHarness(), name = '<img src=x onerror=alert(1)>';
  h.controller.update([day(0, null, [name])]);
  const selected = button(h.target, name);
  assert.equal(selected.title, name);
  assert.equal(selected.children.length, 0);
  await selected.click();
  const status = h.target.children.find(node => node.getAttribute('role') === 'status');
  assert.match(status.textContent, /^<img src=x onerror=alert\(1\)>: 1 days · 0 mapped$/);
  assert.equal(h.target.querySelectorAll('img').length, 0);
});

test('search uses normalized names and keeps the selected route reachable', async () => {
  const h = filterHarness(), logs = [day(0, null, ['Éowyn', 'Bob'])];
  h.controller.update(logs, ' e\u0301OW ');
  assert.deepEqual(buttons(h.target).map(node => node.textContent), ['Whole journey', 'Éowyn']);
  await button(h.target, 'Éowyn').click();
  h.controller.update(logs, 'bob');
  assert.deepEqual(buttons(h.target).map(node => node.textContent), ['Whole journey', 'Bob', 'Éowyn']);
  assert.equal(h.controller.getValue(), 'Éowyn');
  assert.equal(button(h.target, 'Éowyn').getAttribute('aria-pressed'), 'true');
});

test('live spelling changes reconcile the selection and removal returns to the whole journey', async () => {
  const h = filterHarness(); h.controller.update([day(0, null, ['Alice', 'Bob'])]);
  await button(h.target, 'Alice').click();
  h.controller.update([day(0, null, ['ALICE', 'Bob'])]);
  assert.equal(h.controller.getValue(), 'ALICE');
  assert.equal(button(h.target, 'ALICE').getAttribute('aria-pressed'), 'true');
  h.controller.update([day(0, null, ['Bob'])]);
  assert.equal(h.controller.getValue(), null);
  assert.equal(button(h.target, 'Whole journey').getAttribute('aria-pressed'), 'true');
  h.controller.update([day(0)]);
  assert.equal(h.target.hidden, true); assert.equal(h.target.children.length, 0);
  assert.deepEqual(h.selections, ['Alice'], 'live updates do not write selection changes back to the campaign');
});

test('keyboard focus survives selection, live name normalization and removal of the selected name', async () => {
  const h = filterHarness(); h.controller.update([day(0, null, ['Alice', 'Bob'])]);
  const oldButton = button(h.target, 'Alice'); oldButton.focus(); await oldButton.click();
  assert.equal(h.document.activeElement, button(h.target, 'Alice'));
  assert.notEqual(h.document.activeElement, oldButton, 'focus moves to the replacement DOM button');
  h.controller.update([day(0, null, ['ALICE', 'Bob'])]);
  assert.equal(h.document.activeElement, button(h.target, 'ALICE'));
  h.controller.update([day(0, null, ['Bob'])]);
  assert.equal(h.document.activeElement, button(h.target, 'Whole journey'));
  const search = new Element('input'); h.document.activeElement = search;
  h.controller.update([day(0, null, ['Bob'])], 'bob');
  assert.equal(h.document.activeElement, search, 'typing in search does not steal focus');
});

test('truncated matches explain how to narrow the list even when the current selection uses one slot', async () => {
  const h = filterHarness(), logs = [day(0, null, ['Zelda', ...Array.from({ length: 30 }, (_, i) => `Player ${i}`)])];
  h.controller.update(logs); h.controller.update(logs, 'Zelda'); await button(h.target, 'Zelda').click();
  h.controller.update(logs, 'Player');
  assert.equal(buttons(h.target).length, 31);
  assert.equal(button(h.target, 'Zelda').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(buttons(h.target).map(node => node.textContent),
    ['Whole journey', ...Array.from({ length: 29 }, (_, i) => `Player ${i}`), 'Zelda']);
  assert.ok(h.target.children.some(node => node.textContent === 'Type a name to narrow the list.'));
});

test('filtered renderer omits absent stops and never labels a historical character stop as current camp', () => {
  const h = renderer(), session = { ...C.freshSession(config), tripDays: [day(0, '30,10', ['Alice']), day(1, '30,12', ['Bob'])] };
  h.controller.render(session, 1, 'Alice');
  assert.deepEqual(pins(h.layer).map(node => node.attributes['data-trip-id']), ['day-0']);
  assert.equal(camps(h.layer).length, 0);
  assert.equal(pins(h.layer)[0].attributes['aria-label'], 'Day 0');
  h.controller.render(session, 1, 'Bob');
  assert.deepEqual(camps(h.layer).map(node => node.attributes['data-trip-id']), ['day-1']);
  session.tripDays.push(day(2, null, ['Alice']));
  h.controller.render(session, 1, 'Bob');
  assert.deepEqual(camps(h.layer).map(node => node.attributes['data-trip-id']), ['day-1'], 'notes-only days do not move the map camp');
});

test('filtered routes break at recorded absences and dash missing mapped days in both strokes', () => {
  const h = renderer(), session = { ...C.freshSession(config), tripDays: [day(0, '30,10', ['Alice']), day(1, null, ['Bob']),
    day(2, '30,12', ['Alice']), day(6, '30,16', ['Alice']), day(7, '30,18', ['Alice'])] };
  const route = h.controller.render(session, 2, 'Alice');
  assert.deepEqual(plain(route.segments.map(segment => [segment.from.day, segment.to.day])), [[2, 6], [6, 7]]);
  assert.equal(lines(h.layer).length, 4, 'only the two valid route segments have casing and foreground strokes');
  assert.deepEqual(lines(h.layer).map(node => node.getAttribute('stroke-dasharray')), ['8 10', '8 10', null, null]);
  assert.ok(lines(h.layer).every(node => node.getAttribute('vector-effect') === 'non-scaling-stroke'));
  assert.equal(route.visited.includes('30,11'), false, 'no explored hex is fabricated across a recorded absence');
});

test('filtered pins remain readable by keyboard and journey visibility stays authoritative', async () => {
  const h = renderer(), session = { ...C.freshSession(config), tripDays: [day(0, '30,10', ['Alice'])] };
  h.controller.render(session, 1, 'Alice');
  const pin = pins(h.layer)[0];
  assert.equal(pin.getAttribute('role'), 'button');
  assert.equal(pin.getAttribute('tabindex'), '0');
  await pin.emit('keydown', { key: 'Enter', stopPropagation() {} });
  assert.deepEqual(h.opened, ['day-0']);
  session.showJourney = false;
  const route = h.controller.render(session, 1, 'Alice');
  assert.equal(h.layer.children.length, 0); assert.equal(route.stops.length, 1);
});

async function appHarness(logs) {
  const nodes = new Map();
  for (const match of fs.readFileSync(sourcePath('index.html'), 'utf8').matchAll(/id="([^"]+)"/g)) {
    const element = new Element(); element.id = match[1]; nodes.set(match[1], element);
  }
  const $ = id => { assert.ok(nodes.has(id), `Missing page element ${id}`); return nodes.get(id); };
  let current = { ...C.freshSession(config), tripDays: structuredClone(logs), markers: [
    { hex: '30,15', title: 'Ancient ruin', note: 'Shared place note.', color: 'gold', kind: 'ruin' }
  ] }, subscriber, saves = 0;
  const initial = structuredClone(current), preferences = new Map();
  const sync = { canEdit: () => false, hasPending: () => false, getSnapshot: () => ({ session: current }),
    start: async () => current, subscribe: listener => { subscriber = listener; }, save: () => { saves++; },
    status: () => ({ editable: false, authenticated: false, mode: 'ready', pending: false, conflict: false }) };
  const context = baseContext({ MapJourneyCore: C, MAPJOURNEY_MAP: config, innerHeight: 844,
    matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {},
    CampaignClient: { create: () => sync }, CampaignMapTiles: { create: () => ({ ready: Promise.resolve(), paint() {} }) },
    MapJourneyLayers: { create: () => ({ element: new Element('g'), render() {} }) },
    MapJourneyMarkerUI: { colors: { gold: '#e7bd6a' }, icon: () => new Element('svg'), createPicker: () => ({ refresh() {} }) },
    MapJourneyGameLog: { create: () => ({ hasDraft: () => false, refresh() {}, updateAccess() {}, clearPlacement() {} }) },
    MapJourneyAdventureNotes: { create: () => ({ hasDraft: () => false, refresh() {}, updateAccess() {}, reset() {} }) },
    MapJourneySuppliesPage: { create: () => ({ hasDraft: () => false, refresh() {}, updateAccess() {}, reset() {} }) } });
  Object.assign(context.document, { getElementById: $, querySelectorAll: () => [], body: new Element('body'), documentElement: new Element('html'),
    activeElement: null, hidden: false, addEventListener() {} });
  Object.assign(context, { navigator: {}, localStorage: { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, ResizeObserver: class { observe() {} } });
  load(context, 'participant-paths.js'); load(context, 'journey-view.js');
  await load(context, 'app.js');
  const layer = descendants($('map-svg')).find(node => node.getAttribute('id') === 'map-journey');
  const markerLayer = descendants($('map-svg')).find(node => node.getAttribute('id') === 'map-markers');
  assert.ok(layer); assert.ok(markerLayer);
  return { $, layer, markerLayer, saves: () => saves, original: initial, shared: () => current,
    remote(logs) { current = { ...current, tripDays: structuredClone(logs) }; subscriber({ type: 'session', session: current }); } };
}

test('guest app selection changes only the displayed route and live removal restores the full route', async () => {
  const logs = [day(0, '30,10', ['Alice']), day(1, '30,12', ['Bob']), day(2, '30,14', ['Alice'])];
  const h = await appHarness(logs), originalMarkers = h.markerLayer.children;
  const explored = h.$('explored-count').textContent;
  await button(h.$('participant-paths'), 'Alice').click();
  assert.deepEqual(pins(h.layer).map(node => node.attributes['data-trip-id']), ['day-0', 'day-2']);
  assert.equal(lines(h.layer).length, 0, 'guest cannot see an invented connection across Alice’s absence');
  assert.equal(h.$('explored-count').textContent, explored, 'campaign exploration total does not become a character total');
  assert.equal(h.$('toggle-journal').classList.contains('has-character-path'), true);
  assert.equal(h.markerLayer.children, originalMarkers, 'ordinary place markers are untouched by character filtering');
  assert.equal(h.saves(), 0); assert.deepEqual(h.shared(), h.original);
  h.remote([day(0, '30,10', ['Bob']), day(1, '30,12', ['Bob']), day(2, '30,14', ['Bob'])]);
  assert.deepEqual(pins(h.layer).map(node => node.attributes['data-trip-id']), ['day-0', 'day-1', 'day-2']);
  assert.equal(lines(h.layer).length, 4);
  assert.equal(h.$('toggle-journal').classList.contains('has-character-path'), false);
  assert.equal(button(h.$('participant-paths'), 'Whole journey').getAttribute('aria-pressed'), 'true');
  assert.equal(h.saves(), 0);
});
