/* The map renderer only reads a validated mod. It never knows a campaign name. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  let sequence = 0;
  function node(tag, attributes = {}) {
    const element = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  }
  function create(config, core, raster = {}) {
    const id = `mapjourney-fog-${++sequence}`;
    const element = node('g', { 'pointer-events': 'none', 'data-map-layers': config.id });
    const defs = node('defs'), clip = node('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
    const bounds = node('clipPath', { id: `${id}-bounds`, clipPathUnits: 'userSpaceOnUse' });
    bounds.append(node('rect', config.grid.bounds));
    defs.append(clip, bounds);
    element.append(defs, raster.background || node('image', { href: config.backgroundImage, width: config.width, height: config.height, preserveAspectRatio: 'none' }));
    const cover = config.fogImage
      ? raster.fog || node('image', { href: config.fogImage, width: config.width, height: config.height, preserveAspectRatio: 'none' })
      : node('g');
    if (config.fogImage) cover.setAttribute('clip-path', `url(#${id})`);
    const boundedCover = node('g', { 'clip-path': `url(#${id}-bounds)` });
    boundedCover.append(cover); element.append(boundedCover);
    const tags = (config.tags || []).map(tag => {
      const image = node('image', { href: tag.image, x: tag.x, y: tag.y, width: tag.width, height: tag.height,
        'data-tag-id': tag.id, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      element.append(image);
      return { tag, image };
    });
    let previousRevealed;
    function render(revealed) {
      const visible = new Set(revealed);
      if (previousRevealed && visible.size === previousRevealed.size && [...visible].every(key => previousRevealed.has(key))) return;
      previousRevealed = visible;
      if (config.fogImage || config.fogColor) {
        const fragment = document.createDocumentFragment();
        for (const key of config.fogHexes) {
          if (visible.has(key)) continue;
          const cell = core.parseKey(key, config.grid);
          if (cell) fragment.append(node('polygon', { points: core.points(cell.column, cell.row, config.grid, config.fogImage ? .25 : 0),
            ...(!config.fogImage ? { fill: config.fogColor, stroke: '#8ea396', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' } : {}) }));
        }
        (config.fogImage ? clip : cover).replaceChildren(fragment);
      }
      for (const { tag, image } of tags) image.setAttribute('visibility', tag.visibility === 'always' || visible.has(tag.cell) ? 'visible' : 'hidden');
    }
    render([]);
    return { element, render };
  }
  window.MapJourneyLayers = { create };
})();
