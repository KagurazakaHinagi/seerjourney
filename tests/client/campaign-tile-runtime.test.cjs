'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../src/client/features/map/campaign-map-tiles.js');
// Raster-independent fixture: exercises five density levels without shipping campaign artwork.
const sourceManifest = {
  version: 1, mapId: 'test-grid', width: 6000, height: 7800,
  sourceWidth: 3000, sourceHeight: 3900, tileSize: 512, overlap: 1, quality: 90,
  layers: { background: 'background/{id}/{column}-{row}.jpg', fog: 'fog/{id}/{column}-{row}.jpg' },
  levels: [16, 8, 4, 2, 1].map((divisor, index) => {
    const width = Math.ceil(3000 / divisor), height = Math.ceil(3900 / divisor);
    return { id: String(index), width, height, columns: Math.ceil(width / 512), rows: Math.ceil(height / 512) };
  })
};
const manifest = { ...sourceManifest, baseURL: 'https://campaign.example/campaign-map/tiles/' };
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, message || `${actual} ≈ ${expected}`);

test('tile selection uses actual raster density and caps phone DPR without upscaling source data', () => {
  const view = { x: -400, y: -600, scale: .1 };
  assert.equal(T.selectTiles(manifest, view, 390, 844, 1)[0].level, '2');
  assert.equal(T.selectTiles(manifest, view, 390, 844, 2)[0].level, '3');
  assert.deepEqual(T.selectTiles(manifest, view, 390, 844, 3), T.selectTiles(manifest, view, 390, 844, 2));
  assert.equal(T.selectTiles(manifest, { ...view, scale: 4 }, 390, 844, 3)[0].level, manifest.levels.at(-1).id);
  assert.equal(manifest.levels.at(-1).width, manifest.sourceWidth);
  assert.notEqual(manifest.sourceWidth, manifest.width, 'logical map coordinates differ from source pixels');
});

test('tile geometry covers the calibrated map edges and overlaps neighboring image samples', () => {
  for (const level of manifest.levels) {
    const tiles = T.selectTiles({ ...manifest, levels: [level] }, { x: 0, y: 0, scale: 1 }, manifest.width, manifest.height, 1);
    assert.equal(tiles.length, level.columns * level.rows);
    const sx = manifest.width / level.width, sy = manifest.height / level.height;
    for (const tile of tiles) {
      assert.ok(tile.x >= 0 && tile.y >= 0);
      assert.ok(tile.x + tile.width <= manifest.width + 1e-7);
      assert.ok(tile.y + tile.height <= manifest.height + 1e-7);
      near(tile.x, tile.column * manifest.tileSize * sx);
      near(tile.y, tile.row * manifest.tileSize * sy);
      if (tile.column === level.columns - 1) near(tile.x + tile.width, manifest.width);
      else near(tile.x + tile.width - (tile.column + 1) * manifest.tileSize * sx, manifest.overlap * sx);
      if (tile.row === level.rows - 1) near(tile.y + tile.height, manifest.height);
      else near(tile.y + tile.height - (tile.row + 1) * manifest.tileSize * sy, manifest.overlap * sy);
    }
  }
});

test('tile selection stays bounded to viewport coverage and returns none outside the map', () => {
  const view = { x: -2100, y: -3100, scale: .8 };
  const tiles = T.selectTiles(manifest, view, 390, 844, 3);
  assert.ok(tiles.length > 0 && tiles.length < manifest.levels.at(-1).columns * manifest.levels.at(-1).rows);
  const level = manifest.levels.find(value => value.id === tiles[0].level);
  const screenTileWidth = manifest.tileSize * manifest.width / level.width * view.scale;
  const screenTileHeight = manifest.tileSize * manifest.height / level.height * view.scale;
  assert.ok(tiles.length <= (Math.ceil(390 / screenTileWidth) + 3) * (Math.ceil(844 / screenTileHeight) + 3));
  for (const scale of [0, -1, NaN]) assert.deepEqual(T.selectTiles(manifest, { ...view, scale }, 390, 844), []);
  assert.deepEqual(T.selectTiles(manifest, view, 0, 844), []);
  assert.deepEqual(T.selectTiles(manifest, { x: 100000, y: 100000, scale: 1 }, 390, 844), []);
  assert.deepEqual(T.selectTiles(manifest, { x: -100000, y: -100000, scale: 1 }, 390, 844), []);
});

function harness() {
  class Element {
    constructor(tag) { this.tagName = tag; this.attributes = {}; this.children = []; this.parent = null; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    append(...elements) { for (const element of elements) { element.parent = this; this.children.push(element); } }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    images() { return this.children.flatMap(child => [...(child.tagName === 'image' ? [child] : []), ...child.images()]); }
  }
  const requests = [];
  class FakeImage {
    constructor() { this.onload = null; this.onerror = null; this._src = ''; this.pending = false; }
    set src(value) { this._src = value; this.pending = Boolean(value); if (value) requests.push(this); }
    get src() { return this._src; }
    load() { this.pending = false; this.onload?.(); }
    fail() { this.pending = false; this.onerror?.(); }
  }
  const renderer = T.create(manifest, { document: { createElementNS: (_, tag) => new Element(tag) }, Image: FakeImage });
  const pending = () => requests.filter(image => image.pending);
  const flush = () => { for (let count = 0; pending().length; count++) { assert.ok(count < 100, 'loading queue must terminate'); pending()[0].load(); } };
  return { renderer, requests, pending, flush };
}

test('background and fog appear atomically only after both images load', async () => {
  const h = harness();
  let ready = false; h.renderer.ready.then(() => { ready = true; });
  assert.equal(h.pending().length, 2);
  h.pending()[0].load();
  assert.equal(h.renderer.background.images().length, 0);
  assert.equal(h.renderer.fog.images().length, 0);
  assert.equal(ready, false);
  h.pending()[0].load(); await h.renderer.ready;
  assert.equal(h.renderer.background.images().length, 1);
  assert.equal(h.renderer.fog.images().length, 1);
  assert.equal(ready, true);
  h.renderer.paint({ x: -400, y: -600, scale: .1 }, 390, 844, 3);
  assert.ok(h.pending().length <= 6);
  h.pending()[0].load();
  assert.equal(h.renderer.background.images().length, 1, 'a detail background cannot appear before its fog pair');
  assert.equal(h.renderer.fog.images().length, 1);
  h.pending()[0].load();
  assert.equal(h.renderer.background.images().length, 2);
  assert.equal(h.renderer.fog.images().length, 2);
  h.flush(); h.renderer.dispose();
});

test('detail image failure leaves matching overview layers instead of exposing terrain', async () => {
  const h = harness(); h.flush(); await h.renderer.ready;
  const overviewBackground = h.renderer.background.images()[0], overviewFog = h.renderer.fog.images()[0];
  h.renderer.paint({ x: -400, y: -600, scale: .1 }, 390, 844, 2);
  const [background, fog] = h.pending();
  background.load(); fog.fail();
  assert.equal(h.renderer.background.images()[0], overviewBackground);
  assert.equal(h.renderer.fog.images()[0], overviewFog);
  assert.equal(h.renderer.background.images().length, 1);
  assert.equal(h.renderer.fog.images().length, 1);
  h.flush();
  assert.equal(h.renderer.background.images().length, h.renderer.fog.images().length);
  h.renderer.dispose();
});

test('rapid view changes cancel obsolete requests, bound nodes, and ignore late callbacks', async () => {
  const h = harness(); h.flush(); await h.renderer.ready;
  const firstView = { x: -200, y: -200, scale: .8 };
  h.renderer.paint(firstView, 390, 844, 2);
  const oldRequests = [...h.pending()];
  const oldCallbacks = oldRequests.map(image => image.onload);
  const finalView = { x: -5000, y: -7000, scale: .8 };
  h.renderer.paint(finalView, 390, 844, 2);
  for (const image of oldRequests) { assert.equal(image.src, ''); assert.equal(image.onload, null); }
  assert.ok(h.pending().length <= 6);
  for (const callback of oldCallbacks) callback();
  assert.equal(h.renderer.background.images().length, 1, 'canceled callbacks cannot append stale detail tiles');
  h.flush();
  const wanted = T.selectTiles(manifest, finalView, 390, 844, 2);
  assert.equal(h.renderer.background.images().length, wanted.length + 1);
  assert.equal(h.renderer.fog.images().length, wanted.length + 1);
  const nodes = [...h.renderer.background.images()], requests = h.requests.length;
  h.renderer.paint({ ...finalView }, 390, 844, 2);
  assert.deepEqual(h.renderer.background.images(), nodes);
  assert.equal(h.requests.length, requests, 'unchanged coverage does not request existing tiles again');
  h.renderer.dispose();
  assert.equal(h.pending().length, 0);
  assert.equal(h.renderer.background.images().length, 0);
  assert.equal(h.renderer.fog.images().length, 0);
  h.renderer.paint(firstView, 390, 844, 2);
  assert.equal(h.requests.length, requests);
});

test('overview failure rejects readiness and removes its paired request', async () => {
  const h = harness();
  const rejected = assert.rejects(h.renderer.ready, /overview could not load/);
  const [background, fog] = h.pending();
  background.fail();
  await rejected;
  assert.equal(fog.src, '');
  assert.equal(h.pending().length, 0);
  assert.equal(h.renderer.background.images().length, 0);
  assert.equal(h.renderer.fog.images().length, 0);
  h.renderer.dispose();
});
