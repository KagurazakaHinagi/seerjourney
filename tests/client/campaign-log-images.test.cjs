'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Element, harness, attachment, settle, add } = require('../helpers/campaign-game-log.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const displayedImages = (h, context) => h.$(`${context}-image-list`).querySelectorAll('figcaption').map(caption => caption.textContent);

test('both day galleries sort filenames for guests and editors without editing stored attachments', () => {
  const saved = ['zebra.jpg', 'photo10.jpg', 'Alpha.jpg', 'photo2.jpg', '营地2.jpg', '营地10.jpg']
    .map((name, index) => ({ ...attachment(index + 1), name }));
  const expected = ['营地2.jpg', '营地10.jpg', 'Alpha.jpg', 'photo2.jpg', 'photo10.jpg', 'zebra.jpg'];
  for (const editable of [false, true]) for (const context of ['log', 'trip']) {
    const h = harness({ editable }); h.session.tripDays[0].attachments = plain(saved);
    const before = plain(h.session);
    if (context === 'log') h.controller.open(); else h.controller.openTrip(null, 'day-0');
    assert.deepEqual(displayedImages(h, context), expected);
    assert.equal(h.controller.hasDraft(), false, 'display sorting must not mark the day as edited');
    assert.deepEqual(h.session, before);
  }
});

test('new pictures sort immediately and removing a sorted thumbnail preserves other image identities', async () => {
  for (const context of ['log', 'trip']) {
    const added = { ...attachment(3), name: 'Alpha.jpg' };
    const h = harness({ upload: async () => added });
    const saved = [{ ...attachment(1), name: 'zebra.jpg' }, { ...attachment(2), name: 'middle.jpg' }];
    h.session.tripDays[0].attachments = plain(saved);
    if (context === 'log') h.controller.open(); else h.controller.openTrip(null, 'day-0');
    await add(h, context);
    assert.deepEqual(displayedImages(h, context), ['Alpha.jpg', 'middle.jpg', 'zebra.jpg']);
    assert.deepEqual(h.session.tripDays[0].attachments, saved);
    const figure = h.$(`${context}-image-list`).querySelectorAll('figure')
      .find(item => item.querySelectorAll('figcaption')[0].textContent === 'middle.jpg');
    await figure.querySelectorAll('button')[0].click();
    assert.deepEqual(displayedImages(h, context), ['Alpha.jpg', 'zebra.jpg']);
    await h.$(`${context}-form`).emit('submit');
    assert.deepEqual(plain(h.session.tripDays[0].attachments), [saved[0], added]);
  }
});

test('replacing and closing a day cancels its detached map tile requests', async () => {
  let disposed = 0;
  const h = harness({ createSnapshot: () => {
    const image = new Element('svg'); image.disposeMapTiles = () => { disposed++; }; return image;
  } });
  h.session.tripDays[0].hex = '40,45';
  h.controller.open(); h.controller.refresh();
  assert.equal(disposed, 1);
  await h.$('log-close').click();
  assert.equal(disposed, 2);
  assert.equal(h.$('log-snapshot').children.length, 0);
});

test('editing and renumbering a day preserves its saved image metadata in both editors', async () => {
  const h = harness(); h.controller.open();
  h.$('log-day').value = '2'; h.$('log-note').value = 'Changed notes'; await h.$('log-form').emit('submit');
  assert.equal(h.session.tripDays[0].day, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(h.session.tripDays[0].attachments)), [attachment(1)]);
  h.$('log-dialog').close(); h.controller.openTrip(null, 'day-0');
  h.$('trip-note').value = 'Map stop edit'; await h.$('trip-form').emit('submit');
  assert.deepEqual(JSON.parse(JSON.stringify(h.session.tripDays[0].attachments)), [attachment(1)]);
});

test('uploaded images remain drafts until the editor saves the day', async () => {
  const h = harness(); h.controller.open(); await add(h);
  assert.equal(h.calls(), 1);
  assert.equal(h.session.tripDays[0].attachments.length, 1);
  assert.equal(h.controller.hasDraft(), true);
  assert.equal(h.controller.getDrafts().log.attachments.length, 2);
  await h.$('log-form').emit('submit');
  assert.equal(h.session.tripDays[0].attachments.length, 2);
  assert.equal(h.controller.hasDraft(), false);
});

test('guests see linked previews but cannot add or remove images', async () => {
  const h = harness({ editable: false });
  for (const context of ['log', 'trip']) {
    if (context === 'log') h.controller.open(); else h.controller.openTrip(null, 'day-0');
    await add(h, context);
    assert.equal(h.calls(), 0);
    assert.equal(h.$(`${context}-image-add`).hidden, true);
    assert.equal(h.$(`${context}-image-add`).disabled, true);
    assert.equal(h.$(`${context}-image-file`).disabled, true);
    const gallery = h.$(`${context}-image-list`);
    assert.equal(gallery.querySelectorAll('a').length, 1);
    assert.equal(gallery.querySelectorAll('button').length, 0);
    assert.equal(gallery.querySelectorAll('a')[0].rel, 'noopener noreferrer');
  }
});

test('attachment controls track login and logout and stale remove handlers cannot edit', async () => {
  const h = harness({ editable: false }); h.controller.open(); h.controller.openTrip(null, 'day-0');
  h.setEditable(true);
  const oldRemoveButtons = [];
  for (const context of ['log', 'trip']) {
    assert.equal(h.$(`${context}-image-add`).hidden, false);
    assert.equal(h.$(`${context}-image-file`).disabled, false);
    oldRemoveButtons.push(h.$(`${context}-image-list`).querySelectorAll('button')[0]);
  }
  h.setEditable(false);
  for (const remove of oldRemoveButtons) await remove.click();
  for (const context of ['log', 'trip']) {
    await add(h, context);
    assert.equal(h.$(`${context}-image-add`).hidden, true);
    assert.equal(h.$(`${context}-image-file`).disabled, true);
    assert.equal(h.$(`${context}-image-list`).querySelectorAll('button').length, 0);
    assert.equal(h.controller.getDrafts()[context].attachments.length, 1);
  }
  assert.equal(h.calls(), 0);
});

test('missing access configuration defaults to read-only image attachments', async () => {
  const h = harness({ omitAccessCheck: true }); h.controller.open(); await add(h);
  assert.equal(h.$('log-image-add').hidden, true);
  assert.equal(h.$('log-image-file').disabled, true);
  assert.equal(h.$('log-image-list').querySelectorAll('button').length, 0);
  assert.equal(h.calls(), 0);
});

test('an in-flight upload blocks save and close, and cannot be assigned to a different day', async () => {
  let finish;
  const h = harness({ upload: () => new Promise(resolve => { finish = resolve; }) }); h.controller.open();
  await add(h);
  assert.equal(h.controller.hasDraft(), true);
  await h.$('log-form').emit('submit'); await h.$('log-close').emit('click'); await h.$('log-add').emit('click');
  assert.equal(h.$('log-dialog').open, true); assert.equal(h.$('log-day').value, '0');
  assert.equal(h.session.tripDays.length, 1);
  finish(attachment(2)); await settle();
  assert.equal(h.controller.getDrafts().log.attachments.length, 2);
});

test('auth loss retains completed upload metadata for draft recovery without saving it', async () => {
  let finish;
  const h = harness({ upload: () => new Promise(resolve => { finish = resolve; }) }); h.controller.open(); await add(h);
  h.setEditable(false); finish(attachment(2)); await settle();
  assert.equal(h.controller.getDrafts().log.attachments.length, 2);
  await h.$('log-form').emit('submit');
  assert.equal(h.session.tripDays[0].attachments.length, 1);
  assert.equal(h.controller.hasDraft(), true);
});

test('discarding via a forced campaign reload invalidates late upload completion', async () => {
  let finish;
  const h = harness({ upload: () => new Promise(resolve => { finish = resolve; }) }); h.controller.open(); await add(h);
  h.controller.reset(); h.controller.open();
  finish(attachment(2)); await settle();
  assert.equal(h.controller.getDrafts().log.attachments.length, 1);
  assert.equal(h.controller.hasDraft(), false);
});

test('per-tile uploads are saved with their own day and cap is checked before uploading', async () => {
  const h = harness(); h.controller.openTrip(null, 'day-0'); await add(h, 'trip');
  assert.equal(h.controller.getDrafts().trip.attachments.length, 2);
  await h.$('trip-form').emit('submit');
  assert.equal(h.session.tripDays[0].attachments.length, 2);
  h.controller.open(); await add(h, 'log', Array.from({ length: 11 }, () => ({})));
  assert.equal(h.calls(), 1);
  assert.match(h.$('log-image-error').textContent, /12 images/);
});
