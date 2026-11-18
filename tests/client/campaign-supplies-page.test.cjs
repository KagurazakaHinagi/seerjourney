'use strict';
const { sourcePath } = require('../helpers/source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const C = require('../../src/shared/core.js'), S = require('../../src/shared/supplies-core.js');
const root = path.resolve(__dirname, '../..');
const source = file => fs.readFileSync(sourcePath(file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const supply = changes => ({ ...S.empty(), ...changes });
const day = (number, supplies, rest = {}) => ({ id: `day-${number}`, day: number, note: `Notes ${number}`, hex: null, ...(supplies ? { supplies } : {}), ...rest });
const food = (id, name, amount) => ({ id, name, amount });

function harness(t, { editable = true, omitAccess = false, entries = [], locale = 'en', ask = async () => true } = {}) {
  const dom = new JSDOM(source('index.html'), { url: 'https://campaign.example/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom, $ = id => window.document.getElementById(id);
  const session = { tripDays: plain(entries) }, history = [], prompts = [], toasts = [], openedDays = [];
  let mutationAllowed = true, controller;
  window.Element.prototype.scrollIntoView = function () {};
  for (const element of window.document.querySelectorAll('dialog')) element.close = () => { element.open = false; };
  window.MapJourneyI18n = require('../../src/client/i18n/i18n.js')({ storage: { getItem: () => locale }, document: window.document });
  for (const file of ['supplies-core.js', 'locales/zh-CN-supplies.js', 'locales/zh-CN-stores.js', 'supply-fields.js', 'supplies-page.js']) window.eval(source(file));
  controller = window.MapJourneySuppliesPage.create({ core: C, getSession: () => session,
    ...(omitAccess ? {} : { canEdit: () => editable }),
    mutate(action) { if (!editable || !mutationAllowed) return false; history.push(plain(session)); action(); controller.refresh(); return true; },
    ask: async (...args) => { prompts.push(args); return ask(...args); }, toast: text => toasts.push(text),
    openDialog: id => { $(id).open = true; }, openDay: async id => { openedDays.push(id); return true; } });
  return { window, $, session, controller, history, prompts, toasts, openedDays,
    setEditable(value) { editable = value; controller.updateAccess(); }, allowMutation(value) { mutationAllowed = value; },
    input(id, value) { $(id).value = value; $(id).dispatchEvent(new window.Event('input', { bubbles: true })); },
    async click(id) { $(id).click(); await settle(); },
    async submit(id = 'stores-form') { $(id).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle(); },
    async choose(value) { $('stores-day').value = String(value); $('stores-day-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle(); },
    addFood(name, amount) { $('stores-food-add').click(); const row = $('stores-food-list').lastElementChild;
      const fields = row.querySelectorAll('input'); fields[0].value = name; fields[1].value = amount; fields[1].dispatchEvent(new window.Event('input', { bubbles: true })); return row; }
  };
}

test('guests and absent access configuration read supplies without modification controls', async t => {
  for (const access of [{ editable: false }, { omitAccess: true }]) {
    const h = harness(t, { ...access, entries: [day(0, supply({ foods: [food('fruit', 'Forest fruit', 5)], water: 7, foodConsumed: 1 }))] });
    h.controller.open();
    assert.equal(h.$('stores-food-total').textContent, '4 lbs'); assert.equal(h.$('stores-water-total').textContent, '7 gals');
    assert.match(h.$('stores-inventory-list').textContent, /Forest fruit/);
    assert.equal(h.$('stores-edit').hidden, true); assert.equal(h.$('stores-save').hidden, true);
    await h.click('stores-edit'); await h.submit(); assert.equal(h.$('stores-form').hidden, true); assert.equal(h.history.length, 0);
    await h.choose(0); await h.click('stores-open-log'); assert.deepEqual(h.openedDays, ['day-0']);
  }
});

test('food names and expiry remain visible while water survives beyond Day 7', async t => {
  const h = harness(t, { editable: false, entries: [day(0, supply({ foods: [food('fruit', '<img src=x> Fruit', 2.125)], water: 3.001 }))] });
  h.controller.open(); await h.choose(6);
  assert.equal(h.$('stores-food-total').textContent, '2.125 lbs'); assert.match(h.$('stores-inventory-list').textContent, /Expires Day 7/);
  assert.equal(h.$('stores-inventory-list').querySelector('img'), null);
  await h.choose(7); assert.equal(h.$('stores-food-total').textContent, '0 lbs'); assert.equal(h.$('stores-expired').hidden, false);
  assert.match(h.$('stores-expired-list').textContent, /<img src=x> Fruit/); assert.match(h.$('stores-expired-list').textContent, /Expired Day 7/);
  assert.equal(h.$('stores-water-total').textContent, '3.001 gals');
  await h.choose(1000); assert.equal(h.$('stores-water-total').textContent, '3.001 gals');
});

test('editing supplies preserves notes, images, participants, IDs and map positions', async t => {
  const attachment = { id: 'image-one', url: 'https://example.org/image.jpg' };
  const h = harness(t, { entries: [day(0, undefined, { note: 'Keep these notes', hex: '10,11', attachments: [attachment], participants: ['Rin'], arbitraryFutureField: 'keep' })] });
  h.controller.open(); await h.choose(0); await h.click('stores-edit');
  h.addFood('Fruit', '5'); h.input('stores-water-found', '3'); await h.submit();
  const saved = h.session.tripDays[0];
  assert.equal(saved.id, 'day-0'); assert.equal(saved.hex, '10,11'); assert.equal(saved.note, 'Keep these notes');
  assert.deepEqual(plain(saved.attachments), [attachment]); assert.deepEqual(plain(saved.participants), ['Rin']); assert.equal(saved.arbitraryFutureField, 'keep');
  assert.equal(saved.supplies.foods[0].name, 'Fruit'); assert.equal(saved.supplies.water, 3);
  assert.equal(h.$('stores-form').hidden, true); assert.equal(h.history.length, 1);
});

test('a no-foraging day consumes older leftovers first and creates one shared game-log entry', async t => {
  const h = harness(t, { entries: [day(0, supply({ foods: [food('old', 'Fruit', 3)], water: 5 })), day(1, supply({ foods: [food('new', 'Meat', 4)] }))] });
  h.controller.open(); assert.equal(h.$('stores-day').value, '2'); await h.click('stores-edit');
  h.input('stores-food-consumed', '4'); h.input('stores-water-consumed', '1.5'); await h.submit();
  assert.equal(h.session.tripDays.length, 3); const saved = h.session.tripDays[2];
  assert.equal(saved.day, 2); assert.equal(saved.note, ''); assert.equal(saved.hex, null); assert.deepEqual(plain(saved.supplies.foods), []);
  const ledger = S.ledger(h.session.tripDays); assert.equal(ledger.batches[0].status, 'consumed'); assert.equal(ledger.batches[1].remaining, 3);
  assert.equal(h.$('stores-water-total').textContent, '3.5 gals'); assert.equal(h.$('stores-open-log').hidden, false);
  await h.click('stores-edit'); h.input('stores-water-consumed', '2'); await h.submit(); assert.equal(h.session.tripDays.length, 3);
});

test('overdrawing water or expired food is rejected without mutating the campaign', async t => {
  const h = harness(t, { entries: [day(0, supply({ foods: [food('fruit', 'Fruit', 5)], water: 2 }))] });
  h.controller.open(); await h.choose(7); await h.click('stores-edit'); h.input('stores-food-consumed', '1'); await h.submit();
  assert.match(h.$('stores-error').textContent, /only 0 lbs is unexpired/); assert.equal(h.history.length, 0);
  h.input('stores-food-consumed', '0'); h.input('stores-water-consumed', '3'); await h.submit();
  assert.match(h.$('stores-error').textContent, /only 2 gals/); assert.equal(h.session.tripDays.length, 1);
  assert.equal(h.controller.getDrafts().supplies.waterConsumed, '3');
});

test('historical harvest reductions cannot invalidate later consumption', async t => {
  const h = harness(t, { entries: [day(0, supply({ foods: [food('fruit', 'Fruit', 5)] })), day(1, supply({ foodConsumed: 4 }))] });
  h.controller.open(); await h.choose(0); await h.click('stores-edit');
  const amount = h.$('stores-food-list').querySelectorAll('input')[1]; amount.value = '2'; amount.dispatchEvent(new h.window.Event('input'));
  await h.submit(); assert.match(h.$('stores-error').textContent, /Day 1 needs 4 lbs/); assert.equal(h.history.length, 0);
  assert.equal(h.session.tripDays[0].supplies.foods[0].amount, 5);
});

test('invalid supply drafts survive auth loss, refresh and failed saves for recovery', async t => {
  const h = harness(t, { ask: async () => false }); h.controller.open(); await h.click('stores-edit');
  h.addFood('Fruit', '-2'); await h.submit(); assert.equal(h.history.length, 0); assert.equal(h.controller.hasDraft(), true);
  h.setEditable(false); h.controller.refresh(); await h.click('stores-close');
  assert.equal(h.$('supplies-dialog').open, true); assert.equal(h.controller.getDrafts().supplies.foods[0].amount, '-2');
  h.setEditable(true); h.$('stores-food-list').querySelectorAll('input')[1].value = '2';
  h.allowMutation(false); await h.submit(); assert.match(h.$('stores-error').textContent, /could not be saved/); assert.equal(h.history.length, 0);
  assert.equal(h.controller.getDrafts().supplies.foods[0].amount, '2');
  h.allowMutation(true); await h.submit(); assert.equal(h.history.length, 1); assert.equal(h.controller.hasDraft(), false);
});

test('changing days, canceling and closing ask before dropping a supply draft', async t => {
  let discard = false; const h = harness(t, { ask: async () => discard }); h.controller.open(); await h.click('stores-edit'); h.input('stores-water-found', '2');
  await h.choose(5); assert.equal(h.$('stores-day').value, '0'); assert.equal(h.controller.getDrafts().day, 0);
  await h.click('stores-cancel'); assert.equal(h.$('stores-form').hidden, false);
  await h.click('stores-close'); assert.equal(h.$('supplies-dialog').open, true); assert.equal(h.prompts.length, 3);
  discard = true; await h.choose(5); assert.equal(h.$('stores-day').value, '5'); assert.equal(h.controller.hasDraft(), false);
  await h.click('stores-close'); assert.equal(h.$('supplies-dialog').open, false); assert.equal(h.$('options-dialog').open, true);
});

test('unrelated refresh preserves focused supply field caret and selected inventory text', async t => {
  const h = harness(t, { entries: [day(0, supply({ foods: [food('fruit', 'Forest fruit', 5)], water: 2 }))] });
  h.controller.open(); const name = h.$('stores-inventory-list').querySelector('strong').firstChild;
  const selection = h.window.getSelection(), range = h.window.document.createRange(); range.setStart(name, 0); range.setEnd(name, 6); selection.removeAllRanges(); selection.addRange(range);
  h.session.tripDays[0].note = 'An unrelated note change'; h.controller.refresh();
  assert.equal(selection.anchorNode, name); assert.equal(selection.toString(), 'Forest');
  await h.choose(0); await h.click('stores-edit'); const field = h.$('stores-food-list').querySelector('input'); field.focus(); field.setSelectionRange(2, 5);
  h.controller.refresh(); assert.equal(h.window.document.activeElement, field); assert.equal(field.selectionStart, 2); assert.equal(field.selectionEnd, 5);
});

test('supply editor and inventory keep unique DOM identifiers', t => {
  const h = harness(t); h.controller.open();
  const ids = [...h.window.document.querySelectorAll('[id]')].map(element => element.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
});

test('background refresh preserves the day being typed and its selection until submission', async t => {
  const h = harness(t, { entries: [day(0, supply({ water: 3 }))] }); h.controller.open();
  const field = h.$('stores-day'); field.focus(); h.input('stores-day', '123'); field.setSelectionRange(1, 2);
  h.session.tripDays[0].note = 'A remote game-log edit'; h.controller.refresh(); h.controller.updateAccess();
  assert.equal(field.value, '123'); assert.equal(h.window.document.activeElement, field);
  assert.equal(field.selectionStart, 1); assert.equal(field.selectionEnd, 2);
  assert.match(h.$('stores-summary').textContent, /Day 1$/);
  h.session.tripDays.push(day(1)); h.controller.refresh();
  assert.equal(field.value, '123'); assert.equal(field.selectionStart, 1); assert.equal(field.selectionEnd, 2);
  await h.submit('stores-day-form');
  assert.equal(field.value, '123'); assert.match(h.$('stores-summary').textContent, /Day 123$/);
});

test('maximum game day stays selectable and invalid view days do not alter the inventory day', async t => {
  const h = harness(t, { entries: [day(C.MAX_TRIP_DAY, supply({ water: 1 }))] }); h.controller.open();
  assert.equal(h.$('stores-day').value, String(C.MAX_TRIP_DAY)); assert.equal(h.$('stores-water-total').textContent, '1 gals');
  for (const invalid of ['-1', '1.5', 'word', String(C.MAX_TRIP_DAY + 1)]) {
    await h.choose(invalid); assert.match(h.$('stores-error').textContent, /whole day number/);
    assert.match(h.$('stores-summary').textContent, new RegExp(String(C.MAX_TRIP_DAY).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
  }
});
