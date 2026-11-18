/* Geometry and session data. Shared by the offline app and its Node tests. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.MapJourneyCore = api; root.ChultCore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const suppliesCore = typeof module === 'object' && module.exports ? require('./supplies-core.js') : root.MapJourneySuppliesCore;
  const FORMAT = 'mapjourney-session';
  const VERSION = 3;
  const LEGACY_MAP_ID = 'toa-chult-player-grid-v1';
  const COLORS = ['gold', 'green', 'red', 'blue', 'purple', 'grey'];
  const KINDS = ['place', 'camp', 'danger', 'ruin', 'tomb', 'treasure'];
  const MAX_TRIP_DAY = Number.MAX_SAFE_INTEGER - 1;
  const key = (column, row) => `${column},${row}`;
  const odd = column => ((column % 2) + 2) % 2;
  const square = grid => grid.type === 'square';
  const pointy = grid => !square(grid) && grid.orientation === 'pointy-top';
  const offset = (index, grid) => (grid.offset?.startsWith('even-') ? 1 - odd(index) : odd(index)) / 2;

  function center(column, row, grid) {
    return { x: grid.originX + (column + (pointy(grid) ? offset(row, grid) : 0)) * grid.columnStep,
      y: grid.originY + (row + (!square(grid) && !pointy(grid) ? offset(column, grid) : 0)) * grid.rowStep };
  }

  function vertices(column, row, grid, padding = 0) {
    const { x, y } = center(column, row, grid);
    const rx = grid.radiusX + padding, ry = grid.radiusY + padding;
    if (square(grid)) return [[x - rx, y - ry], [x + rx, y - ry], [x + rx, y + ry], [x - rx, y + ry]];
    if (pointy(grid)) return [[x, y - ry], [x + rx, y - ry / 2], [x + rx, y + ry / 2],
      [x, y + ry], [x - rx, y + ry / 2], [x - rx, y - ry / 2]];
    return [[x + rx, y], [x + rx / 2, y + ry], [x - rx / 2, y + ry],
      [x - rx, y], [x - rx / 2, y - ry], [x + rx / 2, y - ry]];
  }

  function points(column, row, grid, padding = 0) {
    return vertices(column, row, grid, padding).map(p => p.map(n => n.toFixed(3)).join(',')).join(' ');
  }

  function validCell(column, row, grid) {
    if (!Number.isInteger(column) || !Number.isInteger(row) ||
      column < grid.minColumn || column > grid.maxColumn ||
      row < grid.minRow || row > grid.maxRow) return false;
    const p = center(column, row, grid), b = grid.bounds;
    return p.x + grid.radiusX > b.x && p.x - grid.radiusX < b.x + b.width &&
      p.y + grid.radiusY > b.y && p.y - grid.radiusY < b.y + b.height;
  }

  function parseKey(value, grid) {
    if (typeof value !== 'string' || !/^-?\d+,-?\d+$/.test(value)) return null;
    const [column, row] = value.split(',').map(Number);
    return validCell(column, row, grid) ? { column, row, key: key(column, row) } : null;
  }

  function cellAt(x, y, grid) {
    const b = grid.bounds;
    if (!Number.isFinite(x + y) || x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) return null;
    const approximateColumn = Math.round((x - grid.originX) / grid.columnStep);
    for (let column = approximateColumn - 1; column <= approximateColumn + 1; column++) {
      const approximateRow = Math.round((y - grid.originY) / grid.rowStep - (!square(grid) && !pointy(grid) ? offset(column, grid) : 0));
      for (let row = approximateRow - 1; row <= approximateRow + 1; row++) {
        if (!validCell(column, row, grid)) continue;
        const p = center(column, row, grid);
        const dx = Math.abs(x - p.x) / grid.radiusX, dy = Math.abs(y - p.y) / grid.radiusY;
        if (dx <= 1.000001 && dy <= 1.000001 &&
          (square(grid) || (pointy(grid) ? dx / 2 + dy : dx + dy / 2) <= 1.000001)) return { column, row, key: key(column, row) };
      }
    }
    return null;
  }

  // Clip a segment's parameter interval against convex half-planes n·p <= limit.
  function segmentInterval(x, y, dx, dy, planes) {
    let enter = 0, exit = 1;
    for (const [nx, ny, limit] of planes) {
      const slope = nx * dx + ny * dy, room = limit - nx * x - ny * y;
      if (slope === 0) { if (room < 0) return null; continue; }
      const crossing = room / slope;
      if (slope > 0) exit = Math.min(exit, crossing);
      else enter = Math.max(enter, crossing);
      if (enter > exit) return null;
    }
    return { enter, exit };
  }

  // Ordered, unique cells touched by a map-space stroke, including shared edges.
  // A stationary stroke keeps the same single-cell choice as cellAt.
  function cellsAlongSegment(from, to, grid) {
    if (!from || !to || !grid?.bounds ||
      ![from.x, from.y, to.x, to.y, grid.originX, grid.originY,
        grid.minColumn, grid.maxColumn, grid.minRow, grid.maxRow].every(Number.isFinite) ||
      ![grid.minColumn, grid.maxColumn, grid.minRow, grid.maxRow].every(Number.isInteger) ||
      ![grid.radiusX, grid.radiusY, grid.columnStep, grid.rowStep].every(n => Number.isFinite(n) && n > 0)) return [];
    const b = grid.bounds;
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) return [];
    const dx = to.x - from.x, dy = to.y - from.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return [];
    const frame = segmentInterval(from.x, from.y, dx, dy,
      [[-1, 0, -b.x], [1, 0, b.x + b.width], [0, -1, -b.y], [0, 1, b.y + b.height]]);
    if (!frame) return [];
    const a = { x: from.x + dx * frame.enter, y: from.y + dy * frame.enter };
    const z = { x: from.x + dx * frame.exit, y: from.y + dy * frame.exit };
    if (a.x === z.x && a.y === z.y) {
      const hex = cellAt(a.x, a.y, grid);
      return hex ? [hex] : [];
    }

    // Match cellAt's tolerance at calibrated borders. Exact intersections catch
    // arbitrarily short corner crossings that fixed-distance sampling can miss.
    const edge = 1.000001;
    const planes = square(grid) ? [[0, 1, edge], [0, -1, edge], [1, 0, edge], [-1, 0, edge]]
      : pointy(grid) ? [[1, 0, edge], [-1, 0, edge], [.5, 1, edge], [-.5, 1, edge], [.5, -1, edge], [-.5, -1, edge]]
        : [[0, 1, edge], [0, -1, edge], [1, .5, edge], [1, -.5, edge], [-1, .5, edge], [-1, -.5, edge]];
    const columnShift = pointy(grid) ? grid.columnStep / 2 : 0;
    const minColumn = Math.max(grid.minColumn, Math.ceil((Math.min(a.x, z.x) - grid.radiusX * edge - grid.originX - columnShift) / grid.columnStep));
    const maxColumn = Math.min(grid.maxColumn, Math.floor((Math.max(a.x, z.x) + grid.radiusX * edge - grid.originX) / grid.columnStep));
    const hits = [];
    for (let column = minColumn; column <= maxColumn; column++) {
      const rowOrigin = grid.originY + (!square(grid) && !pointy(grid) ? offset(column, grid) * grid.rowStep : 0);
      const minRow = Math.max(grid.minRow, Math.ceil((Math.min(a.y, z.y) - grid.radiusY * edge - rowOrigin) / grid.rowStep));
      const maxRow = Math.min(grid.maxRow, Math.floor((Math.max(a.y, z.y) + grid.radiusY * edge - rowOrigin) / grid.rowStep));
      for (let row = minRow; row <= maxRow; row++) {
        if (!validCell(column, row, grid)) continue;
        const p = center(column, row, grid);
        const hit = segmentInterval((a.x - p.x) / grid.radiusX, (a.y - p.y) / grid.radiusY,
          (z.x - a.x) / grid.radiusX, (z.y - a.y) / grid.radiusY, planes);
        if (hit) hits.push({ column, row, key: key(column, row), position: (hit.enter + hit.exit) / 2 });
      }
    }
    const direction = (z.x - a.x || z.y - a.y) > 0 ? 1 : -1;
    hits.sort((a, b) => a.position - b.position || direction * (a.column - b.column || a.row - b.row));
    return hits.map(({ column, row, key }) => ({ column, row, key }));
  }

  function label(hex) {
    return `C${String(hex.column + 1).padStart(2, '0')} · R${String(hex.row + 1).padStart(2, '0')}`;
  }

  function parseTripDay(value) {
    if (typeof value === 'string') {
      value = value.trim();
      if (!/^\d+$/.test(value)) return null;
      value = Number(value);
    }
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TRIP_DAY ? (value === 0 ? 0 : value) : null;
  }

  const sortTripDays = logs => [...logs].sort((a, b) => a.day - b.day);
  const nextTripDay = logs => logs.reduce((latest, log) => Math.max(latest, log.day), -1) + 1;

  const participantDisplayName = name => name.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const participantKey = name => typeof name === 'string' ? participantDisplayName(name).toLowerCase().normalize('NFC') : '';
  // A shared order for Chinese names (pinyin), Latin names and numbered photos.
  const nameCollator = new Intl.Collator('zh-CN', { sensitivity: 'base', numeric: true });
  const compareNames = (a, b) => nameCollator.compare(a.trim(), b.trim());

  function normalizeParticipants(names) {
    if (!Array.isArray(names) || names.length > 32) throw new Error('A game day can have up to 32 participants.');
    const seen = new Set(), participants = [];
    for (const name of names) {
      if (typeof name !== 'string' || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error('Participant names must be text without control characters.');
      const displayName = participantDisplayName(name);
      if (!displayName || displayName.length > 80) throw new Error('Participant names must contain 1 to 80 characters.');
      const key = participantKey(displayName);
      if (!seen.has(key)) { seen.add(key); participants.push(displayName); }
    }
    return participants;
  }

  function participantNames(logs) {
    const names = new Map();
    for (const log of logs) {
      for (const name of normalizeParticipants(log.participants ?? [])) {
        const key = participantKey(name);
        if (!names.has(key)) names.set(key, name);
      }
    }
    return [...names.values()].sort(compareNames);
  }

  function journey(logs, grid, participant = null) {
    const selected = participant === null ? null : participantKey(participant);
    const stops = [], segments = [], visited = new Set();
    let previousStop = null;
    for (const log of sortTripDays(logs)) {
      if (selected !== null && !log.participants?.some(name => participantKey(name) === selected)) {
        // A recorded absence breaks this character's route, including days
        // without a map location. Unrecorded calendar days keep their gaps.
        previousStop = null;
        continue;
      }
      const hex = parseKey(log.hex, grid);
      if (!hex) continue;
      const stop = { ...log, hex: hex.key, ...center(hex.column, hex.row, grid) };
      stops.push(stop);
      if (previousStop) {
        const from = previousStop, hexes = cellsAlongSegment(from, stop, grid);
        segments.push({ from, to: stop, hexes });
        for (const hex of hexes) visited.add(hex.key);
      }
      // Partial boundary hexes remain stops even when their centers lie outside
      // the frame used to clip the connecting route.
      visited.add(stop.hex);
      previousStop = stop;
    }
    return { stops, segments, visited: [...visited] };
  }

  const mapId = config => config?.id || 'mapjourney-map';

  function freshSession(config) {
    const now = new Date().toISOString();
    const name = config?.name ? (root.MapJourneyI18n?.t('{map} expedition', { map: config.name }) || `${config.name} expedition`) : (root.MapJourneyI18n?.t('New expedition') || 'New expedition');
    return { format: FORMAT, version: VERSION, mapId: mapId(config),
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: name.slice(0, 100), createdAt: now, updatedAt: now, revealed: [], markers: [], tripDays: [], adventureNotes: [], showJourney: true, view: null };
  }

  function validNoteTimestamp(value) {
    if (typeof value !== 'string') return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
    if (!parts || !Number.isFinite(Date.parse(value))) return false;
    const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1];
  }

  function validateSession(data, config) {
    const fail = message => { throw new Error(message); };
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('This file is not a SeerJourney session.');
    const legacy = data.format === 'chult-expedition' && [1, 2].includes(data.version) && data.mapId === LEGACY_MAP_ID;
    if (legacy) {
      if (mapId(config) !== LEGACY_MAP_ID && !config?.legacyIds?.includes(LEGACY_MAP_ID)) fail('This legacy expedition belongs to the Chult map. Import its map mod first.');
    } else {
      if (data.format !== FORMAT || data.version !== VERSION) fail('Choose a supported SeerJourney session exported by this app.');
      if (data.mapId !== mapId(config)) fail('This expedition belongs to a different map. Import or select its map mod first.');
    }
    if (typeof data.name !== 'string' || data.name.length > 100 || !data.name.trim()) fail('The session name is missing or too long.');
    if (!Array.isArray(data.revealed) || !Array.isArray(data.markers)) fail('The session is missing its revealed cells or markers.');
    const fog = new Set(config.fogHexes);
    if (data.revealed.length > fog.size || data.markers.length > 15000) fail('The session contains too many map entries.');
    const revealed = new Set();
    for (const entry of data.revealed) {
      const hex = parseKey(entry, config.grid);
      if (!hex || !fog.has(hex.key)) fail('The session contains an unknown reveal cell.');
      revealed.add(hex.key);
    }
    const seen = new Set();
    const markers = data.markers.map(marker => {
      if (!marker || typeof marker !== 'object') fail('A marker is not valid.');
      const hex = parseKey(marker.hex, config.grid);
      if (!hex || seen.has(hex.key)) fail('A marker has an invalid or duplicate cell.');
      seen.add(hex.key);
      if (typeof marker.title !== 'string' || !marker.title.trim() || marker.title.length > 120 ||
          typeof marker.note !== 'string' || marker.note.length > 10000) fail('A marker title or note is missing or too long.');
      if (!COLORS.includes(marker.color) || !KINDS.includes(marker.kind)) fail('A marker has an unknown color or type.');
      return { hex: hex.key, title: marker.title.trim(), note: marker.note, color: marker.color, kind: marker.kind };
    });
    let tripDays = [], showJourney = true;
    if (!legacy || data.version === 2) {
      if (!Array.isArray(data.tripDays) || typeof data.showJourney !== 'boolean') fail('The session is missing its trip log or journey visibility.');
      if (data.tripDays.length > 10000) fail('The session contains too many trip days.');
      const ids = new Set(), days = new Set(), foodIds = new Set();
      tripDays = data.tripDays.map(log => {
        if (!log || typeof log !== 'object' || Array.isArray(log)) fail('A trip day is not valid.');
        if (typeof log.id !== 'string' || !log.id.trim() || log.id.length > 200 || ids.has(log.id)) fail('A trip day has an invalid or duplicate ID.');
        if (typeof log.day !== 'number' || parseTripDay(log.day) === null || days.has(log.day)) fail('A trip day has an invalid or duplicate day number.');
        if (typeof log.note !== 'string' || log.note.length > 20000) fail('A trip day note is missing or too long.');
        const hex = log.hex === null ? null : parseKey(log.hex, config.grid);
        if (log.hex !== null && !hex) fail('A trip day has an invalid map cell.');
        ids.add(log.id); days.add(log.day);
        let attachments;
        if (log.attachments !== undefined) {
          if (!Array.isArray(log.attachments) || log.attachments.length > 12) fail('A game day can have up to 12 images.');
          const images = new Set();
          attachments = log.attachments.map(image => {
            if (!image || typeof image !== 'object' || Array.isArray(image)) fail('A game-log image is not valid.');
            const match = typeof image.pathname === 'string' && /^campaigns\/[a-zA-Z0-9_-]{1,80}\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp|gif)$/.exec(image.pathname);
            if (!match || image.id !== match[1] || images.has(image.id)) fail('A game-log image has an invalid or duplicate ID.');
            const types = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
            if (image.type !== types[match[2]] || !Number.isSafeInteger(image.size) || image.size < 1 || image.size > 8 * 1024 * 1024) fail('Game-log images must be JPEG, PNG, WebP, or GIF files no larger than 8 MB.');
            if (typeof image.name !== 'string' || !image.name.trim() || image.name.length > 200) fail('A game-log image needs a filename within 200 characters.');
            if (![image.width, image.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 32768) || image.width * image.height > 100000000) fail('A game-log image has invalid dimensions.');
            let validURL = image.url === `/api/images?pathname=${encodeURIComponent(image.pathname)}`;
            try {
              const url = new URL(image.url);
              validURL ||= url.protocol === 'https:' && /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname) && !url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === `/${image.pathname}`;
            } catch (_) { /* Only the exact local image route is allowed without an origin. */ }
            if (!validURL) fail('A game-log image has an invalid storage address.');
            images.add(image.id);
            return { id: image.id, url: image.url, pathname: image.pathname, name: image.name.trim(), type: image.type, size: image.size, width: image.width, height: image.height };
          });
        }
        const participants = log.participants === undefined ? undefined : normalizeParticipants(log.participants);
        const supplies = log.supplies === undefined ? undefined : suppliesCore.validate(log.supplies);
        for (const food of supplies?.foods || []) {
          if (foodIds.has(food.id)) fail('A food entry has an invalid or duplicate ID.');
          foodIds.add(food.id);
        }
        return { id: log.id, day: parseTripDay(log.day), note: log.note, hex: hex?.key || null,
          ...(attachments === undefined ? {} : { attachments }), ...(participants === undefined ? {} : { participants }), ...(supplies === undefined ? {} : { supplies }) };
      });
      if (tripDays.some(day => day.supplies !== undefined)) {
        suppliesCore.assertLedger(tripDays);
      }
      showJourney = data.showJourney;
    }
    let adventureNotes;
    if (data.adventureNotes !== undefined) {
      if (!Array.isArray(data.adventureNotes) || data.adventureNotes.length > 200) fail('An expedition can have up to 200 adventure notes.');
      const noteIds = new Set();
      adventureNotes = data.adventureNotes.map(note => {
        if (!note || typeof note !== 'object' || Array.isArray(note)) fail('An adventure note is not valid.');
        if (typeof note.id !== 'string' || !note.id.trim() || note.id.length > 128 || noteIds.has(note.id)) fail('An adventure note has an invalid or duplicate ID.');
        if (typeof note.title !== 'string' || !note.title.trim() || note.title.trim().length > 160) fail('An adventure note title must contain 1 to 160 characters.');
        if (typeof note.body !== 'string' || note.body.length > 50000) fail('An adventure note body must be text within 50,000 characters.');
        if (!validNoteTimestamp(note.createdAt) || !validNoteTimestamp(note.updatedAt)) fail('An adventure note has an invalid creation or update timestamp.');
        noteIds.add(note.id);
        return { id: note.id, title: note.title.trim(), body: note.body, createdAt: note.createdAt, updatedAt: note.updatedAt };
      });
    }
    const now = new Date().toISOString();
    let view = null;
    if (data.view && ['x', 'y', 'scale'].every(k => Number.isFinite(data.view[k])) && data.view.scale > 0 && data.view.scale <= 100000) {
      view = { x: data.view.x, y: data.view.y, scale: data.view.scale };
      // Optional viewport dimensions let a different screen restore the same
      // map center. Legacy saves and invalid dimensions retain their camera.
      if (['width', 'height'].every(k => Number.isFinite(data.view[k]) && data.view[k] > 0 && data.view[k] <= 100000)) {
        view.width = data.view.width;
        view.height = data.view.height;
      }
    }
    return { format: FORMAT, version: VERSION, mapId: mapId(config),
      id: typeof data.id === 'string' && data.id.length < 200 ? data.id : freshSession(config).id,
      name: data.name.trim(), createdAt: typeof data.createdAt === 'string' ? data.createdAt.slice(0, 40) : now,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt.slice(0, 40) : now,
      revealed: [...revealed], markers, tripDays, ...(adventureNotes === undefined ? {} : { adventureNotes }), showJourney, view };
  }

  return { FORMAT, VERSION, LEGACY_MAP_ID, COLORS, KINDS, MAX_TRIP_DAY, key, center, vertices, points, validCell, parseKey,
    cellAt, cellsAlongSegment, hexAt: cellAt, hexesAlongSegment: cellsAlongSegment,
    label, parseTripDay, sortTripDays, nextTripDay, compareNames, participantKey, normalizeParticipants, participantNames, journey, freshSession, validateSession };
});
