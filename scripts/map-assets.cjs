'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadMap, safeFile } = require('../src/server/map-config.cjs');

function collectMap(directory) {
  const data = loadMap(directory), { manifest, config } = data;
  const files = new Map();
  let bytes = 0;
  function add(relative) {
    if (files.has(relative)) return;
    if (files.size >= 20000) throw new Error('Campaign map has too many assets');
    const file = safeFile(directory, relative);
    bytes += fs.statSync(file).size;
    if (bytes > 512 * 1024 * 1024) throw new Error('Campaign map assets exceed 512 MiB');
    files.set(relative, file);
  }
  for (const relative of new Set(Object.values(manifest.assets))) add(relative);
  let tiles = null;
  if (fs.existsSync(path.join(directory, 'tiles/manifest.json'))) {
    const file = safeFile(directory, 'tiles/manifest.json');
    if (fs.statSync(file).size > 1024 * 1024) throw new Error('Tile manifest is too large');
    const input = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (input.version !== 1 || input.mapId !== config.id || input.width !== config.width || input.height !== config.height || !Number.isSafeInteger(input.tileSize) || input.tileSize < 1 || input.tileSize > 2048 || ![0, 1].includes(input.overlap) || !Array.isArray(input.levels) || !input.levels.length || input.levels.length > 16 || !Number.isSafeInteger(input.sourceWidth) || !Number.isSafeInteger(input.sourceHeight) || input.sourceWidth <= 0 || input.sourceHeight <= 0 || input.sourceWidth * input.sourceHeight > 100000000) throw new Error('Invalid map tile manifest');
    const ids = new Set();
    let previousWidth = 0, previousHeight = 0;
    const levels = input.levels.map(level => {
      if (typeof level.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(level.id) || ids.has(level.id) || !['width', 'height', 'columns', 'rows'].every(key => Number.isSafeInteger(level[key]) && level[key] > 0) || level.width < previousWidth || level.height < previousHeight || level.width > input.sourceWidth || level.height > input.sourceHeight || level.columns !== Math.ceil(level.width / input.tileSize) || level.rows !== Math.ceil(level.height / input.tileSize) || level.columns * level.rows > 20000) throw new Error('Invalid map tile level');
      ids.add(level.id); previousWidth = level.width; previousHeight = level.height;
      return Object.fromEntries(['id', 'width', 'height', 'columns', 'rows'].map(key => [key, level[key]]));
    });
    if (!config.fogImage) throw new Error('Raster tile pyramids require a fog image');
    const layers = {};
    for (const name of ['background', 'fog']) {
      const template = input.layers?.[name];
      if (typeof template !== 'string' || !/^[a-zA-Z0-9_./{}-]+\.(jpg|jpeg|png|webp)$/.test(template) || !['{id}', '{column}', '{row}'].every(part => template.includes(part))) throw new Error('Invalid map tile path');
      layers[name] = template;
      for (const level of levels) for (let row = 0; row < level.rows; row++) for (let column = 0; column < level.columns; column++) add(`tiles/${template.replaceAll('{id}', level.id).replaceAll('{column}', column).replaceAll('{row}', row)}`);
    }
    tiles = { version: 1, mapId: config.id, width: config.width, height: config.height, sourceWidth: input.sourceWidth, sourceHeight: input.sourceHeight, tileSize: input.tileSize, overlap: input.overlap, format: input.format, quality: input.quality, layers, levels };
    tiles.sourceSha256 = {};
    for (const name of ['background', 'fog']) {
      const id = name === 'background' ? manifest.background : manifest.fog.image;
      const digest = crypto.createHash('sha256').update(fs.readFileSync(files.get(manifest.assets[id]))).digest('hex');
      if (input.sourceSha256?.[name] && input.sourceSha256[name] !== digest) throw new Error('Tile source has changed. Regenerate the tile pyramid before deployment.');
      tiles.sourceSha256[name] = digest;
    }
  }
  return { ...data, files, tiles };
}
function copyMap(data, destination) {
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'map.json'), JSON.stringify(data.manifest, null, 2) + '\n');
  for (const [relative, file] of data.files) {
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
  }
  if (data.tiles) fs.writeFileSync(path.join(destination, 'tiles/manifest.json'), JSON.stringify(data.tiles, null, 2) + '\n');
}
module.exports = { collectMap, copyMap };
