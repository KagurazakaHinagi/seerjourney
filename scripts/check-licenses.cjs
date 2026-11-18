'use strict';

// Reproduce the dependency notice inventory from the lockfile and installed packages.
// No network access is needed. Version-specific upstream omissions are explicit below.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const allowed = new Set(['MIT', 'Apache-2.0', '(MPL-2.0 OR Apache-2.0)', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'BlueOak-1.0.0']);
const licenseName = /^(?:licen[cs]e|copying|notice)(?:\.[\w-]+|-.*)?$/i;

function browserPackages() {
  const result = new Set();
  for (const entry of ['src/client/features/game-log/attachment-upload-entry.js', 'src/client/features/adventure-notes/markdown-entry.js']) {
    const build = require('esbuild').buildSync({ absWorkingDir: root,
      entryPoints: [entry], bundle: true, minify: true,
      write: false, platform: 'browser', format: 'iife', metafile: true });
    for (const output of Object.values(build.metafile.outputs)) {
      for (const [file, input] of Object.entries(output.inputs)) {
        if (!input.bytesInOutput || !file.startsWith('node_modules/')) continue;
        const parts = file.split('/');
        result.add(parts.slice(0, parts[1].startsWith('@') ? 3 : 2).join('/'));
      }
    }
  }
  return result;
}

function repositoryURL(repository) {
  const value = typeof repository === 'object' ? repository.url : repository;
  if (!value) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) return `https://github.com/${value}`;
  return value.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
}

function checkLicenses({ write = false } = {}) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const browser = browserPackages();
  const files = new Map();
  const inventory = [];
  for (const [location, locked] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (!location) continue;
    if (!allowed.has(locked.license)) throw new Error(`Review the license for ${location}: ${locked.license || 'missing'}`);
    const name = location.slice(location.lastIndexOf('node_modules/') + 13);
    const directory = path.join(root, location);
    const nativeEsbuild = name.startsWith('@esbuild/');
    if (!fs.existsSync(directory) && !nativeEsbuild) throw new Error(`Run npm ci to inspect ${location}`);
    const metadata = nativeEsbuild
      ? { name, version: locked.version, license: locked.license, repository: 'evanw/esbuild' }
      : JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (metadata.version !== locked.version || metadata.license !== locked.license) throw new Error(`Installed metadata differs from package-lock.json: ${location}`);
    const item = { name, version: locked.version, location, license: locked.license,
      distributionLicense: name === 'dompurify' ? 'Apache-2.0' : locked.license,
      usage: browser.has(location) ? 'browser and runtime' : locked.dev ? 'development' : 'runtime',
      optional: !!locked.optional, source: repositoryURL(metadata.repository), licenseFiles: [] };
    let notices;
    if (nativeEsbuild) {
      notices = [['LICENSE.md', fs.readFileSync(path.join(root, 'node_modules/esbuild/LICENSE.md'))]];
      item.note = 'Platform binary from the same esbuild release; upstream esbuild MIT license.';
    } else if (name === 'saxes' && locked.version === '6.0.0') {
      notices = [['LICENSE', fs.readFileSync(path.join(root, 'licenses/upstream/saxes-6.0.0.txt'))]];
      item.note = 'npm archive omits LICENSE; retained from the upstream v6.0.0 tag.';
      item.licenseSource = 'https://raw.githubusercontent.com/lddubeau/saxes/v6.0.0/LICENSE';
    } else if (name === 'is-node-process' && locked.version === '1.2.0') {
      notices = [['license-declaration.txt', fs.readFileSync(path.join(root, 'licenses/upstream/is-node-process-1.2.0.txt'))]];
      item.note = 'Publisher declares MIT in package.json; package and upstream repository provide no separate license text or copyright notice. See the retained declaration; no owner has been inferred.';
      item.licenseSource = 'https://github.com/mswjs/is-node-process/blob/main/package.json';
    } else {
      notices = fs.readdirSync(directory).filter(file => licenseName.test(file) && fs.statSync(path.join(directory, file)).isFile())
        .sort().map(file => [file, fs.readFileSync(path.join(directory, file))]);
      if (!notices.length) throw new Error(`No license notice found: ${location}`);
    }
    for (const [nameOnDisk, contents] of notices) {
      const target = `licenses/packages/${name.replace(/[^a-zA-Z0-9._-]/g, '_')}-${locked.version}/${nameOnDisk}`;
      if (files.has(target) && !files.get(target).equals(contents)) throw new Error(`Conflicting license copy: ${target}`);
      files.set(target, contents);
      item.licenseFiles.push({ path: target, sha256: sha256(contents) });
    }
    inventory.push(item);
  }
  const data = { schemaVersion: 1, description: 'Exact locked npm dependency licenses. Map assets and campaign data are excluded.', packages: inventory };
  files.set('licenses/index.json', Buffer.from(JSON.stringify(data, null, 2) + '\n'));
  const rows = inventory.map(item => `| ${item.name} | ${item.version} | ${item.distributionLicense} | ${item.usage} | ${item.licenseFiles.map(file => `[${path.basename(file.path)}](${file.path})`).join(', ')} |`).join('\n');
  const text = `# Third-party notices\n\nGenerated by \`node scripts/check-licenses.cjs --write\` from \`package-lock.json\` and installed package notices. Do not edit the table by hand.\n\n## Distributed resources\n\n- **Iconoir v7.12.2** — regular icons, copyright (c) 2021 Luca Burgio, [MIT license](assets/iconoir/LICENSE). Originals pinned to [commit 39834e3f193bc0cca2c36bebb6a650471977433d](https://github.com/iconoir-icons/iconoir/tree/39834e3f193bc0cca2c36bebb6a650471977433d). [Asset mapping and adaptations](assets/iconoir/README.md).\n- **SeerJourney logo and tomb marker** — project-specific vector artwork; see [NOTICE](NOTICE). These are not Iconoir designs.\n- **Fonts** — system font names only; no font files are redistributed.\n- **Maps and campaign content** — separately supplied, outside the source license and this audit.\n\n## Dependency notices\n\nThe table includes all lockfile entries, including development tools and platform-specific optional esbuild packages. Full upstream notices are retained below; transitive packages keep their own licenses. The compiled browser bundles contain the entries marked “browser and runtime.” They are bundled/minified from upstream code; original dependency source files are not edited.\n\nDOMPurify offers MPL-2.0 OR Apache-2.0; this distribution elects Apache-2.0 and retains both supplied texts. Marked’s complete license also preserves the John Gruber Markdown notice. \`is-node-process@1.2.0\` declares MIT in package metadata but omits a separate license/copyright notice; its declaration and standard MIT terms are retained with that limitation stated explicitly. \`saxes@6.0.0\` omits its license from npm; the complete notice was recovered from its matching upstream tag.\n\n| Package | Locked version | License used | Use | Full notices |\n| --- | --- | --- | --- | --- |\n${rows}\n\nMachine-readable inventory, source links, file hashes, and documented exceptions: [licenses/index.json](licenses/index.json). Audit scope and maintenance: [docs/licenses.md](docs/licenses.md).\n`;
  files.set('THIRD_PARTY_NOTICES.md', Buffer.from(text));
  for (const [relative, expected] of files) {
    const filename = path.join(root, relative);
    if (write) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, expected); }
    else if (!fs.existsSync(filename) || !fs.readFileSync(filename).equals(expected)) throw new Error(`Stale license inventory: ${relative}. Review changes, then run node scripts/check-licenses.cjs --write.`);
  }
  return { packages: inventory.length, browserPackages: browser.size, files: [...files.keys()] };
}

if (require.main === module) {
  const result = checkLicenses({ write: process.argv.includes('--write') });
  console.log(`Verified ${result.packages} locked dependencies (${result.browserPackages} in browser bundles).`);
}
module.exports = { checkLicenses };
