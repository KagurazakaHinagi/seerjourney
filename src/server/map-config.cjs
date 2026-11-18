'use strict';
const fs = require('node:fs');
const path = require('node:path');
const M = require('../shared/map-mod.js');
const root = path.resolve(__dirname, '../..');
const demoDirectory = path.join(root, 'examples/demo-map');
const stageDirectory = path.join(root, '.campaign-map');

function mapDirectory(env = process.env) {
  if (env.VERCEL && env.CAMPAIGN_MAP_DIR) throw new Error('Vercel builds and functions must use the staged map. Remove CAMPAIGN_MAP_DIR from the build environment and local .env before using vercel build.');
  if (env.CAMPAIGN_MAP_DIR) return path.resolve(root, env.CAMPAIGN_MAP_DIR);
  if (fs.existsSync(stageDirectory)) return stageDirectory;
  if (env.CAMPAIGN_MAP_REQUIRED === '1') throw new Error('No campaign map is staged. Run npm run map:stage before deploying.');
  return demoDirectory;
}
function safeFile(directory, relative) {
  if (typeof relative !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid map asset path');
  let current = path.resolve(directory);
  if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Map directories must not be symbolic links');
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Map assets must not be symbolic links');
  }
  if (!fs.statSync(current).isFile()) throw new Error(`Map asset is not a file: ${relative}`);
  return current;
}
function loadMap(directory = mapDirectory()) {
  const file = safeFile(directory, 'map.json');
  if (fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('Map metadata is too large');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const assetURLs = Object.fromEntries(Object.entries(raw.assets || {}).map(([id, value]) => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_./-]+\.(png|jpe?g|webp)$/.test(value) || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Map assets must be relative raster paths');
    return [id, `https://map.invalid/${value}`];
  }));
  const config = M.validate({ ...raw, assets: assetURLs }, { assetURLs: new Set(Object.values(assetURLs)) });
  const manifest = { ...M.toPortable(config), assets: Object.fromEntries(Object.keys(config.assets).map(id => [id, raw.assets[id]])) };
  return { directory, manifest, config };
}
function namespace(env = process.env, mapId) {
  const value = env.CAMPAIGN_ID || mapId || loadMap(mapDirectory(env)).config.id;
  if (!/^[a-z0-9_-]{1,80}$/i.test(value)) throw new Error('CAMPAIGN_ID must contain only letters, numbers, underscores or hyphens');
  return value;
}
module.exports = { mapDirectory, loadMap, safeFile, namespace, demoDirectory, stageDirectory };
