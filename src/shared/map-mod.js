/* Data-only map packages. No imported map can add scripts, styles, or network URLs. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapJourneyMods = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FORMAT = 'mapjourney-mod', VERSION = 1;
  const MAX_FILE_BYTES = 150 * 1024 * 1024, MAX_CELLS = 25000, MAX_TAGS = 2000;
  const safeId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const fail = message => { throw new Error(message); };
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const positive = value => finite(value) && value > 0;
  const odd = value => ((value % 2) + 2) % 2;

  function string(value, name, max, required = true) {
    if (value === undefined && !required) return '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${name} is missing or too long.`);
    return value.trim();
  }

  function identifier(value, name) {
    if (typeof value !== 'string' || !safeId.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) fail(`${name} must be a short identifier containing letters, numbers, dots, underscores, or hyphens.`);
    return value;
  }

  function center(column, row, grid) {
    if (grid.type === 'square') return { x: grid.originX + column * grid.columnStep, y: grid.originY + row * grid.rowStep };
    if (grid.orientation === 'pointy-top') return { x: grid.originX + (column + odd(row) / 2) * grid.columnStep, y: grid.originY + row * grid.rowStep };
    return { x: grid.originX + column * grid.columnStep, y: grid.originY + (row + odd(column) / 2) * grid.rowStep };
  }

  function cell(value, grid) {
    if (typeof value !== 'string' || !/^-?\d+,-?\d+$/.test(value)) return null;
    const [column, row] = value.split(',').map(Number);
    if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row) || column < grid.minColumn || column > grid.maxColumn || row < grid.minRow || row > grid.maxRow) return null;
    const point = center(column, row, grid), b = grid.bounds;
    if (point.x + grid.radiusX <= b.x || point.x - grid.radiusX >= b.x + b.width || point.y + grid.radiusY <= b.y || point.y - grid.radiusY >= b.y + b.height) return null;
    return { column, row, key: `${column},${row}`, ...point };
  }

  function contains(point, target, grid) {
    const dx = Math.abs(point.x - target.x) / grid.radiusX, dy = Math.abs(point.y - target.y) / grid.radiusY;
    if (dx > 1.00001 || dy > 1.00001) return false;
    return grid.type === 'square' || (grid.orientation === 'pointy-top' ? dy + dx / 2 <= 1.00001 : dx + dy / 2 <= 1.00001);
  }

  function validateGrid(input, width, height) {
    if (!record(input) || !['hex', 'square'].includes(input.type)) fail('The map needs a hex or square grid definition.');
    const grid = { type: input.type };
    if (grid.type === 'hex') {
      grid.orientation = input.orientation || 'flat-top';
      if (!['flat-top', 'pointy-top'].includes(grid.orientation)) fail('Hex orientation must be flat-top or pointy-top.');
      grid.offset = grid.orientation === 'pointy-top' ? 'odd-row-right' : 'odd-column-down';
      if (input.offset !== undefined && input.offset !== grid.offset) fail(`This hex orientation requires the ${grid.offset} offset.`);
    }
    for (const key of ['originX', 'originY']) {
      if (!finite(input[key]) || Math.abs(input[key]) > 1000000) fail(`Grid ${key} must be a finite map coordinate.`);
      grid[key] = input[key];
    }
    for (const key of ['radiusX', 'radiusY', 'columnStep', 'rowStep']) {
      if (!positive(input[key]) || input[key] > 100000) fail(`Grid ${key} must be greater than zero.`);
      grid[key] = input[key];
    }
    for (const key of ['minColumn', 'maxColumn', 'minRow', 'maxRow']) {
      if (!Number.isSafeInteger(input[key]) || Math.abs(input[key]) > 1000000) fail(`Grid ${key} must be an integer.`);
      grid[key] = input[key];
    }
    const columns = grid.maxColumn - grid.minColumn + 1, rows = grid.maxRow - grid.minRow + 1;
    if (columns <= 0 || rows <= 0 || columns * rows > MAX_CELLS) fail(`The grid must contain between 1 and ${MAX_CELLS.toLocaleString('en-US')} cells.`);
    const expectedX = grid.radiusX * (grid.type === 'square' || grid.orientation === 'pointy-top' ? 2 : 1.5);
    const expectedY = grid.radiusY * (grid.type === 'square' || grid.orientation === 'flat-top' ? 2 : 1.5);
    // Calibrated raster maps need a small tolerance for independent fitted measurements.
    if (Math.abs(grid.columnStep - expectedX) > Math.max(.02, expectedX * .005) || Math.abs(grid.rowStep - expectedY) > Math.max(.02, expectedY * .005)) fail('Grid spacing must match its cell radii so neighboring cells meet.');
    const b = input.bounds;
    if (!record(b) || !finite(b.x) || !finite(b.y) || !positive(b.width) || !positive(b.height) || b.x < 0 || b.y < 0 || b.x + b.width > width || b.y + b.height > height) fail('Grid bounds must lie inside the map.');
    grid.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    let validCount = 0;
    for (let column = grid.minColumn; column <= grid.maxColumn; column++) {
      for (let row = grid.minRow; row <= grid.maxRow; row++) if (cell(`${column},${row}`, grid)) validCount++;
    }
    if (!validCount) fail('No grid cells intersect the map bounds.');
    return grid;
  }

  function imageData(value, name) {
    if (typeof value !== 'string' || value.length > MAX_FILE_BYTES) fail(`${name} is too large or is not an embedded image.`);
    const match = /^data:image\/(png|jpeg|webp);base64,/.exec(value);
    if (!match) fail(`${name} must be an embedded PNG, JPEG, or WebP image; URLs and SVG are not supported.`);
    const encoded = value.slice(match[0].length);
    if (!encoded.length || encoded.length % 4 || /[^A-Za-z0-9+/=]/.test(encoded) || /=/.test(encoded.slice(0, -2)) || (encoded.endsWith('=') && !/^[A-Za-z0-9+/]*={1,2}$/.test(encoded))) fail(`${name} contains invalid base64 image data.`);
    let header;
    try { header = atob(encoded.slice(0, Math.min(64, encoded.length))); }
    catch (_) { fail(`${name} contains invalid base64 image data.`); }
    const bytes = Array.from(header, character => character.charCodeAt(0));
    const png = bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.length >= 16 && header.slice(0, 4) === 'RIFF' && header.slice(8, 12) === 'WEBP';
    if (!(match[1] === 'png' && png || match[1] === 'jpeg' && jpeg || match[1] === 'webp' && webp)) fail(`${name} does not contain the declared raster image format.`);
    return value;
  }

  function validate(raw, { assetURLs } = {}) {
    if (!record(raw) || raw.format !== FORMAT || raw.version !== VERSION) fail('Choose a version 1 SeerJourney map mod.');
    const revision = raw.revision === undefined ? 1 : raw.revision;
    if (!Number.isSafeInteger(revision) || revision < 1) fail('Map revision must be a positive integer.');
    const id = identifier(raw.id, 'Map ID'), name = string(raw.name, 'Map name', 100);
    const description = string(raw.description, 'Map description', 2000, false);
    if (!positive(raw.width) || !positive(raw.height) || raw.width > 100000 || raw.height > 100000) fail('Map dimensions must be positive and no larger than 100,000.');
    const width = raw.width, height = raw.height, grid = validateGrid(raw.grid, width, height);
    if (!record(raw.assets) || !Object.keys(raw.assets).length || Object.keys(raw.assets).length > MAX_TAGS + 4) fail('The map must include its raster image assets.');
    const assets = Object.create(null);
    let bytes = 0;
    for (const [key, value] of Object.entries(raw.assets)) {
      identifier(key, 'Asset ID'); assets[key] = assetURLs?.has(value) ? value : imageData(value, `Asset “${key}”`); bytes += value.length;
      if (bytes > MAX_FILE_BYTES) fail('The map images exceed the 150 MB package limit.');
    }
    const asset = (key, label) => {
      if (typeof key !== 'string' || !own(assets, key)) fail(`${label} references a missing image asset.`);
      return key;
    };
    const background = asset(raw.background, 'Map background');
    if (raw.legacyIds !== undefined && (!Array.isArray(raw.legacyIds) || raw.legacyIds.length > 20)) fail('Legacy map IDs must be a short list.');
    const legacyIds = [...new Set((raw.legacyIds || []).map(value => identifier(value, 'Legacy map ID')))];
    const scale = raw.scale === undefined ? { distance: 1, unit: 'cells' } : raw.scale;
    if (!record(scale) || !positive(scale.distance) || scale.distance < 1e-12 || scale.distance > 1e12) fail('Map scale distance must be between 0.000000000001 and 1,000,000,000,000.');
    const unit = string(scale.unit, 'Scale unit', 20);
    let initialView;
    if (raw.initialView !== undefined) {
      const value = raw.initialView;
      if (!record(value) || !finite(value.centerX) || !finite(value.centerY) || value.centerX < 0 || value.centerY < 0 || value.centerX > width || value.centerY > height || !positive(value.zoom) || value.zoom > 20) fail('The initial camera must lie inside the map with a zoom greater than zero and no larger than 20.');
      initialView = { centerX: value.centerX, centerY: value.centerY, zoom: value.zoom };
    }
    const inputFog = raw.fog === undefined ? { cells: [] } : raw.fog;
    if (!record(inputFog) || !Array.isArray(inputFog.cells) || inputFog.cells.length > MAX_CELLS) fail('Fog must list the cells that can be revealed.');
    const seenCells = new Set();
    const cells = inputFog.cells.map(value => {
      const target = cell(value, grid);
      if (!target || seenCells.has(target.key)) fail('Fog contains an invalid or duplicate cell.');
      seenCells.add(target.key); return target.key;
    });
    const fog = { cells };
    if (inputFog.color !== undefined) {
      if (typeof inputFog.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(inputFog.color)) fail('Fog color must be a six-digit hex color.');
      fog.color = inputFog.color;
    }
    if (inputFog.image !== undefined) fog.image = asset(inputFog.image, 'Fog');
    if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.length > MAX_TAGS)) fail(`The map can contain up to ${MAX_TAGS} location tags.`);
    const tagIds = new Set();
    const tags = (raw.tags || []).map(input => {
      if (!record(input)) fail('A location tag is invalid.');
      const tagId = identifier(input.id, 'Tag ID');
      if (tagIds.has(tagId)) fail('Location tags must have unique IDs.');
      tagIds.add(tagId);
      const tag = { id: tagId, name: string(input.name, 'Tag name', 200, false), asset: asset(input.asset, 'Location tag') };
      if (!finite(input.x) || !finite(input.y) || !positive(input.width) || !positive(input.height) || input.x < 0 || input.y < 0 || input.x + input.width > width + .01 || input.y + input.height > height + .01) fail(`Tag “${tagId}” must lie inside the map.`);
      for (const key of ['x', 'y', 'width', 'height']) tag[key] = input[key];
      if (!['always', 'revealed'].includes(input.visibility)) fail(`Tag “${tagId}” needs always or revealed visibility.`);
      tag.visibility = input.visibility;
      if (input.cell !== undefined || tag.visibility === 'revealed') {
        const target = cell(input.cell, grid);
        if (!target || tag.visibility === 'revealed' && !seenCells.has(target.key)) fail(`Tag “${tagId}” must reference a valid revealable cell.`);
        tag.cell = target.key;
      }
      if (input.anchor !== undefined) {
        const point = input.anchor;
        if (!record(point) || !finite(point.x) || !finite(point.y) || point.x < 0 || point.y < 0 || point.x > width || point.y > height || tag.cell && !contains(point, cell(tag.cell, grid), grid)) fail(`Tag “${tagId}” has an invalid icon anchor.`);
        tag.anchor = { x: point.x, y: point.y };
      }
      tag.image = assets[tag.asset];
      return tag;
    });
    return { format: FORMAT, version: VERSION, revision, id, name, description, legacyIds, width, height, grid,
      scale: { distance: scale.distance, unit }, initialView, fog, background, assets, tags, fogHexes: cells,
      backgroundImage: assets[background], fogImage: fog.image ? assets[fog.image] : null, fogColor: fog.color || null,
      milesPerHex: unit === 'mi' ? scale.distance : undefined };
  }

  function toPortable(config) {
    return { format: FORMAT, version: VERSION, revision: config.revision === undefined ? 1 : config.revision, id: config.id, name: config.name, description: config.description || '',
      legacyIds: config.legacyIds || [], width: config.width, height: config.height, grid: config.grid, scale: config.scale,
      initialView: config.initialView, fog: config.fog, background: config.background, assets: { ...config.assets },
      tags: (config.tags || []).map(({ image, ...tag }) => tag) };
  }

  async function validateImages(config, { Image: ImageClass = globalThis.Image } = {}) {
    if (!ImageClass) fail('This browser cannot validate map images. Try a current browser.');
    for (const [id, source] of Object.entries(config.assets)) {
      const image = new ImageClass();
      try {
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error(`Image “${id}” could not be decoded. Rebuild the map mod with a valid raster image.`));
          image.src = source;
        });
        if (!positive(image.naturalWidth) || !positive(image.naturalHeight) || image.naturalWidth * image.naturalHeight > 100000000) fail(`Image “${id}” must contain between 1 and 100 million pixels. Resize it before importing.`);
      } finally { image.onload = null; image.onerror = null; image.src = ''; }
    }
    return config;
  }

  async function parseFile(file) {
    if (!file || typeof file.text !== 'function' || file.size > MAX_FILE_BYTES) fail('Choose a map mod smaller than 150 MB.');
    let raw;
    try { raw = JSON.parse(await file.text()); }
    catch (_) { fail('This file is not valid JSON. Choose a .seerjourney-mod.json file.'); }
    return validate(raw);
  }

  async function loadBundled(url, { fetch: fetcher = globalThis.fetch, baseURL = globalThis.location?.href, embedAssets = true } = {}) {
    const manifestURL = new URL(url, baseURL);
    if (!['http:', 'https:'].includes(manifestURL.protocol) || baseURL && manifestURL.origin !== new URL(baseURL).origin) fail('Bundled map mods must load from this app’s origin.');
    const response = await fetcher(manifestURL.href, { cache: 'no-cache', redirect: 'error' });
    if (!response.ok) fail('The bundled map could not be loaded. Import its downloaded map mod instead.');
    if (Number(response.headers?.get('content-length')) > MAX_FILE_BYTES) fail('The map manifest exceeds the 150 MB package limit.');
    const text = await response.text();
    if (text.length > MAX_FILE_BYTES) fail('The map manifest exceeds the 150 MB package limit.');
    let raw;
    try { raw = JSON.parse(text); }
    catch (_) { fail('The bundled map manifest is not valid JSON.'); }
    if (!record(raw) || !record(raw.assets) || Object.keys(raw.assets).length > MAX_TAGS + 4) fail('The bundled map is missing its image assets.');
    const assets = Object.create(null), assetURLs = new Set();
    let total = text.length;
    for (const [key, value] of Object.entries(raw.assets)) {
      if (typeof value !== 'string') fail('A bundled image path is invalid.');
      if (value.startsWith('data:')) { assets[key] = value; continue; }
      if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*\.(png|jpe?g|webp)$/i.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) fail('Bundled image paths must stay inside the map mod folder.');
      const imageURL = new URL(value, manifestURL);
      // Only app-bundled, validated relative raster paths may stay as URLs.
      // Portable imports still require embedded images. Large originals are
      // fetched on demand for exports instead of copied into JS at startup.
      if (!embedAssets) { assets[key] = imageURL.href; assetURLs.add(imageURL.href); continue; }
      const imageResponse = await fetcher(imageURL.href, { redirect: 'error' });
      if (!imageResponse.ok) fail(`A bundled map image is missing: ${value}`);
      if (Number(imageResponse.headers?.get('content-length')) > MAX_FILE_BYTES) fail('A bundled map image exceeds the package size limit.');
      const buffer = new Uint8Array(await imageResponse.arrayBuffer());
      total += Math.ceil(buffer.length / 3) * 4;
      if (total > MAX_FILE_BYTES) fail('The bundled map exceeds the 150 MB package limit.');
      const extension = value.split('.').at(-1).toLowerCase(), type = extension === 'jpg' ? 'jpeg' : extension;
      let binary = '';
      for (let offset = 0; offset < buffer.length; offset += 32768) binary += String.fromCharCode(...buffer.subarray(offset, offset + 32768));
      assets[key] = `data:image/${type};base64,${btoa(binary)}`;
    }
    return validate({ ...raw, assets }, { assetURLs });
  }

  return { FORMAT, VERSION, MAX_FILE_BYTES, MAX_CELLS, MAX_TAGS, validate, validateImages, toPortable, parseFile, loadBundled };
});
