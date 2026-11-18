'use strict';
const { sourcePath } = require('../helpers/source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { buildSync } = require('esbuild');
const C = require('../../src/shared/core.js');
const S = require('../../src/shared/supplies-core.js');
const Client = require('../../src/client/campaign-client.js');
const manifest = require('../../examples/demo-map/map.json');
const root = path.resolve(__dirname, '../..');
const markdownBundle = buildSync({ entryPoints: [path.join(root, 'src/client/features/adventure-notes/markdown-entry.js')], bundle: true,
  write: false, platform: 'browser', target: ['safari16', 'chrome100'], format: 'iife' }).outputFiles[0].text;
const config = { ...manifest, tags: [], fogHexes: manifest.fog.cells };
const copy = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const note = (id = 'note-1', body = 'Travel supplies and temple clues.') => ({ id, title: '冒险笔记', body,
  createdAt: '2026-11-16T10:00:00.000Z', updatedAt: '2026-11-17T10:00:00.000Z' });

async function harness(t, { editable = true, notes = [note()], omitNotes = false, realNotes = false, name } = {}) {
  const dom = new JSDOM(fs.readFileSync(sourcePath('index.html'), 'utf8'), { url: 'http://localhost:8780/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window: w } = dom, $ = id => { const element = w.document.getElementById(id); assert.ok(element, `Missing real page element ${id}`); return element; };
  const seed = { ...C.freshSession(config), adventureNotes: notes, revealed: [config.fogHexes[0]],
    markers: [{ hex: '30,10', title: 'Old camp', note: 'A place note.', color: 'green', kind: 'camp' }],
    tripDays: [{ id: 'day-0', day: 0, note: 'A daily log.', hex: '30,10', participants: ['游侠'], attachments: [] }] };
  if (omitNotes) delete seed.adventureNotes;
  if (name !== undefined) seed.name = name;
  const initial = C.validateSession(seed, config);
  let stored = { revision: 0, session: copy(initial), updatedAt: initial.updatedAt }, allowed = editable, client, clientOptions;
  let notesOptions, logOptions, suppliesOptions, notesDraft = null, logDraft = null, suppliesDraft = null, notesResets = 0, logResets = 0, suppliesResets = 0;
  const requests = [], downloads = [], blobs = [];
  const fetcher = async (url, init = {}) => {
    const method = init.method || 'GET'; requests.push({ url, method, ...(init.body ? { body: JSON.parse(init.body) } : {}) });
    let status = 200, body;
    if (url === '/api/auth') body = { editable: allowed };
    else if (url === '/api/campaign' && method === 'GET') body = stored;
    else if (url === '/api/campaign' && method === 'PUT') {
      const input = JSON.parse(init.body);
      if (!allowed) { status = 401; body = { error: 'unauthorized', message: 'Sign in to edit this campaign.' }; }
      else if (input.revision !== stored.revision) { status = 409; body = { error: 'conflict', message: 'Another editor saved changes.', campaign: stored }; }
      else {
        // Mirror the server's old-client preservation boundary for new daily fields.
        const previous = new Map(stored.session.tripDays.map(entry => [entry.id, entry]));
        for (const entry of input.session.tripDays) if (!Object.hasOwn(entry, 'supplies') && previous.get(entry.id)?.supplies !== undefined) entry.supplies = copy(previous.get(entry.id).supplies);
        stored = { revision: stored.revision + 1, session: C.validateSession(input.session, config), updatedAt: new Date().toISOString() }; body = stored;
      }
    } else throw new Error(`Unexpected network request: ${method} ${url}`);
    return { ok: status < 400, status, json: async () => copy(body) };
  };
  w.MapJourneyI18n = { t: (value, data = {}) => value.replace(/\{(\w+)\}/g, (match, key) => String(data[key] ?? match)), number: String, text: value => value };
  w.MapJourneyCore = C; w.MapJourneySuppliesCore = S; w.MAPJOURNEY_MAP = config;
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.setTimeout = () => 1; w.clearTimeout = () => {};
  w.requestAnimationFrame = () => 1; w.cancelAnimationFrame = () => {};
  w.ResizeObserver = class { observe() {} };
  w.CampaignClient = { create(options) { clientOptions = options; client = Client.create({ ...options, fetch: fetcher, setTimeout: () => 1, clearTimeout() {} }); return client; } };
  w.CampaignMapTiles = { create: () => ({ ready: Promise.resolve(), paint() {} }) };
  w.MapJourneyLayers = { create: () => ({ element: w.document.createElementNS('http://www.w3.org/2000/svg', 'g'), render() {} }) };
  w.MapJourneyGameLog = { create(options) { logOptions = options; return { hasDraft: () => Boolean(logDraft), getDrafts: () => copy(logDraft),
    refresh() {}, updateAccess() {}, clearPlacement() {}, reset() { logDraft = null; logResets++; } }; } };
  w.MapJourneyAdventureNotes = { create(options) { notesOptions = options; return { hasDraft: () => Boolean(notesDraft), getDrafts: () => copy(notesDraft),
    refresh() {}, updateAccess() {}, reset() { notesDraft = null; notesResets++; } }; } };
  w.MapJourneySuppliesPage = { create(options) { suppliesOptions = options; return { hasDraft: () => Boolean(suppliesDraft), getDrafts: () => copy(suppliesDraft),
    refresh() {}, updateAccess() {}, reset() { suppliesDraft = null; suppliesResets++; } }; } };
  Object.defineProperties($('map-viewport'), { clientWidth: { value: 390 }, clientHeight: { value: 844 } });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.Blob = Blob;
  w.URL.createObjectURL = blob => { blobs.push(blob); return `blob:test-${blobs.length}`; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, href: this.href }); };
  if (realNotes) {
    w.eval(markdownBundle);
    w.eval(fs.readFileSync(sourcePath('adventure-notes.js'), 'utf8'));
    const create = w.MapJourneyAdventureNotes.create;
    w.MapJourneyAdventureNotes.create = options => {
      notesOptions = options;
      const controller = create(options), reset = controller.reset;
      controller.reset = () => { notesResets++; reset(); };
      return controller;
    };
  }
  for (const file of ['dialog-dismiss.js', 'participant-paths.js', 'journey-view.js', 'marker-ui.js']) w.eval(fs.readFileSync(sourcePath(file), 'utf8'));
  await w.eval(fs.readFileSync(sourcePath('app.js'), 'utf8'));
  await settle();
  assert.ok(notesOptions); assert.ok(logOptions); assert.ok(client);
  return { w, $, client, requests, downloads, blobs, initial: copy(initial), current: () => notesOptions.getSession(), stored: () => copy(stored),
    mutateNotes: action => notesOptions.mutate(() => action(notesOptions.getSession())),
    mutateLog: action => logOptions.mutate(() => action(logOptions.getSession())),
    mutateSupplies: action => suppliesOptions.mutate(() => action(suppliesOptions.getSession())),
    hasDraft: () => clientOptions.hasDraft(), setNotesDraft: draft => { notesDraft = draft; }, setLogDraft: draft => { logDraft = draft; },
    setSuppliesDraft: draft => { suppliesDraft = draft; }, suppliesResets: () => suppliesResets,
    notesResets: () => notesResets, logResets: () => logResets,
    setAllowed: value => { allowed = value; },
    remoteNotes(nextNotes) { stored = { ...stored, revision: stored.revision + 1, session: { ...stored.session, adventureNotes: copy(nextNotes) } }; },
    remoteName(nextName) { stored = { ...stored, revision: stored.revision + 1, session: { ...stored.session, name: nextName } }; },
    async confirm() { await settle(); assert.equal($('confirm-dialog').open, true); $('confirm-accept').click(); await settle(); },
    async importSession(value) { const json = JSON.stringify(value); Object.defineProperty($('session-file'), 'files', { configurable: true, value: [{ size: Buffer.byteLength(json), text: async () => json }] }); $('session-file').dispatchEvent(new w.Event('change')); await settle(); }
  };
}

function assertCampaignTitle(h, name) {
  assert.equal(h.$('map-title').textContent, name);
  assert.equal(h.w.document.title, `${name} · SeerJourney`);
  assert.equal(h.$('map-svg').getAttribute('aria-label'), `${name} map`);
}

function tapBackdrop(h, dialog) {
  dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 540, bottom: 700 });
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    const event = new h.w.MouseEvent(type, { bubbles: true, clientX: 20, clientY: 20, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    dialog.dispatchEvent(event);
  }
}

test('bookmark backdrop dismissal protects drafts and cancelling the confirmation keeps editing usable', async t => {
  const h = await harness(t);
  h.w.document.querySelector('.marker-item').click();
  assert.equal(h.$('marker-dialog').open, true);
  h.$('marker-note').value = 'Unsaved tomb discoveries';
  tapBackdrop(h, h.$('marker-dialog')); await settle();
  assert.equal(h.$('confirm-dialog').open, true);
  assert.equal(h.$('marker-dialog').open, true);
  tapBackdrop(h, h.$('confirm-dialog')); await settle();
  assert.equal(h.$('confirm-dialog').open, false);
  assert.equal(h.$('marker-dialog').open, true);
  assert.equal(h.$('marker-note').value, 'Unsaved tomb discoveries');
  assert.equal(h.current().markers[0].note, 'A place note.');
  assert.equal(h.hasDraft(), true);
  // A second request must not hang behind the dismissed confirmation promise.
  tapBackdrop(h, h.$('marker-dialog')); await h.confirm();
  assert.equal(h.$('marker-dialog').open, false);
  assert.equal(h.current().markers[0].note, 'A place note.');
  assert.equal(h.hasDraft(), false);
});

test('bookmark Escape first closes its picker; clean guest notes close without confirmation', async t => {
  const h = await harness(t);
  h.w.document.querySelector('.marker-item').click();
  h.$('marker-title').value = 'Unsaved marker name';
  h.$('marker-color-picker').click();
  h.$('marker-dialog').dispatchEvent(new h.w.Event('cancel', { cancelable: true })); await settle();
  assert.equal(h.$('marker-color-picker').getAttribute('aria-expanded'), 'false');
  assert.equal(h.$('marker-dialog').open, true);
  assert.equal(h.$('confirm-dialog').open, false);
  h.$('marker-dialog').dispatchEvent(new h.w.Event('cancel', { cancelable: true })); await settle();
  assert.equal(h.$('confirm-dialog').open, true);
  h.$('confirm-cancel').click(); await settle();
  assert.equal(h.$('marker-title').value, 'Unsaved marker name');
  const guest = await harness(t, { editable: false });
  guest.w.document.querySelector('.marker-item').click();
  tapBackdrop(guest, guest.$('marker-dialog')); await settle();
  assert.equal(guest.$('marker-dialog').open, false);
  assert.equal(guest.$('confirm-dialog').open, false);
  assert.equal(guest.requests.some(request => request.method === 'PUT'), false);
});

test('the shared adventure name updates the map heading immediately and survives reload', async t => {
  const h = await harness(t), mapName = config.name;
  assertCampaignTitle(h, h.initial.name);
  h.$('session-name').value = '  丛林远征：失落之城  ';
  h.$('session-name').dispatchEvent(new h.w.Event('input'));
  assertCampaignTitle(h, '丛林远征：失落之城');
  assert.equal(h.current().name, '丛林远征：失落之城');
  await h.client.flush();
  assert.equal(h.stored().session.name, '丛林远征：失落之城');
  const reloaded = await harness(t, { editable: false, name: h.stored().session.name });
  assertCampaignTitle(reloaded, '丛林远征：失落之城');
  assert.equal(config.name, mapName, 'renaming a campaign leaves the map mod name intact');
});

test('remote campaign renames update guest map and search headings together', async t => {
  const h = await harness(t, { editable: false });
  h.remoteName('雨季中的楚尔特');
  await h.client.refresh();
  assertCampaignTitle(h, '雨季中的楚尔特');
  assert.equal(h.$('session-name').value, '雨季中的楚尔特');
  assert.equal(h.requests.filter(request => request.method === 'PUT').length, 0);
});

test('guests cannot rename the campaign through the adventure-name field', async t => {
  const h = await harness(t, { editable: false, name: '共享冒险' });
  assert.equal(h.$('session-name').readOnly, true);
  h.$('session-name').value = 'Unauthorized name';
  h.$('session-name').dispatchEvent(new h.w.Event('input'));
  h.$('session-name').dispatchEvent(new h.w.Event('change'));
  await h.client.flush();
  assertCampaignTitle(h, '共享冒险');
  assert.equal(h.$('session-name').value, '共享冒险');
  assert.equal(h.current().name, '共享冒险');
  assert.equal(h.requests.filter(request => request.method === 'PUT').length, 0);
});

test('individual adventure-note titles remain independent of the campaign name', async t => {
  const h = await harness(t, { name: '楚尔特远征' });
  h.mutateNotes(session => { session.adventureNotes[0].title = '神庙线索'; });
  await h.client.flush();
  assert.equal(h.stored().session.adventureNotes[0].title, '神庙线索');
  assertCampaignTitle(h, '楚尔特远征');
  assert.equal(h.$('session-name').value, '楚尔特远征');
});

test('adventure-note edits participate in shared saves and map undo/redo without changing travel data', async t => {
  const h = await harness(t, { notes: [] }), untouched = copy({ revealed: h.current().revealed, markers: h.current().markers, tripDays: h.current().tripDays });
  assert.equal(h.mutateNotes(session => { session.adventureNotes.push(note()); }), true);
  assert.deepEqual(copy(h.current().adventureNotes), [note()]);
  await h.client.flush();
  assert.deepEqual(h.stored().session.adventureNotes, [note()]);
  h.$('undo').click();
  assert.deepEqual(copy(h.current().adventureNotes), []);
  await h.client.flush();
  assert.deepEqual(h.stored().session.adventureNotes, []);
  h.$('redo').click(); await h.client.flush();
  assert.deepEqual(h.stored().session.adventureNotes, [note()]);
  assert.deepEqual(copy({ revealed: h.current().revealed, markers: h.current().markers, tripDays: h.current().tripDays }), untouched);
});

test('map and daily-log mutations retain adventure notes through saving and history', async t => {
  const h = await harness(t), existing = copy(h.current().adventureNotes);
  h.mutateLog(session => { session.tripDays[0].note = 'A changed daily log.'; session.markers[0].title = 'Renamed camp'; });
  await h.client.flush();
  assert.deepEqual(h.stored().session.adventureNotes, existing);
  assert.equal(h.stored().session.tripDays[0].note, 'A changed daily log.');
  assert.deepEqual(h.stored().session.tripDays[0].participants, ['游侠']);
  assert.deepEqual(h.stored().session.tripDays[0].attachments, []);
  h.$('undo').click(); await h.client.flush();
  assert.deepEqual(h.stored().session.adventureNotes, existing);
  assert.equal(h.stored().session.tripDays[0].note, 'A daily log.');
  assert.equal(h.stored().session.markers[0].title, 'Old camp');
});

test('guest note mutations and history are blocked before any campaign PUT', async t => {
  const h = await harness(t, { editable: false });
  let executed = false;
  assert.equal(h.mutateNotes(session => { executed = true; session.adventureNotes = []; }), false);
  h.$('undo').click(); h.$('redo').click(); await h.client.flush();
  assert.equal(executed, false);
  assert.deepEqual(copy(h.current().adventureNotes), [note()]);
  assert.equal(h.requests.filter(request => request.method === 'PUT').length, 0);
});

test('dirty note drafts cause sync conflicts and recovery downloads preserve note and daily-log drafts', async t => {
  const h = await harness(t), draft = { id: 'note-1', title: 'Unsaved title', body: 'Unsaved notes.' }, logDraft = { log: { note: 'Unsaved daily log.' } };
  h.setNotesDraft(draft); h.setLogDraft(logDraft);
  assert.equal(h.hasDraft(), true);
  assert.equal(h.w.MapJourneyApp.save(), false);
  h.remoteNotes([note('remote', 'Another editor’s documentation.')]);
  await h.client.refresh();
  assert.equal(h.client.status().conflict, true);
  assert.deepEqual(copy(h.current().adventureNotes), [note()], 'local data stays available until conflict resolution');
  h.$('campaign-download-draft').click();
  const recovery = JSON.parse(await h.blobs.at(-1).text());
  assert.deepEqual(recovery.adventureNotes, [note()]);
  assert.deepEqual(recovery.unsavedDrafts.adventureNotes, draft);
  assert.deepEqual(recovery.unsavedDrafts.gameLog, logDraft);
  assert.equal(h.downloads.at(-1).name, 'seerjourney-local-changes.seerjourney.json');
  h.$('notes-dialog').showModal(); h.$('log-dialog').showModal();
  h.$('campaign-load-latest').click(); await h.confirm();
  assert.equal(h.client.status().conflict, false);
  assert.deepEqual(copy(h.current().adventureNotes), [note('remote', 'Another editor’s documentation.')]);
  assert.equal(h.hasDraft(), false);
  assert.equal(h.$('notes-dialog').open, false); assert.equal(h.$('log-dialog').open, false);
  assert.equal(h.notesResets(), 1); assert.equal(h.logResets(), 1);
});

test('expired editor sessions retain recoverable note drafts and cannot run note mutations', async t => {
  const h = await harness(t), draft = { id: 'note-1', body: 'Recover after signing in again.' };
  h.setNotesDraft(draft); h.setAllowed(false); await h.client.refresh();
  assert.equal(h.client.status().mode, 'expired');
  assert.equal(h.mutateNotes(session => { session.adventureNotes = []; }), false);
  assert.equal(h.hasDraft(), true);
  h.$('campaign-download-draft').click();
  assert.deepEqual(JSON.parse(await h.blobs.at(-1).text()).unsavedDrafts.adventureNotes, draft);
  assert.equal(h.requests.filter(request => request.method === 'PUT').length, 0);
});

test('importing a legacy session explicitly clears adventure notes and resets note drafts', async t => {
  const h = await harness(t);
  h.setNotesDraft({ id: 'note-1', body: 'Old unsaved draft' });
  const legacy = copy(h.initial); delete legacy.adventureNotes;
  legacy.name = 'Imported older expedition';
  await h.importSession(legacy); await h.confirm();
  assert.deepEqual(copy(h.current().adventureNotes), []);
  assert.equal(h.current().name, legacy.name);
  assertCampaignTitle(h, legacy.name);
  assert.equal(h.hasDraft(), false); assert.equal(h.notesResets(), 1);
  await h.client.flush();
  const request = h.requests.filter(item => item.method === 'PUT').at(-1);
  assert.deepEqual(request.body.session.adventureNotes, [], 'explicit empty array prevents old-client server preservation during intentional replacement');
  assert.deepEqual(h.stored().session.tripDays, legacy.tripDays.map(day => ({ ...day, supplies: S.empty() })));
});

test('new expeditions clear notes and clean remote note updates arrive without disturbing the map camera', async t => {
  const h = await harness(t);
  const view = copy(h.current().view);
  h.remoteNotes([note('new-remote')]); await h.client.refresh();
  assert.deepEqual(copy(h.current().adventureNotes), [note('new-remote')]);
  assert.deepEqual(copy(h.current().view), view);
  assert.deepEqual(copy(h.current().markers), h.initial.markers);
  assert.deepEqual(copy(h.current().tripDays), h.initial.tripDays);
  h.$('new-session').click(); await h.confirm(); await h.client.flush();
  assert.deepEqual(h.stored().session.adventureNotes, []);
  assert.deepEqual(h.stored().session.tripDays, []);
  assertCampaignTitle(h, h.stored().session.name);
  assert.equal(h.notesResets(), 1);
});

test('the real note editor saves Markdown through sync and map undo restores its displayed document', async t => {
  const h = await harness(t, { realNotes: true });
  h.$('open-notes').click();
  assert.equal(h.$('notes-dialog').open, true);
  h.$('adventure-title').value = 'Temple reference';
  h.$('adventure-body').value = '# Temple\n\n**Bring rope.**';
  h.$('adventure-body').dispatchEvent(new h.w.Event('input'));
  assert.equal(h.hasDraft(), true);
  h.$('adventure-show-preview').click();
  assert.equal(h.$('adventure-preview').querySelector('h1').textContent, 'Temple');
  h.$('adventure-form').dispatchEvent(new h.w.Event('submit', { cancelable: true }));
  assert.equal(h.hasDraft(), false);
  await h.client.flush();
  assert.equal(h.stored().session.adventureNotes[0].title, 'Temple reference');
  assert.equal(h.stored().session.adventureNotes[0].body, '# Temple\n\n**Bring rope.**');
  h.$('undo').click(); await h.client.flush();
  assert.equal(h.$('adventure-title').value, note().title);
  assert.equal(h.$('adventure-body').value, note().body);
  assert.deepEqual(h.stored().session.adventureNotes, [note()]);
});

test('the real guest notes interface is read-only and synthetic submissions cannot save', async t => {
  const h = await harness(t, { editable: false, realNotes: true });
  h.$('open-notes').click();
  assert.equal(h.$('adventure-add').hidden, true);
  assert.equal(h.$('adventure-editor-toolbar').hidden, true);
  assert.equal(h.$('adventure-title').readOnly, true);
  assert.equal(h.$('adventure-body').readOnly, true);
  assert.equal(h.$('adventure-preview').textContent.trim(), note().body);
  h.$('adventure-title').value = 'An unauthorized edit';
  h.$('adventure-form').dispatchEvent(new h.w.Event('submit', { cancelable: true }));
  h.$('adventure-delete').dispatchEvent(new h.w.Event('click'));
  await settle(); await h.client.flush();
  assert.deepEqual(h.stored().session.adventureNotes, [note()]);
  assert.equal(h.requests.filter(request => request.method === 'PUT').length, 0);
});

test('real note drafts survive auth loss and conflict recovery resets the editor to shared data', async t => {
  const h = await harness(t, { realNotes: true });
  h.$('open-notes').click();
  h.$('adventure-body').value = 'A draft that must survive a lost login.';
  h.$('adventure-body').dispatchEvent(new h.w.Event('input'));
  h.setAllowed(false); await h.client.refresh();
  assert.equal(h.$('adventure-body').readOnly, true);
  assert.equal(h.hasDraft(), true);
  h.$('campaign-download-draft').click();
  assert.equal(JSON.parse(await h.blobs.at(-1).text()).unsavedDrafts.adventureNotes.body, 'A draft that must survive a lost login.');
  h.remoteNotes([note('remote', 'Updated shared reference')]); await h.client.refresh();
  assert.equal(h.client.status().conflict, true);
  assert.equal(h.$('adventure-body').value, 'A draft that must survive a lost login.');
  h.$('campaign-load-latest').click(); await h.confirm();
  assert.equal(h.hasDraft(), false);
  h.$('open-notes').click();
  assert.equal(h.$('adventure-preview').textContent.trim(), 'Updated shared reference');
  assert.equal(h.$('adventure-title').readOnly, true);
  assert.equal(h.requests.filter(request => request.method === 'PUT').length, 0);
});

test('supply edits share the campaign history and retain notes, participants, markers and route data', async t => {
  const h = await harness(t), initial = copy(h.current());
  const supplies = { foods: [{ id: 'food-1', name: '河鱼', amount: 5.125 }], water: 4, foodConsumed: 2.125, waterConsumed: 1 };
  assert.equal(h.mutateSupplies(session => { session.tripDays[0].supplies = supplies; }), true);
  await h.client.flush();
  assert.deepEqual(h.stored().session.tripDays[0].supplies, supplies);
  assert.equal(S.ledger(h.stored().session.tripDays).food, 3);
  h.$('undo').click(); await h.client.flush();
  assert.deepEqual(h.stored().session.tripDays[0].supplies, S.empty(), 'undo must explicitly clear supplies across the server preservation boundary');
  h.$('redo').click(); await h.client.flush();
  assert.deepEqual(h.stored().session.tripDays[0].supplies, supplies);
  const kept = h.stored().session;
  assert.deepEqual(kept.adventureNotes, initial.adventureNotes);
  assert.deepEqual(kept.markers, initial.markers);
  assert.deepEqual(kept.revealed, initial.revealed);
  const savedDay = { ...kept.tripDays[0] }; delete savedDay.supplies;
  assert.deepEqual(savedDay, initial.tripDays[0]);
});

test('supplies drafts participate in conflicts, recovery downloads and latest-campaign reset', async t => {
  const h = await harness(t), draft = { day: 1, supplies: { foods: [{ id: 'draft-food', name: '果实', amount: '2.5' }], water: '4', foodConsumed: '2', waterConsumed: '1' } };
  h.setSuppliesDraft(draft);
  assert.equal(h.hasDraft(), true);
  h.remoteNotes([note('remote')]); await h.client.refresh();
  assert.equal(h.client.status().conflict, true);
  h.$('campaign-download-draft').click();
  assert.deepEqual(JSON.parse(await h.blobs.at(-1).text()).unsavedDrafts.supplies, draft);
  h.$('supplies-dialog').showModal();
  h.$('campaign-load-latest').click(); await h.confirm();
  assert.equal(h.$('supplies-dialog').open, false);
  assert.equal(h.suppliesResets(), 1); assert.equal(h.hasDraft(), false);
  assert.equal(h.client.status().conflict, false);
});

test('legacy replacement explicitly clears same-ID supplies and expedition reset clears the ledger', async t => {
  const h = await harness(t), legacy = copy(h.initial);
  h.mutateSupplies(session => { session.tripDays[0].supplies = { ...S.empty(), foods: [{ id: 'old-food', name: '鱼', amount: 4 }], water: 8 }; });
  await h.client.flush();
  h.setSuppliesDraft({ day: 0, supplies: { water: '12' } });
  legacy.name = 'Imported without supplies';
  await h.importSession(legacy); await h.confirm(); await h.client.flush();
  const request = h.requests.filter(item => item.method === 'PUT').at(-1);
  assert.deepEqual(request.body.session.tripDays[0].supplies, S.empty(), 'explicit replacement prevents the server preserving the old same-ID inventory');
  assert.equal(S.ledger(h.stored().session.tripDays).food, 0);
  assert.equal(h.hasDraft(), false); assert.equal(h.suppliesResets(), 1);
  h.mutateSupplies(session => { session.tripDays[0].supplies = { ...S.empty(), water: 5 }; });
  await h.client.flush();
  h.$('new-session').click(); await h.confirm(); await h.client.flush();
  assert.deepEqual(h.stored().session.tripDays, []);
  assert.equal(S.ledger(h.stored().session.tripDays).water, 0);
  assert.equal(h.suppliesResets(), 2);
});

test('guests and expired editors cannot modify supplies, and auth loss retains draft recovery', async t => {
  const guest = await harness(t, { editable: false });
  assert.equal(guest.mutateSupplies(session => { session.tripDays[0].supplies = { ...S.empty(), water: 10 }; }), false);
  assert.equal(guest.requests.some(request => request.method === 'PUT'), false);
  const editor = await harness(t), draft = { day: 0, supplies: { water: '10' } };
  editor.setSuppliesDraft(draft); editor.setAllowed(false); await editor.client.refresh();
  assert.equal(editor.client.status().mode, 'expired');
  assert.equal(editor.mutateSupplies(session => { session.tripDays[0].supplies = S.empty(); }), false);
  editor.$('campaign-download-draft').click();
  assert.deepEqual(JSON.parse(await editor.blobs.at(-1).text()).unsavedDrafts.supplies, draft);
  assert.equal(editor.hasDraft(), true);
});
