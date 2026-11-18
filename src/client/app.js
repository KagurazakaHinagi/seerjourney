(async function () {
  'use strict';
  const I = window.MapJourneyI18n;
  const t = I.t;
  const C = window.MapJourneyCore;
  const config = window.MapJourneyBootstrap ? await window.MapJourneyBootstrap.ready : window.MAPJOURNEY_MAP;
  if (!config) return;
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const VIEW_KEY = `seerjourney.campaign.view.${config.id}`;
  const markerUI = window.MapJourneyMarkerUI;
  const COLOR = markerUI.colors;
  const markerPickers = [markerUI.createPicker($('marker-kind'), 'kind'), markerUI.createPicker($('marker-color'), 'color')];
  const svg = $('map-svg'), viewport = $('map-viewport');
  let viewportSize = { width: viewport.clientWidth, height: viewport.clientHeight }, pointerRect;
  let paintedScale, paintedFitScale, hoverState, accessState;
  let session, tool = 'explore', brushMode = 'reveal', selected = null, hover = null, editingHex = null;
  let view = { x: 0, y: 0, scale: 0.05 }, fitScale = 0.05, loaded = false;
  let undoStack = [], redoStack = [], pendingSave, toastTimer, spaceHeld = false;
  let animationFrame = 0, cameraMode = 'explore';
  let lastWidth = 0, lastHeight = 0;
  const pointers = new Map();
  const phoneLayout = window.matchMedia('(max-width: 600px), (max-height: 500px) and (max-width: 950px)');
  const touchInput = window.matchMedia('(pointer: coarse)');
  let gesture = null, brushStroke = null, fogFrame = 0;
  let revealedSet = new Set(), markerByHex = new Map();
  let gameLog, adventureNotes, suppliesPage, journeyView, journeyData = { stops: [], segments: [], visited: [] };
  let markerBaseline = '';
  const markerValues = () => JSON.stringify({ title: $('marker-title').value, note: $('marker-note').value, kind: $('marker-kind').value, color: $('marker-color').value });
  const hasLocalDraft = () => Boolean(brushStroke || (session && session.name !== sync.getSnapshot()?.session.name && !sync.hasPending()) || ($('marker-dialog').open && markerValues() !== markerBaseline) || gameLog?.hasDraft() || adventureNotes?.hasDraft() || suppliesPage?.hasDraft());
  const sync = window.CampaignClient.create({ hasDraft: hasLocalDraft, isHidden: () => document.hidden });
  const canEdit = () => sync.canEdit();
  const participantPaths = window.MapJourneyParticipantPaths.create({ core: C, root: $('participant-paths'), onEmptyFocus: () => $('search-markers').focus({ preventScroll: true }), onSelect(name) {
    stopGesture();
    session.showJourney = true;
    renderJourney(); refreshFog(); saveNow();
    if (phoneLayout.matches) { $('search-markers').blur(); setJournal(false); viewport.focus({ preventScroll: true }); }
    toast(name ? t('Showing {name}’s path', { name }) : t('Showing the whole journey'));
  } });


  function setJournal(open, returnFocus = false) {
    document.body.classList.toggle('journal-collapsed', !open);
    $('toggle-journal').setAttribute('aria-expanded', String(open));
    $('journal').inert = !open;
    $('journal').setAttribute('aria-hidden', String(!open));
    if (returnFocus) $('toggle-journal').focus({ preventScroll: true });
  }

  function closeOptions() { if ($('options-dialog')?.open) $('options-dialog').close(); }

  function openDialog(id) {
    stopGesture();
    closeOptions();
    setJournal(false);
    const dialog = $(id);
    if (!dialog.open) dialog.showModal();
  }

  function updateVisualViewport() {
    const visual = window.visualViewport;
    const height = visual?.height || window.innerHeight;
    document.documentElement.style.setProperty('--visual-height', `${height}px`);
    document.documentElement.style.setProperty('--visual-top', `${visual?.offsetTop || 0}px`);
    document.documentElement.style.setProperty('--keyboard-inset', `${Math.max(0, window.innerHeight - height - (visual?.offsetTop || 0))}px`);
    const editing = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
    document.body.classList.toggle('keyboard-open', Boolean(editing && window.innerHeight - height > 140));
  }

  function node(tag, attributes = {}, text) {
    const el = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200);
  }

  function finishLoading() {
    $('map-loading').hidden = true;
    document.body.classList.remove('map-booting');
    viewport.removeAttribute('aria-busy');
  }

  if (!C || !config) {
    finishLoading();
    $('map-error').hidden = false;
    $('map-error').textContent = t("Map files are missing. Keep index.html, core.js, app.js and the assets folder together.");
    return;
  }

  const grid = config.grid, fog = new Set(config.fogHexes);
  const defs = node('defs');
  const mapClip = node('clipPath', { id: 'map-boundary', clipPathUnits: 'userSpaceOnUse' });
  mapClip.append(node('rect', grid.bounds));
  defs.append(mapClip);
  const world = node('g', { id: 'map-world' });
  const mapTiles = config.tileManifest ? window.CampaignMapTiles.create(config.tileManifest) : {};
  const mapLayers = window.MapJourneyLayers.create(config, C, mapTiles);
  const hexLayer = node('g', { 'clip-path': 'url(#map-boundary)', 'pointer-events': 'none' });
  const selectionPolygon = node('polygon', { fill: '#eac880', 'fill-opacity': '.18', stroke: '#f1ca7e', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' });
  const hoverPolygon = node('polygon', { fill: '#fff9db', 'fill-opacity': '.18', stroke: '#fff3c6', 'stroke-width': '1.4', 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' });
  hexLayer.append(selectionPolygon, hoverPolygon);
  const markerLayer = node('g', { id: 'map-markers' });
  const journeyLayer = node('g', { id: 'map-journey' });
  world.append(mapLayers.element, hexLayer, markerLayer, journeyLayer);
  svg.append(defs, world);

  function saveNow() {
    clearTimeout(pendingSave);
    if (!session || brushStroke) return false;
    session.view = { ...view, width: viewport.clientWidth, height: viewport.clientHeight };
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view: session.view, showJourney: session.showJourney })); } catch (_) { /* Viewing needs no browser storage. */ }
    if (canEdit()) sync.save(session);
    return !sync.hasPending();
  }

  function scheduleSave() {
    clearTimeout(pendingSave);
    pendingSave = setTimeout(saveNow, 300);
  }

  function localView() {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; } catch (_) { return {}; }
  }

  const snapshot = () => JSON.stringify({ revealed: session.revealed, markers: session.markers, tripDays: session.tripDays, adventureNotes: session.adventureNotes || [] });

  function mutate(action) {
    if (!canEdit()) return false;
    stopGesture();
    const before = snapshot();
    action();
    return recordChange(before);
  }

  function recordChange(before) {
    if (!canEdit()) { Object.assign(session, JSON.parse(before)); refresh(); return false; }
    if (snapshot() === before) return false;
    undoStack.push(before);
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    session.updatedAt = new Date().toISOString();
    refresh();
    saveNow();
    return true;
  }

  function restoreHistory(redo = false) {
    if (!canEdit()) return;
    stopGesture();
    const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack;
    if (!from.length) return;
    to.push(snapshot());
    const suppliedDays = new Set(session.tripDays.filter(entry => entry.supplies !== undefined).map(entry => entry.id));
    Object.assign(session, JSON.parse(from.pop()));
    for (const entry of session.tripDays) if (suppliedDays.has(entry.id)) entry.supplies ||= window.MapJourneySuppliesCore.empty();
    session.updatedAt = new Date().toISOString();
    refresh();
    saveNow();
  }

  function refresh() {
    refreshTitle();
    revealedSet = new Set(session.revealed);
    markerByHex = new Map(session.markers.map(m => [m.hex, m]));
    participantPaths.update(session.tripDays, $('search-markers').value.trim());
    renderJourney();
    refreshFog();
    renderMarkers();
    renderJournal();
    gameLog?.refresh();
    adventureNotes?.refresh();
    suppliesPage?.refresh();
  }

  function refreshTitle() {
    const name = session?.name || config.name;
    $('map-title').textContent = name;
    $('map-title').title = name;
    svg.setAttribute('aria-label', t('{map} map', { map: name }));
    document.title = t('{map} · SeerJourney', { map: name });
  }

  function renderJourney() {
    const participant = participantPaths.getValue();
    const filtered = journeyView.render(session, view.scale, participant);
    // The expedition's explored tally always describes the whole campaign.
    journeyData = participant ? C.journey(session.tripDays, grid) : filtered;
    $('toggle-journal').title = participant ? t('Character path: {name}', { name: participant }) : t('Search notes and places');
    $('toggle-journal').classList.toggle('has-character-path', Boolean(participant));
  }

  function refreshFog() {
    if (fogFrame) cancelAnimationFrame(fogFrame);
    fogFrame = 0;
    mapLayers.render(session.revealed);
    $('revealed-count').textContent = I.number(session.revealed.length);
    $('fog-total').textContent = I.number(fog.size);
    $('marker-count').textContent = I.number(session.markers.length);
    $('current-day').textContent = t("Day {day}", { day: I.number(C.nextTripDay(session.tripDays)) });
    $('explored-count').textContent = I.number(journeyData.visited.length);
    $('toggle-journey').setAttribute('aria-pressed', String(session.showJourney));
    $('toggle-journey').setAttribute('aria-label', session.showJourney ? t("Hide journey and trip days") : t("Show journey and trip days"));
    $('toggle-journey').title = session.showJourney ? t("Hide journey (J)") : t("Show journey (J)");
    $('undo').disabled = !canEdit() || !undoStack.length;
    $('redo').disabled = !canEdit() || !redoStack.length;
    $('reveal-all').disabled = !canEdit() || session.revealed.length === fog.size;
    $('restore-fog').disabled = !canEdit() || !session.revealed.length;
    updateHover();
  }

  function renderMarkers() {
    const fragment = document.createDocumentFragment();
    for (const marker of session.markers) {
      const hex = C.parseKey(marker.hex, grid), p = C.center(hex.column, hex.row, grid);
      const group = node('g', { class: 'map-marker', 'data-hex': marker.hex, 'data-x': p.x, 'data-y': p.y,
        transform: `translate(${p.x} ${p.y}) scale(${1 / view.scale})`,
        role: 'button', tabindex: '0', 'aria-label': t("{title}, {hex}. Read marker.", { title: marker.title, hex: C.label(hex) }), cursor: 'pointer' });
      group.append(node('title', {}, marker.title));
      group.append(node('circle', { r: 22, fill: 'transparent', 'pointer-events': 'all' }));
      group.append(node('circle', { r: 13, fill: '#152c29', stroke: COLOR[marker.color], 'stroke-width': 2 }));
      const symbol = markerUI.icon(marker.kind);
      for (const [attribute, value] of Object.entries({ x: -10, y: -10, width: 20, height: 20, color: COLOR[marker.color], 'pointer-events': 'none' })) symbol.setAttribute(attribute, value);
      group.append(symbol);
      group.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openMarker(hex); }
      });
      fragment.append(group);
    }
    markerLayer.replaceChildren(fragment);
  }

  function renderJournal() {
    participantPaths.update(session.tripDays, $('search-markers').value.trim());
    const search = $('search-markers').value.trim().toLocaleLowerCase();
    const markers = session.markers.filter(m => `${m.title} ${m.note} ${C.label(C.parseKey(m.hex, grid))}`.toLocaleLowerCase().includes(search));
    const fragment = document.createDocumentFragment();
    if (!markers.length) {
      const el = document.createElement('div');
      el.className = 'empty-state';
      const heading = document.createElement('strong');
      heading.textContent = search ? t("No matching discoveries") : t("Your story starts here");
      const description = document.createElement('p');
      description.textContent = search ? t("Try another place name or a word from your notes.") : canEdit() ? t("Choose Marker, then click any tile to record a place, a camp, or a warning.") : t("Discovered places will appear here as the campaign progresses.");
      el.append(heading, description);
      fragment.append(el);
    }
    for (const marker of markers) {
      const hex = C.parseKey(marker.hex, grid);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'marker-item';
      button.setAttribute('aria-label', t("Open {title}, {hex}", { title: marker.title, hex: C.label(hex) }));
      const symbol = document.createElement('span');
      symbol.className = 'marker-symbol'; symbol.style.color = COLOR[marker.color]; symbol.append(markerUI.icon(marker.kind));
      const text = document.createElement('span'); text.className = 'marker-text';
      const title = document.createElement('span'); title.className = 'marker-title'; title.textContent = marker.title;
      const subtitle = document.createElement('span'); subtitle.className = 'marker-subtitle';
      subtitle.textContent = `${C.label(hex)}${marker.note ? ' · ' + marker.note.replace(/\s+/g, ' ').slice(0, 65) : ''}`;
      text.append(title, subtitle); button.append(symbol, text);
      button.addEventListener('click', () => { setJournal(false); focusHex(hex); openMarker(hex); });
      fragment.append(button);
    }
    $('marker-list').replaceChildren(fragment);
  }

  function setTool(next) {
    if (next !== 'explore' && !canEdit()) return;
    stopGesture();
    if (next !== 'log') gameLog?.clearPlacement();
    tool = next;
    for (const mode of ['explore', 'brush', 'log', 'marker']) {
      $('tool-' + mode).classList.toggle('active', mode === tool);
      $('tool-' + mode).setAttribute('aria-pressed', String(mode === tool));
    }
    viewport.dataset.tool = tool;
    document.body.classList.toggle('brush-active', tool === 'brush');
    $('brush-options').hidden = tool !== 'brush';
    $('brush-label').textContent = brushMode === 'reveal' ? t("Reveal") : t("Refog");
    $('tool-brush').setAttribute('aria-label', brushMode === 'reveal' ? t("Reveal brush (B)") : t("Refog brush (B)"));
    for (const mode of ['reveal', 'hide']) $('brush-' + mode).setAttribute('aria-pressed', String(mode === brushMode));
    $('map-hint').textContent = {
      explore: t("Drag to explore · Tap a marker to read its note"),
      marker: t("Tap any tile to add a note"),
      log: t("Tap a tile to log a day · Manage every day at that stop"),
      brush: brushMode === 'reveal'
        ? (touchInput.matches ? t("Drag to reveal · Two fingers to move") : t("Drag to reveal · Space + drag to move"))
        : (touchInput.matches ? t("Drag to refog · Two fingers to move") : t("Drag to refog · Space + drag to move"))
    }[tool];
    updateHover();
  }

  function setBrushMode(mode) {
    stopGesture();
    brushMode = mode;
    setTool('brush');
  }

  function beginBrush(point) {
    if (!canEdit()) return;
    clearTimeout(pendingSave);
    brushStroke = { before: snapshot(), mode: brushMode, visited: new Set(), last: point };
    paintBrush(point);
  }

  function paintBrush(point) {
    if (!canEdit()) { finishBrush(true); return; }
    if (!brushStroke) return;
    let changed = false;
    for (const hex of C.hexesAlongSegment(brushStroke.last, point, grid)) {
      selected = hex;
      if (!fog.has(hex.key) || brushStroke.visited.has(hex.key)) continue;
      brushStroke.visited.add(hex.key);
      if (brushStroke.mode === 'reveal' && !revealedSet.has(hex.key)) {
        revealedSet.add(hex.key); changed = true;
      } else if (brushStroke.mode === 'hide' && revealedSet.has(hex.key)) {
        revealedSet.delete(hex.key); changed = true;
      }
    }
    brushStroke.last = point;
    if (changed) {
      session.revealed = [...revealedSet];
      if (!fogFrame) fogFrame = requestAnimationFrame(refreshFog);
    }
    updateHover();
  }

  function finishBrush(cancel = false) {
    if (!brushStroke) return;
    const { before } = brushStroke;
    brushStroke = null;
    if (cancel) {
      session.revealed = JSON.parse(before).revealed;
      revealedSet = new Set(session.revealed);
      refreshFog();
    } else if (!recordChange(before)) refreshFog();
  }

  function stopGesture(cancel = false) {
    finishBrush(cancel);
    const ids = [...pointers.keys()];
    pointers.clear(); gesture = null;
    viewport.classList.remove('dragging');
    document.body.classList.remove('map-interacting');
    for (const id of ids) if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
  }

  function updateHover() {
    const current = hover || selected;
    const state = `${hover?.key || ''}|${selected?.key || ''}|${current ? revealedSet.has(current.key) : ''}`;
    if (hoverState === state) return;
    hoverState = state;
    if (hover) {
      hoverPolygon.setAttribute('points', C.points(hover.column, hover.row, grid));
      hoverPolygon.setAttribute('visibility', 'visible');
    } else hoverPolygon.setAttribute('visibility', 'hidden');
    if (selected) {
      selectionPolygon.setAttribute('points', C.points(selected.column, selected.row, grid));
      selectionPolygon.setAttribute('visibility', 'visible');
    } else selectionPolygon.setAttribute('visibility', 'hidden');
    $('hover-label').textContent = current ? t("{hex} · {state}", { hex: C.label(current), state: fog.has(current.key) ? revealedSet.has(current.key) ? t("Revealed") : t("Unrevealed") : t("Charted") }) : t("Choose a tile to explore");
  }

  function activateHex(hex) {
    if (!hex || !loaded) return;
    stopGesture();
    selected = hex;
    if (tool === 'marker') openMarker(hex);
    else if (tool === 'log') gameLog.openTrip(hex);
    else if (tool === 'brush') { beginBrush(C.center(hex.column, hex.row, grid)); finishBrush(); }
    else if (markerByHex.has(hex.key)) openMarker(hex);
    updateHover();
  }

  function openMarker(hex) {
    stopGesture();
    closeOptions();
    if (phoneLayout.matches) setJournal(false);
    selected = hex; editingHex = hex;
    const marker = markerByHex.get(hex.key);
    if (!marker && !canEdit()) return;
    $('marker-dialog-title').textContent = canEdit() ? t('Mark this place') : t('Place notes');
    $('marker-cancel').textContent = canEdit() ? t('Cancel') : t('Close');
    $('marker-hex').textContent = C.label(hex);
    $('marker-title').value = marker?.title || '';
    $('marker-title').setCustomValidity('');
    $('marker-note').value = marker?.note || '';
    $('marker-color').value = marker?.color || 'gold';
    $('marker-kind').value = marker?.kind || 'place';
    markerPickers.forEach(picker => picker.refresh());
    $('marker-delete').hidden = !marker;
    $('marker-save').textContent = marker ? t("Save changes") : t("Add marker");
    markerBaseline = markerValues();
    updateHover();
    $('marker-dialog').tabIndex = -1;
    const focusTarget = touchInput.matches || !canEdit() ? $('marker-dialog') : $('marker-title');
    focusTarget.setAttribute('autofocus', '');
    if (!$('marker-dialog').open) $('marker-dialog').showModal();
    focusTarget.removeAttribute('autofocus');
    focusTarget.focus({ preventScroll: true });
  }

  function ask(title, message, accept = t("Continue"), cancelLabel = t("Cancel")) {
    closeOptions();
    return new Promise(resolve => {
      const dialog = $('confirm-dialog');
      $('confirm-title').textContent = title; $('confirm-message').textContent = message;
      $('confirm-accept').textContent = accept;
      $('confirm-cancel').textContent = cancelLabel;
      const done = value => {
        dialog.close(); $('confirm-accept').onclick = null; $('confirm-cancel').onclick = null;
        dialog.removeEventListener('cancel', cancel); resolve(value);
      };
      const cancel = event => { event.preventDefault(); done(false); };
      $('confirm-accept').onclick = () => done(true); $('confirm-cancel').onclick = () => done(false);
      dialog.addEventListener('cancel', cancel); dialog.showModal(); $('confirm-cancel').focus();
    });
  }

  function clampView() {
    const previousScale = view.scale;
    view.scale = Math.max(fitScale * 0.65, Math.min(Math.max(1.3, fitScale * 16), view.scale));
    const { width, height } = viewportSize;
    if (view.scale !== previousScale) {
      view.x = width / 2 - (width / 2 - view.x) * view.scale / previousScale;
      view.y = height / 2 - (height / 2 - view.y) * view.scale / previousScale;
    }
    // Keep a meaningful part of the map in reach, including after a window resize.
    const marginX = Math.min(160, width / 3), marginY = Math.min(100, height / 3);
    view.x = Math.min(width - marginX, Math.max(marginX - config.width * view.scale, view.x));
    view.y = Math.min(height - marginY, Math.max(marginY - config.height * view.scale, view.y));
  }

  function paintView() {
    animationFrame = 0;
    clampView();
    world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
    mapTiles.paint?.(view, viewportSize.width, viewportSize.height, window.devicePixelRatio || 1);
    // Panning changes only translation. Marker sizes and scale readouts remain
    // unchanged, so avoid dirtying every SVG pin and fixed glass overlay.
    if (paintedScale === view.scale && paintedFitScale === fitScale) return;
    paintedScale = view.scale; paintedFitScale = fitScale;
    for (const marker of markerLayer.children) marker.setAttribute('transform', `translate(${marker.dataset.x} ${marker.dataset.y}) scale(${1 / view.scale})`);
    journeyView?.paint(view.scale);
    $('zoom-label').textContent = t("{percent}%", { percent: I.number(Math.round(view.scale / fitScale * 100)) });
    const pixelsPerUnit = grid.rowStep * view.scale / config.scale.distance;
    const target = 72 / pixelsPerUnit, magnitude = 10 ** Math.floor(Math.log10(target));
    const distance = [1, 2, 5].reduce((best, step) => step * magnitude <= target ? step * magnitude : best, magnitude);
    $('scale-line').style.width = `${distance * pixelsPerUnit}px`;
    $('map-distance').textContent = t("{distance} {unit}", { distance: I.number(distance, { maximumSignificantDigits: 3 }), unit: config.scale.unit });
  }

  function requestPaint() { if (!animationFrame) animationFrame = requestAnimationFrame(paintView); }

  function updateFitScale() {
    fitScale = Math.max(0.000001, Math.min((viewport.clientWidth - 32) / config.width, (viewport.clientHeight - 180) / config.height));
  }

  function fitMap(persist = true) {
    stopGesture();
    cameraMode = 'fit';
    updateFitScale();
    view = { scale: fitScale, x: (viewport.clientWidth - config.width * fitScale) / 2, y: (viewport.clientHeight - config.height * fitScale) / 2 };
    requestPaint(); if (persist) scheduleSave();
  }

  function exploreMap(persist = true) {
    cameraMode = 'explore';
    updateFitScale();
    const initial = config.initialView || { centerX: config.width / 2, centerY: config.height / 2, zoom: 1 };
    const scale = fitScale * initial.zoom;
    view = { scale, x: viewport.clientWidth / 2 - initial.centerX * scale,
      y: viewport.clientHeight / 2 - initial.centerY * scale };
    requestPaint(); if (persist) scheduleSave();
  }

  function restoreView(saved) {
    cameraMode = 'custom';
    view = { x: saved.x, y: saved.y, scale: saved.scale };
    if (Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
      view.x += (viewport.clientWidth - saved.width) / 2;
      view.y += (viewport.clientHeight - saved.height) / 2;
    }
    requestPaint();
  }

  function zoom(factor, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
    if (brushStroke) return;
    cameraMode = 'custom';
    const oldScale = view.scale;
    const nextScale = Math.max(fitScale * 0.65, Math.min(Math.max(1.3, fitScale * 16), oldScale * factor));
    view.x = x - (x - view.x) * nextScale / oldScale;
    view.y = y - (y - view.y) * nextScale / oldScale;
    view.scale = nextScale; requestPaint(); scheduleSave();
  }

  function focusHex(hex) {
    stopGesture();
    cameraMode = 'custom';
    selected = hex;
    const p = C.center(hex.column, hex.row, grid);
    view.scale = Math.max(view.scale, Math.min(0.65, fitScale * 5));
    view.x = viewport.clientWidth / 2 - p.x * view.scale;
    view.y = viewport.clientHeight / 2 - p.y * view.scale;
    requestPaint(); updateHover(); scheduleSave();
  }

  function localPoint(event) {
    const rect = pointers.size && pointerRect ? pointerRect : viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  const mapPoint = p => ({ x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale });
  const atPoint = p => { const m = mapPoint(p); return C.hexAt(m.x, m.y, grid); };
  function pinchMetrics() {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  viewport.addEventListener('pointerdown', event => {
    if (!loaded || (event.button !== 0 && event.button !== 1)) return;
    if (event.target.closest('button')) return;
    // Tapping the map dismisses the phone sheet without also revealing a tile.
    if (phoneLayout.matches && !document.body.classList.contains('journal-collapsed')) {
      setJournal(false); event.preventDefault(); return;
    }
    pointerRect = viewport.getBoundingClientRect();
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    viewport.setPointerCapture(event.pointerId);
    viewport.focus({ preventScroll: true });
    if (event.pointerType === 'touch') document.body.classList.add('map-interacting');
    if (pointers.size === 1) {
      const panOnly = spaceHeld || event.button === 1;
      gesture = { start: point, last: point, moved: false, panOnly, brush: tool === 'brush' && !panOnly,
        marker: event.target.closest('[data-hex]')?.dataset.hex || null,
        trip: event.target.closest('[data-trip-id]')?.dataset.tripId || null };
      if (gesture.brush) beginBrush(mapPoint(point));
    } else {
      // The first finger may have started painting. Roll it back before a pinch.
      finishBrush(true);
      gesture = { pinch: pinchMetrics(), moved: true, panOnly: true };
    }
    event.preventDefault();
  });

  viewport.addEventListener('pointermove', event => {
    const point = localPoint(event);
    if (!pointers.has(event.pointerId)) {
      hover = atPoint(point); updateHover(); return;
    }
    pointers.set(event.pointerId, point);
    if (pointers.size > 1) {
      const next = pinchMetrics(), previous = gesture.pinch;
      if (previous && previous.distance > 0) {
        zoom(next.distance / previous.distance, previous.x, previous.y);
        view.x += next.x - previous.x; view.y += next.y - previous.y; requestPaint();
      }
      gesture.pinch = next; gesture.moved = true;
    } else if (gesture.brush) {
      paintBrush(mapPoint(point));
    } else if (gesture.last) {
      if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 5) gesture.moved = true;
      if (gesture.moved || gesture.panOnly) {
        cameraMode = 'custom';
        view.x += point.x - gesture.last.x; view.y += point.y - gesture.last.y;
        viewport.classList.add('dragging'); requestPaint();
      }
      gesture.last = point;
    }
    hover = null; updateHover();
  });

  function endPointer(event, canceled = false) {
    if (!pointers.has(event.pointerId)) return;
    const point = localPoint(event), finishedGesture = gesture;
    if (finishedGesture.brush) {
      if (!canceled) paintBrush(mapPoint(point));
      finishBrush(canceled);
    }
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      viewport.classList.remove('dragging'); document.body.classList.remove('map-interacting'); gesture = null;
      if (!canceled && !finishedGesture.brush && !finishedGesture.moved && !finishedGesture.panOnly) {
        const markerHex = finishedGesture.marker && C.parseKey(finishedGesture.marker, grid);
        const trip = session.tripDays.find(entry => entry.id === finishedGesture.trip);
        const tripHex = trip?.hex && C.parseKey(trip.hex, grid);
        if (tool === 'explore' && tripHex) gameLog.openTrip(tripHex, trip.id);
        else if (tool === 'log') activateHex(tripHex || markerHex || atPoint(point));
        else if (markerHex) openMarker(markerHex);
        else activateHex(tripHex || atPoint(point));
      }
      scheduleSave();
    } else if (pointers.size === 1) {
      const remaining = [...pointers.values()][0];
      gesture = { start: remaining, last: remaining, moved: true, panOnly: true };
    }
  }
  viewport.addEventListener('pointerup', event => endPointer(event));
  viewport.addEventListener('pointercancel', event => endPointer(event, true));
  viewport.addEventListener('lostpointercapture', event => endPointer(event, true));
  viewport.addEventListener('pointerleave', () => { if (!pointers.size) { hover = null; updateHover(); } });
  viewport.addEventListener('wheel', event => {
    if (!loaded) return;
    event.preventDefault(); const p = localPoint(event);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    zoom(Math.exp(-Math.max(-150, Math.min(150, delta)) * 0.006), p.x, p.y);
  }, { passive: false });
  viewport.addEventListener('contextmenu', event => {
    event.preventDefault(); if (!loaded) return;
    const hex = atPoint(localPoint(event)); if (hex) openMarker(hex);
  });

  for (const mode of ['explore', 'brush', 'log', 'marker']) $('tool-' + mode).addEventListener('click', () => setTool(mode));
  function toggleJourney() {
    stopGesture();
    session.showJourney = !session.showJourney;
    renderJourney();
    refreshFog(); saveNow();
  }
  $('toggle-journey').addEventListener('click', toggleJourney);
  $('brush-reveal').addEventListener('click', () => setBrushMode('reveal'));
  $('brush-hide').addEventListener('click', () => setBrushMode('hide'));
  $('zoom-in').addEventListener('click', () => zoom(1.4));
  $('zoom-out').addEventListener('click', () => zoom(1 / 1.4));
  $('fit-map').addEventListener('click', () => fitMap());
  $('undo').addEventListener('click', () => restoreHistory());
  $('redo').addEventListener('click', () => restoreHistory(true));
  $('search-markers').addEventListener('input', renderJournal);
  $('session-name').addEventListener('input', () => {
    if (!canEdit()) { $('session-name').value = session.name; return; }
    session.name = $('session-name').value.trim().slice(0, 100) || t("The {map} expedition", { map: config.name });
    refreshTitle();
    session.updatedAt = new Date().toISOString(); saveNow();
  });
  $('session-name').addEventListener('change', () => { $('session-name').value = session.name; saveNow(); });
  let markerClosing = false;
  async function requestMarkerClose() {
    if (markerClosing) return;
    markerClosing = true;
    try {
      if (markerValues() !== markerBaseline && !await ask(t('Discard unsaved bookmark changes?'), t('Your changes to this bookmark have not been saved.'), t('Discard changes'), t('Keep editing'))) return;
      $('marker-dialog').close();
    } finally { markerClosing = false; }
  }
  $('marker-cancel').addEventListener('click', requestMarkerClose);
  $('marker-dialog').addEventListener('cancel', event => {
    if (event.defaultPrevented) return; // Escape closes an open picker first.
    event.preventDefault(); requestMarkerClose();
  });
  $('marker-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!canEdit()) return;
    const title = $('marker-title').value.trim();
    if (!title) { $('marker-title').setCustomValidity(t("Give this marker a name.")); $('marker-title').reportValidity(); return; }
    const marker = { hex: editingHex.key, title: title.slice(0, 120), note: $('marker-note').value.slice(0, 10000),
      color: $('marker-color').value, kind: $('marker-kind').value };
    mutate(() => { session.markers = session.markers.filter(m => m.hex !== marker.hex); session.markers.push(marker); });
    $('marker-dialog').close(); toast(t("Marker saved to your expedition journal."));
  });
  $('marker-title').addEventListener('input', () => $('marker-title').setCustomValidity(''));
  $('marker-delete').addEventListener('click', () => {
    if (!canEdit()) return;
    mutate(() => { session.markers = session.markers.filter(m => m.hex !== editingHex.key); });
    $('marker-dialog').close(); toast(t("Marker removed. Undo restores it."));
  });

  $('reveal-all').addEventListener('click', async () => {
    if (!canEdit()) return;
    if (await ask(t("Reveal all of {map}?", { map: config.name }), t("Show all hidden map content. Your markers and game log will stay in place."), t("Reveal all tiles"))) {
      mutate(() => { session.revealed = [...fog]; }); toast(t("All hidden tiles revealed. Undo restores the previous view."));
    }
  });
  $('restore-fog').addEventListener('click', async () => {
    if (!canEdit()) return;
    if (await ask(t("Restore the original fog?"), t("Return the map to its starting fog. All marker notes will be kept. You can undo this change."), t("Restore fog"))) {
      mutate(() => { session.revealed = []; }); toast(t("Original fog restored. Your markers are still here."));
    }
  });

  function sessionFile() {
    stopGesture();
    saveNow();
    const name = session.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'seerjourney-expedition';
    return new File([JSON.stringify(session, null, 2) + '\n'], `${name}-${new Date().toISOString().slice(0, 10)}.seerjourney.json`, { type: 'application/json' });
  }

  function exportSession() {
    closeOptions();
    const file = sessionFile();
    const url = URL.createObjectURL(file), link = document.createElement('a');
    link.href = url; link.download = file.name;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
    toast(t("Session file saved with your explored tiles and notes."));
  }
  $('export-session').addEventListener('click', exportSession);
  $('import-session').addEventListener('click', () => { if (!canEdit()) return; closeOptions(); $('session-file').click(); });
  $('session-file').addEventListener('change', async event => {
    if (!canEdit()) { event.target.value = ''; return; }
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(t("This file is too large to be a SeerJourney session."));
      let data;
      try { data = JSON.parse(await file.text()); } catch (_) { throw new Error(t("This file does not contain valid JSON. Choose an exported .seerjourney.json session.")); }
      const next = C.validateSession(data, config);
      if (!await ask(t("Load this expedition?"), t("“{name}” has {revealed} revealed tiles, {markers} markers, and {days} trip days. It will replace the shared campaign for everyone. Download a backup first if you want to keep it.", { name: next.name, revealed: I.number(next.revealed.length), markers: I.number(next.markers.length), days: I.number(next.tripDays.length) }), t("Load session"))) return;
      applySession(next); toast(t("Session loaded. Your expedition continues."));
    } catch (error) { toast(I.text(error.message)); }
  });
  $('new-session').addEventListener('click', async () => {
    if (!canEdit()) return;
    if (await ask(t("Start a new expedition?"), t("This replaces the shared campaign for everyone with the original map and an empty journal. Download a backup first if you want to keep it."), t("Start new session"))) {
      applySession(C.freshSession(config)); toast(t("A new expedition is ready."));
    }
  });

  function applySession(next) {
    if (!canEdit()) return;
    stopGesture(true);
    session = next; undoStack = []; redoStack = []; selected = null; hover = null;
    session.adventureNotes ||= [];
    for (const entry of session.tripDays) entry.supplies ||= window.MapJourneySuppliesCore.empty();
    participantPaths.clear();
    gameLog.reset();
    adventureNotes.reset();
    suppliesPage.reset();
    brushMode = 'reveal'; setTool('explore');
    $('session-name').value = session.name; $('search-markers').value = '';
    setJournal(false);
    if (session.view) restoreView(session.view); else exploreMap(false);
    refresh(); saveNow();
  }

  function goToHex() {
    const match = $('hex-coordinate').value.trim().match(/^(?:C\s*)?([+-]?\d+)\s*[,\s·:\/-]+\s*(?:R\s*)?([+-]?\d+)$/i);
    const hex = match && C.parseKey(`${Number(match[1]) - 1},${Number(match[2]) - 1}`, grid);
    if (!hex) { toast(t("Enter a map tile such as {example}.", { example: $('hex-coordinate').placeholder })); $('hex-coordinate').focus(); return; }
    setJournal(false);
    $('hex-coordinate').blur();
    focusHex(hex); viewport.focus({ preventScroll: true });
    toast(touchInput.matches ? t("{hex} selected. Tap the highlighted tile to use the selected tool.", { hex: C.label(hex) }) : t("{hex} selected. Press Enter to use the selected tool.", { hex: C.label(hex) }));
  }
  $('go-to-hex').addEventListener('click', goToHex);
  $('hex-coordinate').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); goToHex(); } });
  $('help-button').addEventListener('click', () => openDialog('help-dialog'));
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('close-help-mobile').addEventListener('click', () => $('help-dialog').close());
  $('open-options')?.addEventListener('click', () => openDialog('options-dialog'));
  $('close-options')?.addEventListener('click', () => $('options-dialog').close());
  $('install-help')?.addEventListener('click', () => openDialog('install-dialog'));
  $('close-install')?.addEventListener('click', () => $('install-dialog').close());
  function toggleJournal(focusSearch = false) {
    const opening = document.body.classList.contains('journal-collapsed');
    setJournal(opening);
    if (opening && focusSearch) $('search-markers').focus({ preventScroll: true });
  }
  $('toggle-journal')?.addEventListener('click', event => toggleJournal(event.detail === 0));
  $('toggle-journal')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleJournal(true);
  });
  $('close-journal')?.addEventListener('click', () => setJournal(false, true));
  const handle = $('journal-handle');
  if (handle) {
    let startY = null, distance = 0, wasDragged = false;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      startY = event.clientY; distance = 0; wasDragged = false;
      handle.setPointerCapture(event.pointerId);
      $('journal').classList.add('sheet-dragging');
    });
    handle.addEventListener('pointermove', event => {
      if (startY === null) return;
      distance = Math.max(0, event.clientY - startY);
      wasDragged = wasDragged || distance > 5;
      $('journal').style.setProperty('--sheet-offset', `${distance}px`);
    });
    const endSheetDrag = event => {
      if (startY === null) return;
      if (event.type !== 'pointercancel' && distance > 65) setJournal(false, true);
      startY = null; distance = 0;
      $('journal').classList.remove('sheet-dragging');
      $('journal').style.removeProperty('--sheet-offset');
    };
    handle.addEventListener('pointerup', endSheetDrag);
    handle.addEventListener('pointercancel', endSheetDrag);
    handle.addEventListener('click', () => { if (!wasDragged) setJournal(false, true); wasDragged = false; });
  }
  document.addEventListener('keydown', event => {
    if (!loaded) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 's') { event.preventDefault(); exportSession(); return; }
    if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); restoreHistory(event.shiftKey); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === 'escape') { stopGesture(true); setJournal(false, true); }
    else if (key === 'e') setTool('explore'); else if (key === 'b') setTool('brush');
    else if (key === 'l') setTool('log'); else if (key === 'g') gameLog.open(); else if (key === 'j') toggleJourney();
    else if (key === 'r') setBrushMode('reveal'); else if (key === 'm') setTool('marker'); else if (key === 'h') setBrushMode('hide');
    else if (key === 'f') fitMap(); else if (key === '+' || key === '=') zoom(1.4); else if (key === '-') zoom(1 / 1.4);
    else if (key === ' ' && event.target === viewport) { event.preventDefault(); spaceHeld = true; viewport.classList.add('panning'); }
    else if (key === 'enter' && event.target === viewport && selected) { event.preventDefault(); activateHex(selected); }
    else if (key.startsWith('arrow') && event.target === viewport) {
      event.preventDefault();
      stopGesture();
      cameraMode = 'custom';
      if (key === 'arrowleft') view.x += 70; if (key === 'arrowright') view.x -= 70;
      if (key === 'arrowup') view.y += 70; if (key === 'arrowdown') view.y -= 70;
      requestPaint(); scheduleSave();
    }
  });
  document.addEventListener('keyup', event => { if (event.key === ' ') { spaceHeld = false; viewport.classList.remove('panning'); } });
  window.addEventListener('blur', () => { stopGesture(); spaceHeld = false; viewport.classList.remove('panning'); });
  window.addEventListener('pagehide', () => { stopGesture(); saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopGesture(); saveNow(); } });
  function updateCampaignAccess(state) {
    const nextAccessState = JSON.stringify([state.editable, state.authenticated, state.mode, state.message || '', state.pending, state.conflict, hasLocalDraft()]);
    if (accessState === nextAccessState) return;
    accessState = nextAccessState;
    const editable = state.editable;
    document.body.classList.toggle('campaign-guest', !editable);
    if (!editable && tool !== 'explore') { stopGesture(true); setTool('explore'); }
    for (const element of document.querySelectorAll('[data-editor-only]')) if ('disabled' in element) element.disabled = !editable;
    for (const id of ['session-name', 'marker-title', 'marker-note', 'trip-day', 'trip-note', 'log-day', 'log-note']) $(id).readOnly = !editable;
    for (const id of ['marker-kind', 'marker-color']) $(id).disabled = !editable;
    markerPickers.forEach(picker => picker.refresh());
    $('campaign-login-form').hidden = state.authenticated;
    $('campaign-logout').hidden = !state.authenticated;
    $('campaign-access-heading').textContent = state.authenticated ? t('Editing the campaign') : t('Follow the campaign');
    $('campaign-access-copy').textContent = state.authenticated ? t('Your saved changes are shared with everyone. Sign out to return to viewing.') : t('Everyone can view the map and game log. Enter a passphrase to edit the shared campaign.');
    const label = state.mode === 'saving' ? t('Saving shared changes…') : state.mode === 'offline' ? t('Connection lost') : state.mode === 'conflict' ? t('Changes need review') : state.mode === 'expired' ? t('Sign in to save changes') : editable ? t('Editing · Saved') : t('Viewing · Live');
    $('campaign-status-label').textContent = label;
    $('campaign-status').dataset.state = state.mode;
    $('save-status').textContent = label;
    $('save-status').dataset.state = ['offline', 'conflict', 'expired'].includes(state.mode) ? 'warning' : 'saved';
    const attention = ['offline', 'conflict', 'expired'].includes(state.mode);
    $('campaign-alert').hidden = !attention;
    $('campaign-alert-message').textContent = state.mode === 'conflict' ? (state.message ? I.text(state.message) + ' ' + t('Download your local changes before loading the latest campaign.') : t('The shared campaign changed while you were editing. Download your local changes before loading the latest campaign.')) : state.mode === 'expired' ? t('Your editor session ended. Your local changes are still here. Sign in again or download them before leaving.') : t('Showing the latest campaign loaded on this device. Editing is paused until the connection returns.');
    $('campaign-download-draft').hidden = !state.pending && !hasLocalDraft() && !state.conflict;
    $('campaign-load-latest').hidden = !state.conflict;
    $('campaign-retry').hidden = state.mode !== 'offline';
    for (const notice of document.querySelectorAll('[data-dialog-sync-notice]')) {
      notice.hidden = !attention;
      notice.querySelector('p').textContent = $('campaign-alert-message').textContent;
      notice.querySelector('[data-campaign-download]').hidden = $('campaign-download-draft').hidden;
      notice.querySelector('[data-campaign-latest]').hidden = !state.conflict;
      notice.querySelector('[data-campaign-retry]').hidden = state.mode !== 'offline';
      notice.querySelector('[data-campaign-signin]').hidden = state.mode !== 'expired';
    }

    $('log-empty-copy').textContent = editable ? t('Add a day here, or choose Log on the map to begin at a tile.') : t('The first day has not been recorded yet. New entries appear here as the campaign progresses.');
    if (session) { refreshFog(); renderJournal(); gameLog?.updateAccess(); adventureNotes?.updateAccess(); suppliesPage?.updateAccess(); }
  }

  function applyRemoteSession(next) {
    const parsed = C.validateSession(next, config);
    parsed.view = session?.view || null; parsed.showJourney = session?.showJourney ?? true;
    stopGesture(true); session = parsed; undoStack = []; redoStack = [];
    $('session-name').value = session.name;
    refresh();
    if ($('marker-dialog').open && editingHex) {
      if (markerByHex.has(editingHex.key)) openMarker(editingHex);
      else $('marker-dialog').close();
    }
  }

  adventureNotes = window.MapJourneyAdventureNotes.create({ core: C, getSession: () => session, canEdit, mutate, ask, toast, openDialog });
  suppliesPage = window.MapJourneySuppliesPage.create({ core: C, getSession: () => session, canEdit, mutate, ask, toast, openDialog, openDay: id => gameLog.openDay(id) });

  $('campaign-status').addEventListener('click', () => openDialog('options-dialog'));
  $('campaign-login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('campaign-passphrase'), button = $('campaign-login');
    if (!input.reportValidity() || button.disabled) return;
    const passphrase = input.value; input.value = '';
    button.disabled = true; button.textContent = t('Signing in…'); $('campaign-auth-error').hidden = true;
    try { await sync.login(passphrase); toast(t('Signed in. You can now edit the shared campaign.')); }
    catch (error) { $('campaign-auth-error').textContent = I.text(error.message); $('campaign-auth-error').hidden = false; }
    finally { button.disabled = false; button.textContent = t('Sign in'); }
  });
  $('campaign-logout').addEventListener('click', async () => {
    $('campaign-auth-error').hidden = true;
    try { await sync.logout(); }
    catch (error) { $('campaign-auth-error').textContent = I.text(error.message); $('campaign-auth-error').hidden = false; }
  });
  $('campaign-retry').addEventListener('click', () => sync.refresh());
  $('campaign-load-latest').addEventListener('click', async () => {
    if (!await ask(t('Load the latest shared campaign?'), t('This discards local changes in this tab. Download them first if you want to keep them.'), t('Load latest campaign'))) return;
    try {
      if (await sync.loadLatest()) {
        for (const id of ['marker-dialog', 'trip-dialog', 'log-dialog', 'notes-dialog', 'supplies-dialog']) if ($(id).open) $(id).close();
        gameLog.reset();
        adventureNotes.reset();
        suppliesPage.reset();
      }
    } catch (_) { toast(t('The campaign could not be reached. Check your connection and try again.')); }
  });
  $('campaign-download-draft').addEventListener('click', () => {
    const recovery = JSON.parse(JSON.stringify(session));
    recovery.unsavedDrafts = {};
    if ($('marker-dialog').open) recovery.unsavedDrafts.marker = { hex: editingHex?.key, ...JSON.parse(markerValues()) };
    if (gameLog.hasDraft()) recovery.unsavedDrafts.gameLog = gameLog.getDrafts();
    if (adventureNotes.hasDraft()) recovery.unsavedDrafts.adventureNotes = adventureNotes.getDrafts();
    if (suppliesPage.hasDraft()) recovery.unsavedDrafts.supplies = suppliesPage.getDrafts();
    const url = URL.createObjectURL(new Blob([JSON.stringify(recovery, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'seerjourney-local-changes.seerjourney.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
  });

  for (const button of document.querySelectorAll('[data-campaign-download]')) button.addEventListener('click', () => $('campaign-download-draft').click());
  for (const button of document.querySelectorAll('[data-campaign-latest]')) button.addEventListener('click', () => $('campaign-load-latest').click());
  for (const button of document.querySelectorAll('[data-campaign-retry]')) button.addEventListener('click', () => sync.refresh());
  for (const button of document.querySelectorAll('[data-campaign-signin]')) button.addEventListener('click', () => openDialog('options-dialog'));

  window.addEventListener('online', () => sync.refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.refresh(); });
  window.addEventListener('beforeunload', event => { if (sync.hasPending() || hasLocalDraft()) { event.preventDefault(); event.returnValue = ''; } });


  journeyView = window.MapJourneyJourneyView.create({ core: C, config, layer: journeyLayer,
    onOpenDay: id => { const entry = session.tripDays.find(day => day.id === id); if (entry) gameLog.openTrip(C.parseKey(entry.hex, grid), id); } });
  gameLog = window.MapJourneyGameLog.create({ core: C, grid, getSession: () => session, canEdit, mutate, ask, toast, openDialog,
    createSnapshot: entry => journeyView.snapshot(entry, session),
    placeOnMap: () => { setTool('log'); viewport.focus({ preventScroll: true }); } });
  setJournal(false);
  updateVisualViewport();
  window.visualViewport?.addEventListener('resize', updateVisualViewport);
  window.visualViewport?.addEventListener('scroll', updateVisualViewport);
  document.addEventListener('focusin', updateVisualViewport);
  document.addEventListener('focusout', () => requestAnimationFrame(updateVisualViewport));
  const standalone = window.matchMedia('(display-mode: standalone)');
  const updateDisplayMode = () => document.body.classList.toggle('standalone', standalone.matches || Boolean(navigator.standalone));
  updateDisplayMode(); standalone.addEventListener('change', updateDisplayMode);
  refreshTitle();
  $('map-attribution').textContent = t("{map} · {grid} grid · {distance} {unit} per tile", { map: config.name, grid: config.grid.type === 'square' ? t("Square") : t("Hex"), distance: I.number(config.scale.distance, { maximumSignificantDigits: 15 }), unit: config.scale.unit });
  $('hex-coordinate').placeholder = C.label({ column: grid.minColumn, row: grid.minRow }).replace(' · ', ' ');
  window.MapJourneyApp = { save() { stopGesture(); return saveNow() && !hasLocalDraft(); } };
  try { session = C.validateSession(await sync.start(), config); }
  catch (_) {
    $('map-loading').hidden = true; viewport.removeAttribute('aria-busy'); $('map-error').hidden = false;
    $('map-error').replaceChildren(document.createTextNode(t('The campaign could not be reached. Check your connection and try again.')));
    const retry = document.createElement('button'); retry.className = 'button primary'; retry.textContent = t('Retry connection');
    retry.addEventListener('click', () => location.reload()); $('map-error').append(document.createElement('br'), retry);
    return;
  }
  const preferences = localView();
  if (typeof preferences.showJourney === 'boolean') session.showJourney = preferences.showJourney;
  if (preferences.view) {
    try { session.view = C.validateSession({ ...session, view: preferences.view }, config).view; } catch (_) { /* Ignore malformed local preferences. */ }
  }
  sync.subscribe(event => {
    if (event.type === 'session') applyRemoteSession(event.session);
    else if (event.type === 'status') updateCampaignAccess(event);
  });
  $('session-name').value = session.name;
  exploreMap(false);
  if (session.view) restoreView(session.view);
  refresh(); setTool('explore'); paintView();
  updateCampaignAccess(sync.status());
  saveNow();
  new ResizeObserver(() => {
    stopGesture();
    const width = viewport.clientWidth, height = viewport.clientHeight;
    viewportSize = { width, height };
    if (cameraMode === 'fit') fitMap(false);
    else if (cameraMode === 'explore') exploreMap(false);
    else if (lastWidth && lastHeight) { view.x += (width - lastWidth) / 2; view.y += (height - lastHeight) / 2; }
    updateFitScale(); updateVisualViewport();
    lastWidth = width; lastHeight = height; requestPaint();
  }).observe(viewport);

  Promise.all([mapTiles.ready, ...[...(config.tileManifest ? [] : [config.backgroundImage, config.fogImage]), ...config.tags.map(tag => tag.image)].filter(Boolean).map(src => new Promise((resolve, reject) => {
    const img = new Image(); img.onload = resolve; img.onerror = reject; img.src = src;
  }))]).then(() => {
    loaded = true; finishLoading();

  }).catch(() => {
    finishLoading(); $('map-error').hidden = false;
    $('map-error').textContent = t("The map artwork could not load. Check your connection and reload the page.");
  });
})();
