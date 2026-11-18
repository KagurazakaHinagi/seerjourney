/* Bounded, viewport-selected raster tiles. Coordinates remain in map units. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampaignMapTiles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function selectTiles(manifest, view, width, height, dpr = 1) {
    if (!(view.scale > 0) || ![view.x, view.y, width, height, dpr].every(Number.isFinite) || width <= 0 || height <= 0) return [];
    // Two device pixels per CSS pixel keep text crisp without tripling the
    // active texture area on high-density phones. Never upscale source data.
    const density = view.scale * Math.max(1, Math.min(2, dpr));
    const level = manifest.levels.find(item => Math.min(item.width / manifest.width, item.height / manifest.height) >= density) || manifest.levels.at(-1);
    const sx = manifest.width / level.width, sy = manifest.height / level.height, size = manifest.tileSize;
    const left = Math.max(0, Math.floor(-view.x / view.scale / sx / size) - 1);
    const top = Math.max(0, Math.floor(-view.y / view.scale / sy / size) - 1);
    const right = Math.min(level.columns - 1, Math.floor((width - view.x) / view.scale / sx / size) + 1);
    const bottom = Math.min(level.rows - 1, Math.floor((height - view.y) / view.scale / sy / size) + 1);
    const tiles = [];
    for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) {
      tiles.push({ key: `${level.id}/${column}-${row}`, level: level.id, column, row,
        x: column * size * sx, y: row * size * sy,
        width: Math.min(size + manifest.overlap, level.width - column * size) * sx,
        height: Math.min(size + manifest.overlap, level.height - row * size) * sy });
    }
    return tiles;
  }

  function create(manifest, options = {}) {
    const doc = options.document || document, ImageClass = options.Image || Image;
    const node = (name, attributes = {}) => {
      const element = doc.createElementNS(NS, name);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      return element;
    };
    const background = node('g', { 'data-tile-layer': 'background' }), fog = node('g', { 'data-tile-layer': 'fog' });
    const base = { background: node('g'), fog: node('g') }, detail = { background: node('g'), fog: node('g') };
    background.append(base.background, detail.background); fog.append(base.fog, detail.fog);
    const entries = new Map();
    let active = 0, disposed = false, overviewRemaining, resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // A missing detail tile leaves the already-loaded overview visible. Never
    // expose the revealed layer while its paired fog tile is still loading.
    function start(entry) {
      entry.state = 'loading'; active++;
      let remaining = 2;
      const finish = error => {
        if (entry.state !== 'loading') return;
        if (!error && --remaining) return;
        active--; entry.state = error ? 'error' : 'ready';
        if (!error) {
          const target = entry.overview ? base : detail;
          for (const name of ['background', 'fog']) {
            const tile = entry.tile, src = entry.loaders[name].src;
            const image = node('image', { href: src, x: tile.x, y: tile.y, width: tile.width, height: tile.height,
              preserveAspectRatio: 'none', 'data-tile': tile.key });
            target[name].append(image); entry.nodes.push(image);
          }
        }
        for (const image of Object.values(entry.loaders)) { image.onload = image.onerror = null; image.src = ''; }
        entry.loaders = {};
        if (entry.overview) {
          if (error) rejectReady(new Error('The map overview could not load.'));
          else if (--overviewRemaining === 0) resolveReady();
        }
        pump();
      };
      for (const name of ['background', 'fog']) {
        const image = new ImageClass(), tile = entry.tile;
        entry.loaders[name] = image;
        image.decoding = 'async'; image.onload = () => finish(false); image.onerror = () => finish(true);
        const url = new URL(manifest.layers[name].replace('{id}', tile.level).replace('{column}', tile.column).replace('{row}', tile.row), manifest.baseURL);
        url.searchParams.set('v', `${manifest.sourceSha256?.[name]?.slice(0, 16) || manifest.version}-${manifest.quality}-${manifest.version}`);
        image.src = url.href;
      }
    }
    function pump() {
      if (disposed) return;
      // At most six simultaneous raster requests, including rapidly moving
      // views. Obsolete queued/loading tiles are canceled by paint().
      for (const entry of entries.values()) {
        if (active >= 3) break;
        if (entry.state === 'queued') start(entry);
      }
    }
    function enqueue(tile, overview = false) {
      const entry = { tile, overview, state: 'queued', nodes: [], loaders: {} };
      entries.set(tile.key, entry);
    }
    function remove(entry) {
      if (entry.state === 'loading') active--;
      entry.state = 'removed';
      for (const image of Object.values(entry.loaders)) { image.onload = image.onerror = null; image.src = ''; }
      for (const node of entry.nodes) node.remove();
      entries.delete(entry.tile.key);
    }
    const lowest = manifest.levels[0];
    const overview = selectTiles({ ...manifest, levels: [lowest] }, { x: 0, y: 0, scale: 1 }, manifest.width, manifest.height);
    overviewRemaining = overview.length;
    for (const tile of overview) enqueue(tile, true);
    pump();
    function paint(view, width, height, dpr = 1) {
      if (disposed) return;
      const tiles = selectTiles(manifest, view, width, height, dpr), wanted = new Set(tiles.map(tile => tile.key));
      for (const entry of entries.values()) if (!entry.overview && !wanted.has(entry.tile.key)) remove(entry);
      for (const tile of tiles) if (!entries.has(tile.key)) enqueue(tile);
      pump();
    }
    function dispose() { disposed = true; for (const entry of entries.values()) remove(entry); }
    return { background, fog, ready, paint, dispose };
  }
  return { selectTiles, create };
});
