'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const clientAssets = require('../../scripts/client-assets.json');
const bundleEntries = {
  'attachment-upload.js': 'src/client/features/game-log/attachment-upload-entry.js',
  'markdown.js': 'src/client/features/adventure-notes/markdown-entry.js'
};
const bundles = new Map();

// Browser URLs stay flat in dist; source tests resolve through the same build manifest.
function sourcePath(url) {
  if (bundleEntries[url]) throw new Error(`Use sourceText for generated browser bundle: ${url}`);
  return path.join(root, clientAssets[url] || url);
}
function sourceText(url) {
  if (!bundleEntries[url]) return fs.readFileSync(sourcePath(url), 'utf8');
  if (!bundles.has(url)) {
    const { buildSync } = require('esbuild');
    bundles.set(url, buildSync({ entryPoints: [path.join(root, bundleEntries[url])], bundle: true, write: false,
      platform: 'browser', target: ['safari16', 'chrome100'], format: 'iife' }).outputFiles[0].text);
  }
  return bundles.get(url);
}
module.exports = { root, sourcePath, sourceText };
