'use strict';
const { sourcePath } = require('../helpers/source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../../src/shared/core.js');
const M = require('../../src/shared/map-mod.js');
const legacy = require('../fixtures/synthetic-grid.json');
const directory = path.join(__dirname, '../../examples/demo-map');
const source = JSON.parse(fs.readFileSync(path.join(directory, 'map.json'), 'utf8'));
const portable = { ...source, assets: Object.fromEntries(Object.entries(source.assets).map(([id, file]) => [id,
  `data:image/${path.extname(file) === '.png' ? 'png' : 'jpeg'};base64,${fs.readFileSync(path.join(directory, file)).toString('base64')}`])) };
const config = M.validate(portable);

// Read encoded dimensions without adding an image-decoder dependency. The
// browser import additionally decodes every image before installing the mod.
function rasterSize(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'assets must be PNG or JPEG');
  for (let offset = 2; offset + 3 < bytes.length;) {
    assert.equal(bytes[offset++], 0xff, 'JPEG segment starts with a marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if ([0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7].includes(marker)) continue;
    const length = bytes.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= bytes.length, 'JPEG segment is within the asset');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    if (marker === 0xda) break;
    offset += length;
  }
  assert.fail('JPEG asset has no supported frame dimensions');
}

test('the demo map portable package matches its editable metadata and browser-safe raster assets', () => {
  const { assets: sourceAssets, ...sourceMetadata } = source;
  const { assets: portableAssets, ...portableMetadata } = portable;
  assert.deepEqual(portableMetadata, sourceMetadata);
  assert.deepEqual(Object.keys(portableAssets).sort(), Object.keys(sourceAssets).sort());
  assert.ok(Buffer.byteLength(JSON.stringify(portable)) < M.MAX_FILE_BYTES);
  for (const [id, relativePath] of Object.entries(sourceAssets)) {
    const bytes = fs.readFileSync(path.join(directory, relativePath));
    assert.ok(Buffer.from(portableAssets[id].split(',')[1], 'base64').equals(bytes), `${id} embeds its exact editable raster`);
    const size = rasterSize(bytes);
    assert.ok(size.width > 0 && size.height > 0 && size.width * size.height <= 100000000, `${id} fits the browser's decoded-image limit`);
  }
  assert.equal(config.id, 'demo-map');
  assert.equal(config.name, 'Demo expedition');
  assert.equal(config.revision, 1);
  assert.deepEqual(config.legacyIds, [], 'the demo must not claim another map expedition');
  assert.ok(config.fogImage?.startsWith('data:image/'));
  assert.notEqual(config.fogImage, config.backgroundImage);
  assert.equal(config.fogColor, null, 'the supplied FoW artwork provides terrain fog');
});

test('demo mod retains its declared geometry and fog cells', () => {
  assert.equal(config.width, source.width);
  assert.equal(config.height, source.height);
  assert.deepEqual(config.grid, { type: 'hex', ...legacy.grid });
  assert.deepEqual(config.scale, source.scale);
  assert.deepEqual(config.fogHexes, legacy.fogHexes);
  for (const key of config.fogHexes) {
    const cell = C.parseKey(key, config.grid);
    assert.ok(cell, key);
    const center = C.center(cell.column, cell.row, config.grid);
    assert.equal(C.cellAt(center.x, center.y, config.grid).key, key);
  }
});

function renderer() {
  class Element {
    constructor(tag) { this.tag = tag; this.attributes = new Map(); this.children = []; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    append(...nodes) {
      for (const node of nodes) {
        if (node.tag === 'fragment') this.append(...node.children);
        else { node.parentElement = this; this.children.push(node); }
      }
    }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  }
  const context = vm.createContext({ window: { MapJourneyI18n: require('../../src/client/i18n/i18n.js')({ languages: ['zh-CN'] }) }, document: {
    createElementNS: (_, tag) => new Element(tag), createDocumentFragment: () => new Element('fragment')
  } });
  for (const script of ['map-layers.js', 'journey-view.js']) vm.runInContext(fs.readFileSync(sourcePath(script), 'utf8'), context);
  return { layers: context.window.MapJourneyLayers.create(config, C),
    journey: context.window.MapJourneyJourneyView.create({ core: C, config, layer: new Element('g') }) };
}

const descendants = element => [element, ...element.children.flatMap(descendants)];
function assertState(element, revealed) {
  const nodes = descendants(element);
  assert.ok(nodes.find(node => node.tag === 'image' && node.getAttribute('href') === config.backgroundImage), 'demo terrain and its baked labels remain the base layer');
  const cover = nodes.find(node => node.tag === 'image' && node.getAttribute('href') === config.fogImage);
  assert.ok(cover, 'the demo fog image supplies the cover');
  const clipId = cover.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/)?.[1];
  const clip = nodes.find(node => node.tag === 'clipPath' && node.getAttribute('id') === clipId);
  assert.ok(clip);
  assert.equal(clip.children.length, config.fogHexes.length - revealed.length);
  const covered = new Set(clip.children.map(node => node.getAttribute('points')));
  for (const key of config.fogHexes) {
    const cell = C.parseKey(key, config.grid);
    assert.equal(covered.has(C.points(cell.column, cell.row, config.grid, .25)), !revealed.includes(key), `${key} terrain visibility`);
  }
  const boundsId = cover.parentElement.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/)?.[1];
  const bounds = nodes.find(node => node.tag === 'clipPath' && node.getAttribute('id') === boundsId);
  assert.ok(bounds);
  for (const [name, value] of Object.entries(config.grid.bounds)) assert.equal(bounds.children[0].getAttribute(name), String(value));
  const tags = nodes.filter(node => node.getAttribute('data-tag-id'));
  assert.deepEqual(tags.map(tag => tag.getAttribute('data-tag-id')).sort(), config.tags.map(tag => tag.id).sort());
  for (const tag of tags) assert.equal(tag.getAttribute('visibility'), 'visible', `${tag.getAttribute('data-tag-id')} remains known`);
}

test('reveal, refog and full reveal preserve terrain and overlays', () => {
  const { layers } = renderer();
  for (const revealed of [[], config.fogHexes.slice(0, 2), [], config.fogHexes]) {
    layers.render(revealed);
    assertState(layers.element, revealed);
  }
});

test('demo map day snapshots share the map terrain and label visibility', () => {
  const { journey } = renderer();
  const entry = { id: 'day-0', day: 0, note: '在河边扎营。', hex: '34,39' };
  for (const revealed of [[], ['34,39'], []]) {
    const session = { ...C.freshSession(config), tripDays: [entry], revealed };
    assertState(journey.snapshot(entry, session), revealed);
  }
});

test('sessions preserve annotations and routes while remaining isolated from original Chult saves', () => {
  const saved = { ...C.freshSession(config), name: 'Demo expedition 🧭', revealed: ['34,39', '34,40'],
    markers: [{ hex: '34,39', title: '河岸营地', note: '补充淡水。\n明天继续沿河前进。', kind: 'camp', color: 'green' }],
    tripDays: [
      { id: 'day-0', day: 0, note: '抵达营地。', hex: '34,39' },
      { id: 'day-1', day: 1, note: '原地休整。', hex: '34,39' },
      { id: 'day-3', day: 3, note: '仅记日志，未标位置。', hex: null },
      { id: 'day-5', day: 5, note: '上游的新发现。', hex: '34,45' }
    ], showJourney: false, view: { x: -1500.5, y: -2200.25, scale: .28, width: 390, height: 844 } };
  const before = JSON.stringify(saved);
  const restored = C.validateSession(JSON.parse(before), config);
  assert.deepEqual(restored, saved);
  assert.deepEqual(C.validateSession(JSON.parse(JSON.stringify(restored)), config), saved);
  assert.equal(C.nextTripDay(restored.tripDays), 6);
  assert.deepEqual(C.journey(restored.tripDays, config.grid).visited, Array.from({ length: 7 }, (_, i) => `34,${39 + i}`));
  const originalMap = { ...config, id: 'chult', legacyIds: ['toa-chult-player-grid-v1'] };
  const originalSession = { ...saved, mapId: 'chult' };
  const legacySession = { ...saved, format: 'chult-expedition', version: 2, mapId: 'toa-chult-player-grid-v1' };
  assert.throws(() => C.validateSession(originalSession, config), /different map/);
  assert.throws(() => C.validateSession(legacySession, config), /legacy expedition belongs to the Chult map/);
  assert.throws(() => C.validateSession(saved, originalMap), /different map/);
  assert.equal(JSON.stringify(saved), before, 'validation and failed cross-map imports do not mutate the expedition');
  assert.deepEqual(C.validateSession(originalSession, originalMap), originalSession, 'the original map still accepts its own expedition');
});
