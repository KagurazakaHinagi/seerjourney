'use strict';
const fs = require('node:fs');
const path = require('node:path');
const M = require('../src/shared/map-mod.js');

function unpackMap(source, destination) {
  if (!source || !destination) throw new Error('Usage: npm run map:unpack -- /path/to/map.seerjourney-mod.json /path/to/new-map-directory');
  const input = path.resolve(source), output = path.resolve(destination);
  const stat = fs.lstatSync(input);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > M.MAX_FILE_BYTES) throw new Error('Choose a regular portable map file no larger than 150 MiB');
  // Validate the complete package before creating any destination files. Maps
  // may provide raster data only; they cannot supply code or output paths.
  const config = M.validate(JSON.parse(fs.readFileSync(input, 'utf8')));
  if (fs.existsSync(output)) throw new Error('The destination already exists. Choose a new directory to avoid overwriting files.');
  const parent = path.dirname(output);
  if (!fs.statSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink()) throw new Error('Choose an existing, non-symlink parent directory');
  const referenced = new Set([config.background, config.fog.image, ...config.tags.map(tag => tag.asset)].filter(Boolean));
  const assets = {}, decoded = [];
  for (const id of referenced) {
    const data = config.assets[id], comma = data.indexOf(',');
    const type = data.slice(11, data.indexOf(';'));
    const relative = `images/asset-${String(decoded.length + 1).padStart(4, '0')}.${type === 'jpeg' ? 'jpg' : type}`;
    assets[id] = relative;
    decoded.push([relative, Buffer.from(data.slice(comma + 1), 'base64')]);
  }
  const manifest = { ...M.toPortable(config), assets };
  // mkdir is exclusive: an existing directory (including one created since
  // validation) is never reused or replaced.
  fs.mkdirSync(output);
  try {
    fs.mkdirSync(path.join(output, 'images'));
    for (const [relative, bytes] of decoded) fs.writeFileSync(path.join(output, relative), bytes, { flag: 'wx' });
    fs.writeFileSync(path.join(output, 'map.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
  return { directory: output, mapId: config.id, assets: decoded.length };
}

if (require.main === module) {
  const result = unpackMap(process.argv[2], process.argv[3]);
  console.log(`Unpacked ${result.mapId}: ${result.assets} raster assets into ${result.directory}.`);
  console.log('Next: npm run map:stage -- ' + JSON.stringify(result.directory));
  console.log('For large maps, generate a tile pyramid first; see docs/map-deployment.md.');
}
module.exports = { unpackMap };
