/* Map overlays and fog-preserving previews for the expedition's daily log. */
(function () {
  'use strict';
  const t = window.MapJourneyI18n.t, number = window.MapJourneyI18n.number;
  const NS = 'http://www.w3.org/2000/svg';
  const INK = '#17342b', GREEN = '#216d51', IVORY = '#f1f7ed', BRASS = '#e7bd6a';
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  // CJK glyphs occupy roughly an em rather than the Latin label's half-em.
  // Reserve their full width so translated camp pills and previews do not clip.
  const textWidth = (text, size) => Array.from(text).reduce((width, glyph) => width + size * (glyph.codePointAt(0) > 255 ? 1 : .56), 0);

  function node(tag, attributes = {}, text) {
    const element = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function create({ core: C, config, layer, onOpenDay }) {
    let pins = [];

    function routeLines(data, target) {
      const group = node('g', { 'pointer-events': 'none', 'aria-hidden': 'true' });
      for (const segment of data.segments) {
        const d = `M${segment.from.x} ${segment.from.y}L${segment.to.x} ${segment.to.y}`;
        // A missing mapped day leaves an uncertain connection, including days
        // recorded without a location. Dash the casing too so its gaps stay clear.
        const gap = segment.to.day > segment.from.day + 1 ? { 'stroke-dasharray': '8 10' } : {};
        const stroke = { d, fill: 'none', 'stroke-linecap': 'round', ...gap,
          'vector-effect': 'non-scaling-stroke' };
        group.append(node('path', { ...stroke, stroke: IVORY, 'stroke-width': 7 }),
          node('path', { ...stroke, stroke: GREEN, 'stroke-width': 3 }));
      }
      target.append(group);
    }

    function pin(stop, latestId, { interactive = true, count = 1 } = {}) {
      const camping = stop.id === latestId;
      let label = t(camping ? 'Day {day}, current camp' : 'Day {day}', { day: number(stop.day) });
      if (count > 1) label = t('{dayLabel}. Open to manage all {count} days at this stop', { dayLabel: label, count: number(count) });
      const group = node('g', { class: camping ? 'journey-pin journey-camp' : 'journey-pin', 'data-trip-id': stop.id,
        'data-x': stop.x, 'data-y': stop.y, 'aria-label': label, ...(interactive ? { role: 'button', tabindex: '0', cursor: 'pointer' } : { 'aria-hidden': 'true', 'pointer-events': 'none' }) });
      group.append(node('title', {}, label));
      const focusRing = node('circle', { r: 25, fill: 'none', stroke: INK, 'stroke-width': 2, visibility: 'hidden', 'pointer-events': 'none' });
      group.append(focusRing);
      group.append(node('circle', { r: 22, fill: 'transparent', 'pointer-events': interactive ? 'all' : 'none' }));
      group.append(node('circle', { r: 18, fill: camping ? BRASS : GREEN, stroke: IVORY, 'stroke-width': 3 }));
      if (camping) {
        const campIcon = node('svg', { x: -12, y: -12, width: 24, height: 24, viewBox: '0 0 24 24', color: INK, 'aria-hidden': 'true', 'pointer-events': 'none' });
        campIcon.append(node('use', { href: '#i-camp' }));
        group.append(campIcon);
        const text = t('Day {day}', { day: number(stop.day) }), width = Math.max(48, textWidth(text, 12) + 16);
        group.append(node('rect', { x: -width / 2, y: 21, width, height: 24, rx: 12, fill: IVORY, stroke: GREEN, 'stroke-width': 1, 'pointer-events': interactive ? 'all' : 'none' }));
        group.append(node('text', { x: 0, y: 33, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: INK, 'font-family': FONT, 'font-size': 12, 'font-weight': 650, 'pointer-events': 'none' }, text));
      } else {
        const text = number(stop.day), width = Math.max(36, textWidth(text, 13) + 16);
        if (width > 36) group.append(node('rect', { x: -width / 2, y: -18, width, height: 36, rx: 18, fill: GREEN, stroke: IVORY, 'stroke-width': 3 }));
        group.append(node('text', { x: 0, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: IVORY, 'font-family': FONT, 'font-size': 13, 'font-weight': 650, 'pointer-events': 'none' }, text));
      }
      if (count > 1) {
        const text = `+${number(count - 1)}`, width = Math.max(25, textWidth(text, 12) + 12);
        group.append(node('rect', { x: 11, y: -29, width, height: 22, rx: 11, fill: IVORY, stroke: GREEN, 'stroke-width': 1, 'pointer-events': interactive ? 'all' : 'none' }));
        group.append(node('text', { x: 11 + width / 2, y: -18, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: INK, 'font-family': FONT, 'font-size': 12, 'font-weight': 650, 'pointer-events': 'none' }, text));
      }
      if (interactive) {
        group.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); event.stopPropagation(); onOpenDay(stop.id);
          }
        });
        group.addEventListener('focus', () => focusRing.setAttribute('visibility', 'visible'));
        group.addEventListener('blur', () => focusRing.setAttribute('visibility', 'hidden'));
      }
      return group;
    }

    function drawPins(data, target, scale, latestId, interactive = true) {
      const groups = new Map(), drawn = [];
      for (const stop of data.stops) {
        if (!groups.has(stop.hex)) groups.set(stop.hex, []);
        groups.get(stop.hex).push(stop);
      }
      for (const stops of groups.values()) {
        // A bounded fan keeps short revisits individually available. Long stays
        // get a compact count; opening it exposes every day at this stop.
        const clustered = stops.length > 7;
        const shown = clustered ? [stops.at(-1)] : stops;
        for (let index = 0; index < shown.length; index++) {
          const stop = shown[index], count = clustered ? stops.length : 1;
          const angle = -Math.PI / 2 + index * Math.PI * 2 / shown.length;
          const radius = shown.length > 1 ? Math.max(25, 23 / Math.sin(Math.PI / shown.length)) : 0;
          const offset = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
          if (radius) {
            const leader = node('line', { x1: 0, y1: 0, x2: offset.x, y2: offset.y, stroke: GREEN, 'stroke-width': 1.5, 'stroke-dasharray': '2 3', 'pointer-events': 'none', 'aria-hidden': 'true' });
            const anchor = node('g'); anchor.append(leader); target.append(anchor);
            drawn.push({ element: anchor, stop, offset: { x: 0, y: 0 } });
          }
          const element = pin(stop, latestId, { interactive, count });
          target.append(element); drawn.push({ element, stop, offset });
        }
      }
      for (const item of drawn) place(item, scale);
      return drawn;
    }

    function place({ element, stop, offset }, scale) {
      element.setAttribute('transform', `translate(${stop.x} ${stop.y}) scale(${1 / scale}) translate(${offset.x} ${offset.y})`);
    }

    function render(session, scale, participant = null) {
      const data = C.journey(session.tripDays, config.grid, participant);
      layer.replaceChildren(); pins = [];
      if (!session.showJourney) return data;
      routeLines(data, layer);
      // A character's last stop is only a camp if it is the campaign's current camp.
      const latestId = participant ? C.sortTripDays(session.tripDays).filter(day => day.hex).at(-1)?.id : data.stops.at(-1)?.id;
      pins = drawPins(data, layer, scale, latestId);
      return data;
    }

    function paint(scale) {
      if (!Number.isFinite(scale) || scale <= 0) return;
      for (const item of pins) place(item, scale);
    }

    function snapshot(entry, session) {
      const hex = C.parseKey(entry?.hex, config.grid);
      if (!hex) return null;
      let previous = null, latest = entry;
      for (const log of session.tripDays) {
        if (log.hex === null) continue;
        if (log.day < entry.day && (!previous || log.day > previous.day)) previous = log;
        if (log.day > latest.day) latest = log;
      }
      const data = C.journey(previous ? [previous, entry] : [entry], config.grid);
      const width = 360, height = 224;
      const xs = data.stops.map(stop => stop.x), ys = data.stops.map(stop => stop.y);
      const spanX = Math.max(config.grid.columnStep * 4, Math.max(...xs) - Math.min(...xs));
      const spanY = Math.max(config.grid.rowStep * 3, Math.max(...ys) - Math.min(...ys));
      // Reserve screen-space room for the endpoint labels even on long routes.
      const insetX = Math.max(48, ...data.stops.map(stop => (textWidth(t('Day {day}', { day: number(stop.day) }), 12) + 16) / 2 + 12));
      const scale = Math.min((width - insetX * 2) / spanX, (height - 112) / spanY);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2, centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
      const x = width / 2 - centerX * scale, y = height / 2 - centerY * scale;
      const description = previous
        ? t('Day {day} map preview, route from Day {previousDay}. Hidden map content stays hidden.', { day: number(entry.day), previousDay: number(previous.day) })
        : t('Day {day} map preview. Hidden map content stays hidden.', { day: number(entry.day) });
      const root = node('svg', { xmlns: NS, class: 'trip-snapshot', viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img', 'aria-label': description, preserveAspectRatio: 'xMidYMid meet', overflow: 'hidden' });
      root.append(node('title', {}, description), node('rect', { width, height, fill: IVORY }));
      const world = node('g', { transform: `translate(${x} ${y}) scale(${scale})`, 'pointer-events': 'none' });
      const tiles = config.tileManifest && window.CampaignMapTiles?.create(config.tileManifest);
      const layers = window.MapJourneyLayers.create(config, C, tiles || {});
      if (tiles) {
        root.disposeMapTiles = tiles.dispose;
        tiles.paint({ x, y, scale }, width, height, window.devicePixelRatio || 1);
        tiles.ready.catch(() => { /* Keep the textual day/location if a preview is unavailable. */ });
      }
      layers.render(session.revealed); world.append(layers.element);
      routeLines(data, world);
      drawPins(data, world, scale, latest.id, false);
      root.append(world);
      return root;
    }

    return { render, paint, snapshot };
  }

  window.MapJourneyJourneyView = { create };
})();
