'use strict';
const { sourcePath } = require('../helpers/source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { buildSync } = require('esbuild');
const C = require('../../src/shared/core.js');
const root = path.resolve(__dirname, '../..');
const markdown = buildSync({ entryPoints: [path.join(root, 'src/client/features/adventure-notes/markdown-entry.js')], bundle: true, write: false,
  platform: 'browser', target: ['safari16', 'chrome100'], format: 'iife' }).outputFiles[0].text;
const source = fs.readFileSync(sourcePath('adventure-notes.js'), 'utf8');
const makeNote = (id = 'note-1', overrides = {}) => ({ id, title: 'Temple clues', body: '## The gate\n\nBring **water**.',
  createdAt: '2026-11-16T10:00:00.000Z', updatedAt: '2026-11-16T10:00:00.000Z', ...overrides });
const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(t, { editable = true, omitAccess = false, mobile = false, deferredSession = false, locale = 'en', ask = async () => true, entries = [makeNote()] } = {}) {
  const dom = new JSDOM('<!doctype html><button id="open-notes"></button><dialog id="notes-dialog" class="game-log adventure-notes"></dialog>', { url: 'https://campaign.example/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom, $ = id => window.document.getElementById(id);
  const session = { adventureNotes: entries, tripDays: [{ id: 'day-0', day: 0, note: 'Daily notes', hex: null }], markers: [] };
  let loaded = !deferredSession, mutationAllowed = true, controller;
  const media = { matches: mobile, addEventListener(type, callback) { this.listener = callback; } };
  window.matchMedia = () => media;
  $('notes-dialog').close = () => { $('notes-dialog').open = false; };
  window.MapJourneyI18n = require('../../src/client/i18n/i18n.js')({ storage: { getItem: () => locale }, document: window.document });
  window.eval(fs.readFileSync(sourcePath('locales/zh-CN-notes.js'), 'utf8'));
  window.eval(markdown); window.eval(source);
  const history = [], toasts = [], prompts = [];
  controller = window.MapJourneyAdventureNotes.create({ core: C, getSession: () => loaded ? session : undefined,
    ...(omitAccess ? {} : { canEdit: () => editable }),
    mutate(action) { if (!editable || !mutationAllowed) return false; history.push(plain(session)); action(); controller.refresh(); return true; },
    ask: async (...args) => { prompts.push(args); return ask(...args); }, toast: message => toasts.push(message),
    openDialog: id => { $(id).open = true; } });
  return { dom, window, $, session, controller, history, toasts, prompts,
    load() { loaded = true; controller.refresh(); controller.updateAccess(); },
    setEditable(value) { editable = value; controller.updateAccess(); },
    allowMutation(value) { mutationAllowed = value; },
    resize(value) { media.matches = value; media.listener?.(); },
    async click(id) { $(id).click(); await settle(); },
    async submit() { $('adventure-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle(); },
    input(id, value) { $(id).value = value; $(id).dispatchEvent(new window.Event('input', { bubbles: true })); }
  };
}

test('notes initialize without campaign data and update when the shared session arrives', async t => {
  const h = harness(t, { deferredSession: true, editable: false });
  h.controller.updateAccess(); h.controller.refresh(); h.controller.open();
  assert.equal(h.$('adventure-empty').hidden, false); assert.equal(h.controller.hasDraft(), false);
  assert.equal(h.controller.getDrafts(), null); assert.equal(h.$('adventure-list').children.length, 0);
  h.load();
  assert.equal(h.$('adventure-list').children.length, 1);
  assert.equal(h.$('adventure-preview-title').textContent, 'Temple clues');
  assert.equal(h.$('adventure-preview').querySelector('strong').textContent, 'water');
});

test('guests see rendered Markdown and default-deny access prevents all note writes', async t => {
  for (const options of [{ editable: false }, { omitAccess: true }]) {
    const h = harness(t, options); h.controller.open();
    assert.equal(h.$('adventure-write-fields').hidden, true); assert.equal(h.$('adventure-rendered').hidden, false);
    assert.equal(h.$('adventure-editor-toolbar').hidden, true); assert.equal(h.$('adventure-add').hidden, true);
    assert.equal(h.$('adventure-title').readOnly, true); assert.equal(h.$('adventure-body').readOnly, true);
    h.input('adventure-title', 'Not allowed'); await h.submit(); await h.click('adventure-delete'); await h.click('adventure-add');
    assert.equal(h.session.adventureNotes.length, 1); assert.equal(h.session.adventureNotes[0].title, 'Temple clues');
    assert.equal(h.history.length, 0); assert.equal(h.prompts.length, 0);
  }
});

test('write and preview stay drafts until save and preserve the daily game log', async t => {
  const h = harness(t); h.controller.open();
  h.input('adventure-title', '  Expedition supplies  '); h.input('adventure-body', '# Packing\n\n- Rope\n- Food');
  await h.click('adventure-show-preview');
  assert.equal(h.$('adventure-write-fields').hidden, true); assert.equal(h.$('adventure-preview').querySelectorAll('li').length, 2);
  assert.equal(h.$('adventure-preview-title').textContent, 'Expedition supplies');
  assert.equal(h.controller.hasDraft(), true); assert.equal(h.session.adventureNotes[0].title, 'Temple clues');
  await h.submit();
  assert.equal(h.session.adventureNotes[0].title, 'Expedition supplies'); assert.equal(h.session.adventureNotes[0].body, '# Packing\n\n- Rope\n- Food');
  assert.equal(h.session.adventureNotes[0].createdAt, '2026-11-16T10:00:00.000Z');
  assert.match(h.session.adventureNotes[0].updatedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(h.session.tripDays, [{ id: 'day-0', day: 0, note: 'Daily notes', hex: null }]);
  assert.equal(h.controller.hasDraft(), false); assert.equal(h.$('adventure-rendered').hidden, false);
});

test('untrusted titles stay plain text and Markdown rendering never exposes active HTML', async t => {
  const h = harness(t, { editable: false, entries: [makeNote('unsafe', { title: '<img src=x onerror=alert(1)>', body: '<script>window.pwned=1</script>\n\n[Unsafe](javascript:alert%281%29)\n\n[Guide](https://example.org)' })] });
  h.controller.open();
  assert.equal(h.$('adventure-preview-title').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(h.$('notes-dialog').querySelector('img, script, [onerror]'), null);
  assert.equal(h.$('adventure-preview').querySelectorAll('a').length, 1);
  assert.equal(h.$('adventure-preview').querySelector('a').rel, 'noopener noreferrer');
  assert.equal(h.window.pwned, undefined);
});

test('auth loss and rejected mutations keep draft text recoverable and do not save', async t => {
  const h = harness(t, { ask: async () => false }); h.controller.open();
  h.input('adventure-title', 'Private draft title'); h.input('adventure-body', '**Unsent content**');
  h.allowMutation(false); await h.submit();
  assert.match(h.$('adventure-error').textContent, /could not be saved/); assert.equal(h.controller.hasDraft(), true);
  h.setEditable(false); await h.submit(); await h.click('adventure-close');
  assert.equal(h.$('notes-dialog').open, true); assert.equal(h.$('adventure-write-fields').hidden, true);
  assert.equal(h.$('adventure-preview').querySelector('strong').textContent, 'Unsent content');
  assert.deepEqual(plain(h.controller.getDrafts()), { id: 'note-1', title: 'Private draft title', body: '**Unsent content**' });
  assert.equal(h.session.adventureNotes[0].title, 'Temple clues');
  h.allowMutation(true); h.setEditable(true); await h.submit();
  assert.equal(h.session.adventureNotes[0].title, 'Private draft title'); assert.equal(h.controller.hasDraft(), false);
});

test('remote updates preserve dirty notes but refresh clean guest documents', async t => {
  const h = harness(t); h.controller.open(); h.input('adventure-body', 'Local draft');
  h.session.adventureNotes[0] = makeNote('note-1', { body: 'Remote update' }); h.controller.refresh();
  assert.equal(h.$('adventure-body').value, 'Local draft');
  h.controller.open(); assert.equal(h.$('adventure-body').value, 'Local draft');
  h.session.adventureNotes = []; await h.submit();
  assert.match(h.$('adventure-error').textContent, /removed from the shared campaign/);
  assert.equal(h.controller.getDrafts().body, 'Local draft'); assert.equal(h.session.adventureNotes.length, 0);
  h.controller.reset(); h.session.adventureNotes = [makeNote()]; h.setEditable(false); h.controller.refresh();
  h.session.adventureNotes[0] = makeNote('note-1', { title: 'New title', body: 'A **new** clue' }); h.controller.refresh();
  assert.equal(h.$('adventure-preview-title').textContent, 'New title');
  assert.equal(h.$('adventure-preview').querySelector('strong').textContent, 'new');
});

test('new notes save with independent IDs and confirmed deletion passes through undo', async t => {
  const h = harness(t, { entries: [] }); h.controller.open();
  assert.equal(h.$('adventure-empty-add').textContent, 'Add your first note');
  await h.click('adventure-empty-add'); h.input('adventure-title', 'Quest ledger'); h.input('adventure-body', 'Find the shrine.');
  assert.equal(h.session.adventureNotes.length, 0); assert.equal(h.controller.hasDraft(), true);
  await h.submit();
  assert.match(h.session.adventureNotes[0].id, /^note-/); assert.equal(h.session.adventureNotes[0].title, 'Quest ledger');
  await h.click('adventure-delete');
  assert.equal(h.prompts.length, 1); assert.match(h.prompts[0][0], /Quest ledger/);
  assert.equal(h.session.adventureNotes.length, 0); assert.equal(h.history.at(-1).adventureNotes[0].title, 'Quest ledger');
  assert.equal(h.$('adventure-empty').hidden, false); assert.equal(h.controller.hasDraft(), false);
});

test('mobile notes start as a vertical list, protect unsaved navigation, and return to the list', async t => {
  let discard = false;
  const h = harness(t, { mobile: true, ask: async () => discard, entries: [makeNote(), makeNote('note-2', { title: 'Second note' })] });
  h.controller.open(); assert.equal(h.$('notes-dialog').dataset.logView, 'list');
  h.$('adventure-list').firstElementChild.click(); await settle();
  assert.equal(h.$('notes-dialog').dataset.logView, 'detail'); assert.equal(h.$('adventure-heading').textContent, 'Note');
  h.input('adventure-body', 'Draft'); await h.click('adventure-back');
  assert.equal(h.$('notes-dialog').dataset.logView, 'detail'); assert.equal(h.controller.hasDraft(), true);
  discard = true; await h.click('adventure-back'); assert.equal(h.$('notes-dialog').dataset.logView, 'list');
  assert.equal(h.controller.hasDraft(), false); assert.equal(h.controller.getDrafts(), null);
  h.resize(false); assert.equal(h.$('notes-dialog').dataset.logView, 'detail');
  assert.equal(h.$('adventure-body').value, makeNote().body);
});

test('validation limits keep rejected content in the draft', async t => {
  const h = harness(t, { entries: [] }); h.controller.open(); await h.click('adventure-empty-add');
  h.input('adventure-body', 'Unsent'); await h.click('adventure-show-preview'); await h.submit();
  assert.match(h.$('adventure-error').textContent, /title of 1 to 160/); assert.equal(h.session.adventureNotes.length, 0);
  assert.equal(h.$('adventure-write-fields').hidden, false); assert.equal(h.window.document.activeElement, h.$('adventure-title'));
  h.input('adventure-title', 'x'.repeat(161)); await h.submit(); assert.equal(h.session.adventureNotes.length, 0);
  h.input('adventure-title', 'Valid'); h.input('adventure-body', 'x'.repeat(50001)); await h.submit();
  assert.match(h.$('adventure-error').textContent, /50,000/); assert.equal(h.controller.getDrafts().body.length, 50001);
  h.session.adventureNotes = Array.from({ length: 200 }, (_, i) => makeNote(`note-${i}`));
  h.input('adventure-body', 'Within limit'); await h.submit(); assert.match(h.$('adventure-error').textContent, /200 adventure notes/);
  assert.equal(h.session.adventureNotes.length, 200);
});

test('Chinese labels and sync recovery controls are available before parent binding', t => {
  const h = harness(t, { locale: 'zh-CN', editable: false, mobile: true });
  assert.equal(h.$('adventure-heading').textContent, '冒险笔记');
  const notice = h.$('notes-dialog').querySelector('[data-dialog-sync-notice]');
  assert.ok(notice.querySelector('p'));
  for (const name of ['download', 'latest', 'retry', 'signin']) assert.ok(notice.querySelector(`[data-campaign-${name}]`));
  h.controller.open(); assert.equal(h.$('adventure-summary').textContent, '1 篇共享笔记');
});

test('unrelated campaign refresh preserves reader selection, focused links, and editor caret', async t => {
  const h = harness(t, { editable: false, entries: [makeNote('note-1', { body: 'A **shared clue**. [Guide](https://example.org)' })] });
  h.controller.open();
  const link = h.$('adventure-preview').querySelector('a'), selectedText = h.$('adventure-preview').querySelector('strong').firstChild;
  link.focus();
  const selection = h.window.getSelection(), range = h.window.document.createRange();
  range.setStart(selectedText, 0); range.setEnd(selectedText, 6); selection.removeAllRanges(); selection.addRange(range);
  h.session.markers.push({ title: 'Unrelated map marker' });
  h.session.adventureNotes[0] = { ...h.session.adventureNotes[0], updatedAt: '2026-11-17T10:00:00.000Z' };
  h.controller.refresh(); h.controller.updateAccess();
  assert.equal(h.$('adventure-preview').querySelector('a'), link);
  assert.equal(h.window.document.activeElement, link);
  assert.equal(selection.anchorNode, selectedText); assert.equal(selection.toString(), 'shared');
  h.setEditable(true); await h.click('adventure-write');
  h.$('adventure-title').focus(); h.$('adventure-title').setSelectionRange(2, 8);
  h.controller.refresh();
  assert.equal(h.window.document.activeElement, h.$('adventure-title'));
  assert.equal(h.$('adventure-title').selectionStart, 2); assert.equal(h.$('adventure-title').selectionEnd, 8);
  h.setEditable(false); h.session.adventureNotes[0].body = 'A **different** clue'; h.controller.refresh();
  assert.equal(h.$('adventure-preview').querySelector('strong').textContent, 'different');
});

test('list refresh keeps keyboard focus on the same note with safe removal fallbacks', t => {
  const h = harness(t, { editable: false, entries: [makeNote(), makeNote('note-2', { title: 'Second note' })] });
  h.controller.open();
  const row = id => h.$('adventure-list').querySelector(`[data-note-id="${id}"]`);
  row('note-2').focus(); h.session.tripDays[0].note = 'Unrelated daily update'; h.controller.refresh();
  assert.equal(h.window.document.activeElement, row('note-2'));
  h.session.adventureNotes = h.session.adventureNotes.filter(note => note.id !== 'note-2'); h.controller.refresh();
  assert.equal(h.window.document.activeElement, row('note-1'));
  h.session.adventureNotes = []; h.controller.refresh();
  assert.equal(h.window.document.activeElement, h.$('adventure-close'));
  assert.equal(h.$('adventure-empty').hidden, false);
});

test('Markdown table alignment remains visible through the note stylesheet', t => {
  const h = harness(t, { editable: false, entries: [makeNote('table', { body: '| Left | Center | Right |\n| :--- | :---: | ---: |\n| One | Two | Three |' })] });
  const style = h.window.document.createElement('style'); style.textContent = fs.readFileSync(sourcePath('adventure-notes.css'), 'utf8'); h.window.document.head.append(style);
  h.controller.open();
  for (const [alignment, expected] of [['left', 'left'], ['center', 'center'], ['right', 'right']]) {
    const cell = h.$('adventure-preview').querySelector(`td[align="${alignment}"]`);
    assert.ok(cell); assert.equal(h.window.getComputedStyle(cell).textAlign, expected);
  }
});
