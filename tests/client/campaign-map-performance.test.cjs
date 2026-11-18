'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../../src/shared/core.js');
const M = require('../../src/shared/map-mod.js');
const manifest = require('../../examples/demo-map/map.json');
const origin = 'https://campaign.example';
const manifestURL = `${origin}/campaign-map/map.json`;

function manifestFetch(raw = manifest) {
  const requests = [];
  const fetch = async url => {
    requests.push(String(url));
    assert.equal(String(url), manifestURL, 'lightweight loading must not fetch full-resolution artwork');
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(raw) };
  };
  return { fetch, requests };
}

test('lightweight bundled map loading fetches metadata only and retains original coordinates', async () => {
  const network = manifestFetch();
  const config = await M.loadBundled('campaign-map/map.json', { fetch: network.fetch, baseURL: origin + '/', embedAssets: false });
  assert.deepEqual(network.requests, [manifestURL]);
  assert.equal(config.width, manifest.width);
  assert.equal(config.height, manifest.height);
  assert.deepEqual(config.grid, manifest.grid);
  assert.deepEqual(config.fogHexes, manifest.fog.cells);
  assert.equal(config.backgroundImage, `${origin}/campaign-map/background.jpg`);
  assert.equal(config.fogImage, `${origin}/campaign-map/fog.jpg`);
  for (const [id, relative] of Object.entries(manifest.assets)) {
    assert.equal(config.assets[id], new URL(relative, manifestURL).href);
  }
  for (const tag of config.tags) assert.equal(tag.image, config.assets[tag.asset]);
});

test('lightweight bundled assets reject external and escaping paths before downloading artwork', async () => {
  for (const invalid of ['../background.jpg', 'tags/../../background.jpg', '/background.jpg', 'https://other.example/background.jpg', 'background.jpg?secret=1']) {
    const network = manifestFetch({ ...manifest, assets: { ...manifest.assets, background: invalid } });
    await assert.rejects(M.loadBundled(manifestURL, { fetch: network.fetch, baseURL: origin + '/', embedAssets: false }));
    assert.deepEqual(network.requests, [manifestURL]);
  }
  const network = manifestFetch();
  await assert.rejects(M.loadBundled('https://other.example/map.json', { fetch: network.fetch, baseURL: origin + '/', embedAssets: false }));
  assert.equal(network.requests.length, 0);
});

test('lightweight bundled loading retains metadata validation and does not allow URLs in imported mods', async () => {
  const invalid = manifestFetch({ ...manifest, width: -1 });
  await assert.rejects(M.loadBundled(manifestURL, { fetch: invalid.fetch, baseURL: origin + '/', embedAssets: false }));
  const assetURLs = Object.fromEntries(Object.entries(manifest.assets).map(([id, source]) => [id, new URL(source, manifestURL).href]));
  assert.throws(() => M.validate({ ...manifest, assets: assetURLs }), /embedded|URLs/);
  const file = { size: 1000, text: async () => JSON.stringify({ ...manifest, assets: assetURLs }) };
  await assert.rejects(M.parseFile(file), /embedded|URLs/);
});

function layerHarness() {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    append(...items) { for (const item of items) this.children.push(...(item.tagName === '#fragment' ? item.children : [item])); }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    find(tag) { return this.children.flatMap(child => [...(child.tagName === tag ? [child] : []), ...child.find(tag)]); }
  }
  const context = { window: {}, document: { createElementNS: (_, tag) => new Element(tag), createDocumentFragment: () => new Element('#fragment') } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/client/features/map/map-layers.js'), 'utf8'), context);
  const firstCell = manifest.fog.cells[0];
  const config = { ...manifest, backgroundImage: 'background.jpg', fogImage: 'fog.jpg', fogHexes: manifest.fog.cells,
    tags: [{ id: 'discovery', image: 'tag.png', x: 100, y: 100, width: 30, height: 30, visibility: 'revealed', cell: firstCell }] };
  return { layers: context.window.MapJourneyLayers.create(config, C), firstCell };
}

test('unchanged fog keeps its polygon nodes across repeated live status updates', () => {
  const { layers } = layerHarness();
  const polygons = layers.element.find('polygon');
  assert.equal(polygons.length, manifest.fog.cells.length);
  for (let i = 0; i < 10; i++) layers.render([]);
  const after = layers.element.find('polygon');
  assert.equal(after.length, polygons.length);
  for (let i = 0; i < after.length; i++) assert.equal(after[i], polygons[i], 'unchanged polling preserves existing fog geometry');
});

test('cached fog still reveals, refogs, and updates discovery tags when progress changes', () => {
  const { layers, firstCell } = layerHarness();
  const discovery = layers.element.find('image').find(image => image.attributes['data-tag-id'] === 'discovery');
  assert.equal(discovery.attributes.visibility, 'hidden');
  layers.render([firstCell]);
  const revealed = layers.element.find('polygon');
  assert.equal(revealed.length, manifest.fog.cells.length - 1);
  assert.equal(discovery.attributes.visibility, 'visible');
  layers.render([firstCell]);
  assert.equal(layers.element.find('polygon')[0], revealed[0]);
  layers.render([]);
  assert.equal(layers.element.find('polygon').length, manifest.fog.cells.length);
  assert.equal(discovery.attributes.visibility, 'hidden');
});
