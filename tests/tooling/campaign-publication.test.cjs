'use strict';
const { sourcePath } = require('../helpers/source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sources, prepare } = require('../../scripts/prepare-release.cjs');
const root = path.resolve(__dirname, '../..');
test('publication export includes complete sources and notices without private state or Git history', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'seerjourney-release-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, 'source');
  const result = prepare(destination), names = sources().map(file => file.relative);
  for (const required of ['README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'examples/demo-map/map.json', 'src/server/campaign.cjs', 'scripts/release-files.json']) assert.ok(names.includes(required), required);
  for (const forbidden of ['.git', '.env', '.data', '.vercel', '.campaign-map', 'mods', 'node_modules', 'dist']) assert.equal(fs.existsSync(path.join(destination, forbidden)), false, forbidden);
  assert.equal(result.files, names.length);
  assert.deepEqual(fs.readFileSync(path.join(destination, 'src/shared/core.js')), fs.readFileSync(sourcePath('core.js')));
  assert.throws(() => prepare(destination), /already exists/);
});
test('publication export rejects a destination inside this checkout through a symbolic link', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'seerjourney-release-link-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const link = path.join(temporary, 'linked-source');
  fs.symlinkSync(root, link, 'dir');
  assert.throws(() => prepare(path.join(link, 'must-not-create')), /outside this checkout/);
  assert.equal(fs.existsSync(path.join(root, 'must-not-create')), false);
});
