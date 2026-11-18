'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const mapRoot = path.join(root, 'examples/demo-map');
const map = require('../../examples/demo-map/map.json');
const manifest = require('../../examples/demo-map/tiles/manifest.json');

function jpegSize(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    assert.equal(bytes[offset++], 0xff);
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if ([0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7].includes(marker)) continue;
    const length = bytes.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= bytes.length);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    if (marker === 0xda) break;
    offset += length;
  }
  assert.fail('JPEG has no supported frame');
}

test('tile pyramid preserves map coordinates and uses the actual source raster resolution', () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.mapId, map.id);
  assert.equal(manifest.width, map.width);
  assert.equal(manifest.height, map.height);
  assert.deepEqual(Object.keys(manifest.layers).sort(), ['background', 'fog']);
  for (const [layer, asset] of Object.entries({ background: map.background, fog: map.fog.image })) {
    const source = fs.readFileSync(path.join(mapRoot, map.assets[asset]));
    const dimensions = jpegSize(source);
    assert.deepEqual(dimensions, { width: manifest.sourceWidth, height: manifest.sourceHeight });
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), manifest.sourceSha256[layer], 'Regenerate tiles after changing source imagery');
  }
  assert.deepEqual({ width: manifest.levels.at(-1).width, height: manifest.levels.at(-1).height }, { width: manifest.sourceWidth, height: manifest.sourceHeight });
  assert.equal(manifest.levels[0].columns * manifest.levels[0].rows, 1, 'Overview requires only one small image per layer');
  assert.ok(manifest.levels[0].width * manifest.levels[0].height < 150000);
});

test('every tile has bounded dimensions, overlap, and complete edge coverage', () => {
  const paths = new Set();
  let count = 0;
  for (const template of Object.values(manifest.layers)) {
    for (const level of manifest.levels) {
      assert.equal(level.columns, Math.ceil(level.width / manifest.tileSize));
      assert.equal(level.rows, Math.ceil(level.height / manifest.tileSize));
      for (let row = 0; row < level.rows; row++) for (let column = 0; column < level.columns; column++) {
        const filename = template.replace('{id}', level.id).replace('{column}', column).replace('{row}', row);
        assert.equal(paths.has(filename), false);
        paths.add(filename);
        const dimensions = jpegSize(fs.readFileSync(path.join(mapRoot, 'tiles', filename)));
        assert.deepEqual(dimensions, {
          width: Math.min(manifest.tileSize + manifest.overlap, level.width - column * manifest.tileSize),
          height: Math.min(manifest.tileSize + manifest.overlap, level.height - row * manifest.tileSize)
        }, filename);
        assert.ok(dimensions.width <= 513 && dimensions.height <= 513, 'No large image decode in the interactive map');
        count++;
      }
    }
  }
  assert.ok(count > 0);
  const sourceTileFiles = fs.readdirSync(path.join(mapRoot, 'tiles'), { recursive: true }).filter(name => name.endsWith('.jpg'));
  assert.equal(sourceTileFiles.length, paths.size, 'Tile directory has no stale tiles');
});
