'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { collectMap, copyMap } = require('./map-assets.cjs');
const { stageDirectory } = require('../src/server/map-config.cjs');
const source = process.argv[2] || process.env.CAMPAIGN_MAP_DIR;
if (!source) throw new Error('Provide a map directory: npm run map:stage -- /absolute/path/to/map-mod');
const directory = path.resolve(source);
const temporary = stageDirectory + '.tmp';
const generatedInput = file => [stageDirectory, temporary].some(target => file === target || file.startsWith(target + path.sep));
if (generatedInput(directory)) throw new Error('Choose the original external map directory, not its staging or scratch copy');
const data = collectMap(directory);
if ([...data.files.values()].some(generatedInput)) throw new Error('Map source assets must not reference the generated staging or scratch directories');
fs.rmSync(temporary, { recursive: true, force: true });
try {
  copyMap(data, temporary);
  fs.rmSync(stageDirectory, { recursive: true, force: true });
  fs.renameSync(temporary, stageDirectory);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log(`Staged ${data.config.name} (${data.config.id}); ${data.files.size} assets. The original map stays at ${directory}.`);
