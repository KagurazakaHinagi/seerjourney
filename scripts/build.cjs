'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const { icons, syncIcons } = require('./sync-icons.cjs');
const { mapDirectory } = require('../src/server/map-config.cjs');
const { collectMap, copyMap } = require('./map-assets.cjs');
const { checkLicenses } = require('./check-licenses.cjs');
const clientAssets = require('./client-assets.json');
const bundles = {
  'attachment-upload.js': 'src/client/features/game-log/attachment-upload-entry.js',
  'markdown.js': 'src/client/features/adventure-notes/markdown-entry.js'
};
const output = path.join(root, 'dist');
function safeSource(relative) {
  if (typeof relative !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid public asset path');
  let source = root;
  for (const part of relative.split('/')) {
    source = path.join(source, part);
    if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Invalid public asset: ${relative}`);
  }
  if (!fs.statSync(source).isFile()) throw new Error(`Invalid public asset: ${relative}`);
  return source;
}
function sourceFor(url) {
  if (Object.hasOwn(clientAssets, url)) return safeSource(clientAssets[url]);
  if (Object.hasOwn(bundles, url)) return safeSource(bundles[url]);
  // Application code must have an explicit URL mapping; these files keep their paths.
  if (url.startsWith('assets/') || url.startsWith('licenses/') || ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'docs/licenses.md'].includes(url)) return safeSource(url);
  throw new Error(`No source mapping for public URL: ${url}`);
}
syncIcons();
const licenseAudit = checkLicenses();
const map = collectMap(mapDirectory());
const html = fs.readFileSync(sourceFor('index.html'), 'utf8');
const assets = new Set(['index.html', 'manifest.webmanifest', 'sw.js']);
for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'docs/licenses.md', ...licenseAudit.files]) assets.add(file);
for (const match of html.matchAll(/(?:src|href)="([^"#?]+\.(?:js|css|svg|png|webmanifest))"/g)) assets.add(match[1]);
const manifest = JSON.parse(fs.readFileSync(sourceFor('manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons) assets.add(icon.src);
// Runtime URLs referenced by CSS and JavaScript are explicit, never whole directories.
assets.add('assets/icons/seer-mark.svg');
for (const file of ['markers.svg', 'map-pin.svg', 'bonfire.svg', 'warning-triangle.svg', 'tower.svg', 'coins.svg', 'tomb.svg', 'calendar.svg', 'LICENSE', 'README.md']) assets.add(`assets/iconoir/${file}`);
for (const file of Object.values(icons)) assets.add(`assets/iconoir/${file}`);
assets.add('assets/iconoir/ui-icons.json');
for (const url of assets) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(url) || url.startsWith('/') || url.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid public asset URL');
  sourceFor(url);
}
for (const url of Object.keys(clientAssets)) {
  if (!assets.has(url)) throw new Error(`Unused public asset mapping: ${url}`);
}
// Compile before replacing output so a broken entry point preserves the previous build.
const compiled = new Map(Object.entries(bundles).map(([url, entry]) => [url, require('esbuild').buildSync({
  entryPoints: [safeSource(entry)], bundle: true, minify: true, write: false,
  platform: 'browser', target: ['safari16', 'chrome100'], format: 'iife', legalComments: 'inline'
}).outputFiles[0].contents]));
fs.rmSync(output, { recursive: true, force: true });
for (const url of assets) {
  const destination = path.join(output, url);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (compiled.has(url)) fs.writeFileSync(destination, compiled.get(url));
  else fs.copyFileSync(sourceFor(url), destination);
}
copyMap(map, path.join(output, 'campaign-map'));
fs.writeFileSync(path.join(output, 'campaign-map/runtime.json'), JSON.stringify({ tiles: Boolean(map.tiles) }) + '\n');
for (const relative of ['map.json', 'runtime.json', ...(map.tiles ? ['tiles/manifest.json'] : []), ...map.files.keys()]) assets.add(`campaign-map/${relative}`);
const shell = [...assets].filter(file => (!file.startsWith('campaign-map/') || ['campaign-map/map.json', 'campaign-map/runtime.json', 'campaign-map/tiles/manifest.json'].includes(file)) && file !== 'sw.js');
const hash = crypto.createHash('sha256');
for (const file of shell) hash.update(fs.readFileSync(path.join(output, file)));
const worker = fs.readFileSync(sourceFor('sw.js'), 'utf8')
  .replace('__BUILD_ID__', hash.digest('hex').slice(0, 16))
  .replace('/* __SHELL_FILES__ */ []', JSON.stringify(shell));
fs.writeFileSync(path.join(output, 'sw.js'), worker);
console.log(`Built ${assets.size} public files; map: ${map.config.name} (${map.config.id}).`);
module.exports = { assets };
