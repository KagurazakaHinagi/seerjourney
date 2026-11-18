'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { unpackMap } = require('../../scripts/unpack-map.cjs');
const { collectMap } = require('../../scripts/map-assets.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seerjourney-portable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const demo = path.resolve(__dirname, '../../examples/demo-map');
  const raw = structuredClone(require('../../examples/demo-map/map.json'));
  raw.assets = Object.fromEntries(Object.entries(raw.assets).map(([id, file]) => [id, 'data:image/jpeg;base64,' + fs.readFileSync(path.join(demo, file)).toString('base64')]));
  const input = path.join(root, 'portable.json'), output = path.join(root, 'unpacked');
  const write = () => fs.writeFileSync(input, JSON.stringify(raw));
  write();
  return { root, raw, input, output, write };
}

test('portable maps unpack exact referenced rasters and preserve geometry without importing extra data', t => {
  const f = fixture(t);
  f.raw.assets.unused = f.raw.assets.background;
  f.raw.sourceFilename = '/private/owner/map.jpg';
  f.write();
  const before = fs.readFileSync(f.input);
  const result = unpackMap(f.input, f.output);
  const data = collectMap(f.output);
  assert.equal(result.assets, 2);
  assert.equal(data.tiles, null);
  assert.deepEqual(data.manifest.grid, f.raw.grid);
  assert.deepEqual(data.manifest.fog.cells, f.raw.fog.cells);
  assert.equal(data.manifest.sourceFilename, undefined);
  assert.equal(data.manifest.assets.unused, undefined);
  for (const [id, relative] of Object.entries(data.manifest.assets)) {
    assert.match(relative, /^images\/asset-\d{4}\.jpg$/);
    assert.deepEqual(fs.readFileSync(path.join(f.output, relative)), Buffer.from(f.raw.assets[id].split(',')[1], 'base64'));
  }
  assert.deepEqual(fs.readFileSync(f.input), before);
});

test('invalid embedded images, missing references and hostile identifiers create no output', t => {
  for (const change of [raw => { raw.assets.background = 'https://example.com/map.jpg'; },
    raw => { raw.assets.background = 'data:image/jpeg;base64,PHNjcmlwdD4='; },
    raw => { raw.background = 'missing'; }, raw => { raw.assets['../outside'] = raw.assets.background; }]) {
    const f = fixture(t); change(f.raw); f.write();
    assert.throws(() => unpackMap(f.input, f.output));
    assert.equal(fs.existsSync(f.output), false);
  }
});

test('portable unpacking never overwrites an existing destination or follows a source symlink', t => {
  const f = fixture(t);
  fs.mkdirSync(f.output);
  const marker = path.join(f.output, 'keep.txt'); fs.writeFileSync(marker, 'keep me');
  assert.throws(() => unpackMap(f.input, f.output), /already exists/);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep me');
  const link = path.join(f.root, 'linked.json'); fs.symlinkSync(f.input, link);
  assert.throws(() => unpackMap(link, path.join(f.root, 'from-link')), /regular portable map/);
  assert.equal(fs.existsSync(path.join(f.root, 'from-link')), false);
});
