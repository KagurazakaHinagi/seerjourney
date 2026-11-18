'use strict';
// Export only reviewed source files; never copy the working tree or Git objects wholesale.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
function sources() {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'release-files.json'), 'utf8'));
  if (!Array.isArray(list) || !list.length || new Set(list).size !== list.length) throw new Error('Invalid publication file list');
  return list.map(relative => {
    if (typeof relative !== 'string' || !/^[a-zA-Z0-9_.\/-]+$/.test(relative) || relative.startsWith('/') || relative.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Unsafe publication path');
    const parts = relative.split('/');
    if (parts.some(part => ['.git', '.vercel', '.data', '.campaign-map', '.campaign-map.tmp', '.impeccable', 'node_modules', 'public', 'dist', 'mods', 'previews', '__pycache__'].includes(part)) || (parts.some(part => part.startsWith('.env')) && relative !== '.env.example') || /\.(zip|seerjourney-mod\.json|mapjourney-mod\.json|seerjourney\.json|mapjourney\.json|chult\.json)$/.test(relative) || ['attachment-upload.js', 'markdown.js', 'release-manifest.json'].includes(relative)) throw new Error(`Private or generated path in publication list: ${relative}`);
    let source = root;
    for (const part of parts) {
      source = path.join(source, part);
      if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Publication source is a symlink: ${relative}`);
    }
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error(`Unexpected publication file: ${relative}`);
    const data = fs.readFileSync(source);
    return { relative, data, sha256: crypto.createHash('sha256').update(data).digest('hex') };
  });
}
function prepare(destination) {
  const files = sources();
  const requested = path.resolve(destination);
  let ancestor = path.dirname(requested);
  const suffix = [path.basename(requested)];
  while (!fs.existsSync(ancestor)) { suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  const target = path.join(fs.realpathSync(ancestor), ...suffix);
  const realRoot = fs.realpathSync(root);
  if (target === realRoot || target.startsWith(realRoot + path.sep) || realRoot.startsWith(target + path.sep)) throw new Error('Choose a separate publication directory outside this checkout');
  if (fs.existsSync(target)) throw new Error('Publication destination already exists; choose a new directory to preserve it');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(target);
  for (const { relative, data, sha256 } of files) {
    const output = path.join(target, relative);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, data, { flag: 'wx' });
    if (crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex') !== sha256) throw new Error(`Publication copy verification failed: ${relative}`);
  }
  fs.writeFileSync(path.join(target, 'release-manifest.json'), JSON.stringify({ format: 'seerjourney-source-export', files: files.map(({ relative, sha256 }) => ({ path: relative, sha256 })) }, null, 2) + '\n', { flag: 'wx' });
  return { directory: target, files: files.length, bytes: files.reduce((total, file) => total + file.data.length, 0) };
}
if (require.main === module) {
  const arg = process.argv[2];
  if (process.argv.length !== 3 || !arg) throw new Error('Usage: npm run release:prepare -- /absolute/new-directory (or --check)');
  if (arg === '--check') console.log(`Verified ${sources().length} allowlisted publication files.`);
  else console.log(JSON.stringify(prepare(arg), null, 2));
}
module.exports = { sources, prepare };
