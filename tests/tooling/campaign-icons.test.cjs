'use strict';
const { sourcePath, sourceText } = require('../helpers/source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const C = require('../../src/shared/core.js');
const S = require('../../src/shared/supplies-core.js');
const icons = require('../../assets/iconoir/ui-icons.json');
const manifest = require('../../examples/demo-map/map.json');
const root = path.resolve(__dirname, '../..');
const read = sourceText;
const attributes = element => Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => a.localeCompare(b)));
const geometry = element => ({ name: element.localName, attributes: attributes(element), children: [...element.children].map(geometry) });

function page(t) {
  const dom = new JSDOM(read('index.html'), { url: 'https://campaign.test/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  return dom.window;
}

function resolveUses(document, within = document) {
  const references = [...within.querySelectorAll('use')];
  assert.ok(references.length > 0);
  for (const use of references) {
    const href = use.getAttribute('href');
    assert.ok(href, 'SVG use needs a reference');
    if (href.startsWith('#')) assert.ok(document.getElementById(href.slice(1)), `Missing inline symbol ${href}`);
    else {
      const [file, id] = href.split('#');
      assert.match(file, /^assets\/iconoir\/[a-z-]+\.svg$/);
      const asset = new JSDOM(read(file), { contentType: 'image/svg+xml' });
      try { assert.ok(asset.window.document.getElementById(id), `Missing external symbol ${href}`); }
      finally { asset.window.close(); }
    }
  }
}

test('every UI symbol preserves the original Iconoir geometry, viewBox and stroke attributes', t => {
  const w = page(t), symbols = [...w.document.querySelectorAll('.icon-definitions symbol')];
  assert.deepEqual(symbols.map(symbol => symbol.id).sort(), Object.keys(icons).map(name => `i-${name}`).sort());
  for (const [name, filename] of Object.entries(icons)) {
    const original = new JSDOM(read(`assets/iconoir/${filename}`), { contentType: 'image/svg+xml' });
    try {
      const source = original.window.document.documentElement, symbol = w.document.getElementById(`i-${name}`);
      const expected = attributes(source);
      for (const key of ['width', 'height', 'xmlns']) delete expected[key];
      expected.id = symbol.id;
      assert.deepEqual(attributes(symbol), expected, filename);
      assert.equal(symbol.getAttribute('viewBox'), '0 0 24 24', filename);
      assert.equal(symbol.getAttribute('stroke-width'), '1.5', filename);
      assert.deepEqual([...symbol.children].map(geometry), [...source.children].map(geometry), filename);
    } finally { original.window.close(); }
  }
  resolveUses(w.document);
  // Runtime literal references and CSS masks must also be backed by shipped artwork.
  for (const script of w.document.querySelectorAll('script[src]')) {
    for (const [reference] of read(script.getAttribute('src')).matchAll(/#i-[a-z-]+/g)) {
      assert.ok(w.document.getElementById(reference.slice(1)), `${script.src}: ${reference}`);
    }
  }
  for (const sheet of w.document.querySelectorAll('link[rel="stylesheet"]')) {
    for (const [, file] of read(sheet.getAttribute('href')).matchAll(/url\(["']?(assets\/iconoir\/[^)"']+)/g)) {
      assert.ok(fs.existsSync(sourcePath(file)), file);
      assert.ok(Object.values(icons).includes(path.basename(file)), `${file} needs an offline asset mapping`);
    }
  }
});

test('generated editor controls use resolvable Iconoir symbols including picker checks', t => {
  const w = page(t), document = w.document, config = { ...manifest, tags: [], fogHexes: manifest.fog.cells };
  const session = C.freshSession(config);
  w.MapJourneyI18n = { t: value => value, number: String, text: value => value };
  w.MapJourneySuppliesCore = S;
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  for (const file of ['marker-ui.js', 'participant-tags.js', 'supply-fields.js', 'adventure-notes.js']) w.eval(read(file));
  for (const type of ['kind', 'color']) w.MapJourneyMarkerUI.createPicker(document.getElementById(`marker-${type}`), type);
  const participants = w.MapJourneyParticipants.create({ container: document.getElementById('log-participants'), core: C, canEdit: () => true });
  participants.setValue(['Ranger']);
  const supplies = document.createElement('section'); document.body.append(supplies);
  const fields = w.MapJourneySupplyFields.create({ root: supplies, prefix: 'icon-check', canEdit: () => true });
  fields.setValue({ foods: [{ name: 'Fruit', amount: 2 }], water: 1, foodConsumed: 0, waterConsumed: 0 });
  w.MapJourneyAdventureNotes.create({ core: C, getSession: () => session, canEdit: () => true, mutate: action => action(), ask: async () => true, toast() {}, openDialog() {} });
  const checks = document.querySelectorAll('.marker-picker-check use');
  assert.equal(checks.length, C.KINDS.length + C.COLORS.length);
  assert.ok([...checks].every(use => use.getAttribute('href') === '#i-check'));
  assert.equal(document.querySelector('.participant-remove use').getAttribute('href'), '#i-close');
  assert.equal(supplies.querySelector('.supply-remove use').getAttribute('href'), '#i-trash');
  resolveUses(document);
});

test('map and daily snapshot camps render the shared bonfire symbol without replacing day labels', t => {
  const w = page(t), document = w.document, config = { ...manifest, tags: [], fogHexes: manifest.fog.cells };
  w.MapJourneyI18n = { t: (value, data = {}) => value.replace(/\{(\w+)\}/g, (match, key) => String(data[key] ?? match)), number: String };
  w.MapJourneyLayers = { create: () => ({ element: document.createElementNS('http://www.w3.org/2000/svg', 'g'), render() {} }) };
  w.eval(read('journey-view.js'));
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g'); document.getElementById('map-svg').append(layer);
  const view = w.MapJourneyJourneyView.create({ core: C, config, layer, onOpenDay() {} });
  const session = { ...C.freshSession(config), tripDays: [{ id: 'day-7', day: 7, note: '', hex: '30,10' }] };
  view.render(session, 1);
  const snapshot = view.snapshot(session.tripDays[0], session); document.body.append(snapshot);
  for (const container of [layer, snapshot]) {
    const camp = container.querySelector('.journey-camp');
    assert.ok(camp);
    assert.equal(camp.querySelector('use').getAttribute('href'), '#i-camp');
    assert.equal(camp.querySelector('svg').getAttribute('viewBox'), '0 0 24 24');
    assert.match(camp.textContent, /Day 7/);
    resolveUses(document, container);
  }
});
