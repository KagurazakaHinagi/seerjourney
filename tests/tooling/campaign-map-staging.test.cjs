'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectMap, copyMap } = require('../../scripts/map-assets.cjs');
const { mapDirectory, loadMap, demoDirectory, stageDirectory } = require('../../src/server/map-config.cjs');
const { spawnSync } = require('node:child_process');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seerjourney-map-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync(demoDirectory, directory, { recursive: true });
  const read = () => JSON.parse(fs.readFileSync(path.join(directory, 'map.json'), 'utf8'));
  const write = manifest => fs.writeFileSync(path.join(directory, 'map.json'), JSON.stringify(manifest));
  return { directory, read, write };
}

test('staging copies only validated map inputs and preserves the original mod', t => {
  const { directory, read, write } = fixture(t);
  const original = read();
  original.privateBuildNotes = 'do not publish this';
  write(original);
  fs.writeFileSync(path.join(directory, '.env'), 'SHOULD_NOT_COPY=yes');
  fs.writeFileSync(path.join(directory, 'personal-session.json'), '{}');
  const data = collectMap(directory);
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'seerjourney-map-stage-'));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  copyMap(data, destination);
  assert.deepEqual(read(), original, 'source metadata remains unchanged');
  const staged = JSON.parse(fs.readFileSync(path.join(destination, 'map.json'), 'utf8'));
  assert.equal(staged.privateBuildNotes, undefined);
  assert.equal(staged.id, original.id);
  assert.deepEqual(staged.grid, original.grid);
  assert.deepEqual(staged.fog, original.fog);
  for (const filename of data.files.keys()) assert.deepEqual(fs.readFileSync(path.join(destination, filename)), fs.readFileSync(path.join(directory, filename)));
  for (const name of ['.env', 'personal-session.json']) assert.equal(fs.existsSync(path.join(destination, name)), false);
  assert.ok(fs.existsSync(path.join(destination, 'tiles/manifest.json')));
});

test('invalid explicit map paths do not silently fall back to the demo', t => {
  const { directory } = fixture(t);
  const missing = path.join(directory, 'missing');
  assert.equal(mapDirectory({ CAMPAIGN_MAP_DIR: missing }), missing);
  assert.throws(() => loadMap(mapDirectory({ CAMPAIGN_MAP_DIR: missing })), /ENOENT/);
  fs.writeFileSync(path.join(directory, 'map.json'), '{invalid');
  assert.throws(() => loadMap(directory), /JSON|position|property/);
});

test('required-map deployments fail closed when no staged map exists', t => {
  const exists = fs.existsSync;
  t.mock.method(fs, 'existsSync', file => file === stageDirectory ? false : exists(file));
  assert.throws(() => mapDirectory({ CAMPAIGN_MAP_REQUIRED: '1' }), /No campaign map is staged/);
  assert.equal(mapDirectory({}), demoDirectory);
});

test('Vercel rejects local source overrides that could disagree with staged API metadata', () => {
  assert.throws(() => mapDirectory({ VERCEL: '1', CAMPAIGN_MAP_DIR: demoDirectory }), /must use the staged map/);
});

test('the staging CLI rejects its own destination and scratch tree before changing files', () => {
  const script = path.resolve(__dirname, '../../scripts/stage-map.cjs');
  const stagedMetadata = path.join(stageDirectory, 'map.json');
  const before = fs.existsSync(stagedMetadata) ? fs.readFileSync(stagedMetadata) : null;
  for (const source of [stageDirectory, stageDirectory + '.tmp', path.join(stageDirectory + '.tmp', 'nested-map')]) {
    const result = spawnSync(process.execPath, [script, source], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /original external map directory/);
  }
  if (before) assert.deepEqual(fs.readFileSync(stagedMetadata), before);
  else assert.equal(fs.existsSync(stagedMetadata), false);
});

test('staging rejects escaping assets, missing artwork, and symlink inputs', t => {
  const { directory, read, write } = fixture(t);
  const original = read();
  for (const invalid of ['../outside.jpg', '/tmp/image.jpg', 'https://example.com/map.jpg', 'images/../../outside.jpg']) {
    write({ ...original, assets: { ...original.assets, background: invalid } });
    assert.throws(() => collectMap(directory), /relative raster paths|path/);
  }
  write({ ...original, assets: { ...original.assets, background: 'missing.jpg' } });
  assert.throws(() => collectMap(directory), /ENOENT/);
  write(original);
  const artwork = path.join(directory, original.assets.background);
  fs.renameSync(artwork, path.join(directory, 'real-background.jpg'));
  fs.symlinkSync('real-background.jpg', artwork);
  assert.throws(() => collectMap(directory), /symbolic links/);
});

test('staging rejects a tile manifest for another map and missing tiles', t => {
  const { directory } = fixture(t);
  const tilePath = path.join(directory, 'tiles/manifest.json');
  const tiles = JSON.parse(fs.readFileSync(tilePath, 'utf8'));
  fs.writeFileSync(tilePath, JSON.stringify({ ...tiles, mapId: 'another-map' }));
  assert.throws(() => collectMap(directory), /tile manifest/);
  fs.writeFileSync(tilePath, JSON.stringify(tiles));
  const first = tiles.layers.background.replace('{id}', tiles.levels[0].id).replace('{column}', '0').replace('{row}', '0');
  fs.rmSync(path.join(directory, 'tiles', first));
  assert.throws(() => collectMap(directory), /ENOENT/);
});

test('an untiled square-grid mod can be staged without personal campaign geometry', t => {
  const { directory, read, write } = fixture(t);
  fs.rmSync(path.join(directory, 'tiles'), { recursive: true });
  const original = read();
  write({ ...original, id: 'square-demo', grid: { type: 'square', originX: 50, originY: 50, radiusX: 50, radiusY: 50, columnStep: 100, rowStep: 100,
    minColumn: 0, maxColumn: 9, minRow: 0, maxRow: 9, bounds: { x: 0, y: 0, width: 1000, height: 1000 } },
    fog: { ...original.fog, cells: ['1,1', '2,2'] }, tags: [] });
  const data = collectMap(directory);
  assert.equal(data.config.grid.type, 'square');
  assert.equal(data.tiles, null);
  assert.deepEqual(data.config.fogHexes, ['1,1', '2,2']);
});
