'use strict';
const { sourcePath } = require('../helpers/source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const C = require('../../src/shared/core.js');
const S = require('../../src/shared/supplies-core.js');
const root = path.resolve(__dirname, '../..');
const source = file => fs.readFileSync(sourcePath(file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const supplies = changes => ({ ...S.empty(), ...changes });
const day = (number, values = {}) => ({ id: `day-${number}`, day: number, note: `Notes ${number}`, hex: null, ...values });

function harness(t, { editable = true, mobile = false, locale = 'en', entries = [], ask = async () => true } = {}) {
  const dom = new JSDOM(source('index.html'), { url: 'https://campaign.example/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom, $ = id => window.document.getElementById(id);
  const session = { tripDays: plain(entries) }, history = [], prompts = [], toasts = [];
  let mutationAllowed = true, controller;
  window.matchMedia = () => ({ matches: mobile, addEventListener() {} });
  window.Element.prototype.scrollIntoView = function () {};
  for (const element of window.document.querySelectorAll('dialog')) element.close = () => { element.open = false; };
  for (const context of ['log', 'trip']) if (!$(`${context}-supplies`)) {
    const section = window.document.createElement('section'); section.id = `${context}-supplies`; $(`${context}-form`).append(section);
  }
  window.MapJourneyI18n = require('../../src/client/i18n/i18n.js')({ storage: { getItem: () => locale }, document: window.document });
  for (const file of ['supplies-core.js', 'locales/zh-CN-supplies.js', 'participant-tags.js', 'supply-fields.js', 'game-log.js']) window.eval(source(file));
  controller = window.MapJourneyGameLog.create({ core: C, grid: { type: 'hex', orientation: 'flat', offset: 'odd', origin: { x: 0, y: 0 }, size: 1 },
    getSession: () => session, canEdit: () => editable,
    mutate(action) { if (!editable || !mutationAllowed) return false; history.push(plain(session)); action(); controller.refresh(); return true; },
    ask: async (...args) => { prompts.push(args); return ask(...args); }, toast: message => toasts.push(message),
    openDialog: id => { $(id).open = true; }, createSnapshot: () => null, placeOnMap() {} });
  return { window, $, session, controller, history, prompts, toasts,
    setEditable(value) { editable = value; controller.updateAccess(); }, allowMutation(value) { mutationAllowed = value; },
    input(id, value) { $(id).value = value; $(id).dispatchEvent(new window.Event('input', { bubbles: true })); },
    async click(id) { $(id).click(); await settle(); },
    async submit(context = 'log') { $(`${context}-form`).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle(); },
    addFood(context, name, amount) { $(`${context}-food-add`).click(); const row = $(`${context}-food-list`).lastElementChild;
      const fields = row.querySelectorAll('input'); fields[0].value = name; fields[1].value = amount; fields[1].dispatchEvent(new window.Event('input', { bubbles: true })); return row; }
  };
}

test('food and water remain game-log drafts until saving and preserve unrelated day fields', async t => {
  const h = harness(t, { entries: [day(0, { participants: ['林'], attachments: [], extra: 'preserved' })] });
  await h.controller.openDay('day-0');
  h.addFood('log', '  水果  ', '5.125'); h.input('log-water-found', '4.5'); h.input('log-food-consumed', '1.125'); h.input('log-water-consumed', '.5');
  assert.equal(h.session.tripDays[0].supplies, undefined); assert.equal(h.controller.hasDraft(), true);
  await h.submit();
  const saved = h.session.tripDays[0];
  assert.deepEqual(plain(saved.participants), ['林']); assert.equal(saved.extra, 'preserved'); assert.equal(saved.note, 'Notes 0');
  assert.equal(saved.supplies.foods[0].name, '水果'); assert.equal(saved.supplies.foods[0].amount, 5.125);
  assert.deepEqual(plain(S.ledger(h.session.tripDays)).food, 4); assert.equal(S.ledger(h.session.tripDays).water, 4);
  assert.equal(h.controller.hasDraft(), false); assert.equal(h.history.length, 1);
});

test('both daily editors save supply records and each retains its own draft', async t => {
  const h = harness(t, { entries: [day(0), day(1)] });
  await h.controller.openDay('day-0'); h.addFood('log', 'Fruit', '4');
  h.controller.openTrip(null, 'day-1'); h.input('trip-water-found', '6'); await h.submit('trip');
  assert.equal(h.session.tripDays[0].supplies, undefined); assert.equal(h.session.tripDays[1].supplies.water, 6);
  assert.equal(h.controller.getDrafts().log.supplies.foods[0].name, 'Fruit');
  await h.submit(); assert.equal(h.session.tripDays[0].supplies.foods[0].amount, 4);
});

test('unexpired leftovers feed a no-foraging day while expired food cannot be consumed', async t => {
  const h = harness(t, { entries: [day(0, { supplies: supplies({ foods: [{ id: 'fruit', name: 'Fruit', amount: 5 }], water: 5 }) })] });
  await h.controller.openDay(null, 6); h.input('log-food-consumed', '2'); h.input('log-water-consumed', '1'); await h.submit();
  assert.equal(h.session.tripDays.length, 2); assert.equal(S.ledger(h.session.tripDays, 6).food, 3);
  await h.controller.openDay(null, 7); h.input('log-food-consumed', '1'); await h.submit();
  assert.match(h.$('log-error').textContent, /only 0 lbs is unexpired/); assert.equal(h.session.tripDays.length, 2);
  assert.equal(h.controller.getDrafts().log.supplies.foodConsumed, '1');
  h.input('log-food-consumed', '0'); h.input('log-water-consumed', '1'); await h.submit();
  assert.equal(h.session.tripDays.length, 3); assert.equal(S.ledger(h.session.tripDays).water, 3);
});

test('invalid numbers and blank food names remain visible and recoverable', async t => {
  const h = harness(t); await h.controller.openDay();
  const row = h.addFood('log', '', '1'); await h.submit();
  assert.match(h.$('log-supplies-error').textContent, /food name/); assert.equal(h.session.tripDays.length, 0);
  row.querySelector('input').value = 'Fruit'; row.querySelectorAll('input')[1].value = '-1'; await h.submit();
  assert.match(h.$('log-supplies-error').textContent, /weight above 0/);
  assert.equal(h.controller.getDrafts().log.supplies.foods[0].amount, '-1');
  row.querySelectorAll('input')[1].value = '2';
  for (const value of ['-1', 'Infinity', '1e3', '0.0001', '1000001']) {
    h.input('log-water-found', value); await h.submit(); assert.equal(h.session.tripDays.length, 0);
    assert.equal(h.controller.getDrafts().log.supplies.water, value);
  }
  h.input('log-water-found', '1.001'); await h.submit(); assert.equal(h.session.tripDays[0].supplies.water, 1.001);
});

test('guests only read supply summaries and cannot save or trigger stale add/remove controls', async t => {
  const h = harness(t, { entries: [day(0, { supplies: supplies({ foods: [{ id: 'food', name: '<img onerror=alert(1)>', amount: 2 }], water: 3 }) })] });
  await h.controller.openDay('day-0'); const remove = h.$('log-food-list').querySelector('button');
  h.setEditable(false);
  assert.equal(h.$('log-supplies').querySelector('.supply-edit').hidden, true); assert.equal(h.$('log-supplies-read').hidden, false);
  assert.equal(h.$('log-supplies-read').querySelector('img'), null); assert.match(h.$('log-supplies-read').textContent, /<img onerror/);
  assert.equal(h.$('log-water-found').disabled, true);
  remove.click(); await h.click('log-food-add'); await h.submit();
  assert.equal(h.history.length, 0); assert.equal(h.$('log-food-list').children.length, 1);
});

test('auth loss and rejected saves preserve raw supply drafts and block navigation', async t => {
  const h = harness(t, { entries: [day(0)], ask: async () => false }); await h.controller.openDay('day-0');
  h.input('log-water-found', '2'); h.allowMutation(false); await h.submit();
  assert.match(h.$('log-error').textContent, /could not be saved/); assert.equal(h.controller.hasDraft(), true);
  h.setEditable(false); await h.click('log-close');
  assert.equal(h.$('log-dialog').open, true); assert.equal(h.controller.getDrafts().log.supplies.water, '2');
  h.session.tripDays[0].note = 'Remote'; h.controller.refresh(); assert.equal(h.$('log-water-found').value, '2');
  h.setEditable(true); h.allowMutation(true); await h.submit(); assert.equal(h.session.tripDays[0].supplies.water, 2);
});

test('renumbering or removing a harvest day cannot invalidate later consumption', async t => {
  const h = harness(t, { entries: [day(0, { supplies: supplies({ foods: [{ id: 'food', name: 'Fruit', amount: 3 }] }) }), day(1, { supplies: supplies({ foodConsumed: 2 }) })] });
  await h.controller.openDay('day-0'); h.input('log-day', '2'); await h.submit();
  assert.match(h.$('log-error').textContent, /Day 1 needs 2 lbs/); assert.equal(h.session.tripDays[0].day, 0);
  await h.click('log-delete'); assert.equal(h.session.tripDays.length, 2); assert.match(h.$('log-error').textContent, /Day 1 needs/);
  h.controller.openTrip(null, 'day-0'); await h.click('trip-delete');
  assert.equal(h.session.tripDays.length, 2); assert.match(h.$('trip-error').textContent, /Day 1 needs/);
});

test('mobile day opening protects supply drafts and clean remote supply changes update', async t => {
  let discard = false;
  const h = harness(t, { mobile: true, entries: [day(0), day(1)], ask: async () => discard });
  await h.controller.openDay('day-0'); assert.equal(h.$('log-dialog').dataset.logView, 'detail');
  h.input('log-water-found', '2'); assert.equal(await h.controller.openDay('day-1'), false); assert.equal(h.$('log-day').value, '0');
  discard = true; await h.controller.openDay('day-1'); assert.equal(h.$('log-water-found').value, '0');
  h.session.tripDays[1].supplies = supplies({ water: 4 }); h.controller.refresh(); assert.equal(h.$('log-water-found').value, '4');
  h.controller.reset(); assert.equal(h.$('log-water-found').value, '0');
});

test('supply labels, expiry boundary, and validation explain the system in Chinese', async t => {
  const h = harness(t, { locale: 'zh-CN' }); await h.controller.openDay();
  assert.equal(h.$('log-supplies-heading').textContent, '食物与饮水');
  assert.match(h.$('log-supplies').textContent, /第 0 天收集，第 7 天开始过期/);
  h.input('log-water-consumed', '1'); await h.submit(); assert.match(h.$('log-error').textContent, /可用淡水只有 0 加仑/);
});
