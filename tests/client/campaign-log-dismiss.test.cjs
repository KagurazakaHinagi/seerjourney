'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, attachment, settle, add } = require('../helpers/campaign-game-log.cjs');

function openTrip(options) {
  const h = harness(options);
  h.controller.openTrip(null, 'day-0');
  h.$('trip-dialog').getBoundingClientRect = () => ({ left: 100, right: 540, top: 100, bottom: 700 });
  return h;
}
const outside = { clientX: 50, clientY: 200, pointerId: 1, button: 0, isPrimary: true };
const inside = { ...outside, clientX: 120 };
async function backdropClick(h) {
  await h.$('trip-dialog').emit('pointerdown', outside);
  await h.$('trip-dialog').emit('pointerup', outside);
  await h.$('trip-dialog').emit('click', outside);
}

test('background map clicks close clean daily logs for guests and editors without changing campaign data', async () => {
  for (const editable of [false, true]) {
    let prompts = 0;
    const h = openTrip({ editable, ask: async () => { prompts++; return true; } });
    const saved = JSON.stringify(h.session);
    await backdropClick(h);
    assert.equal(h.$('trip-dialog').open, false);
    assert.equal(prompts, 0);
    assert.equal(JSON.stringify(h.session), saved);
  }
});

test('dialog padding, fields, outward drags and cancelled gestures do not dismiss a daily log', async () => {
  const h = openTrip(), dialog = h.$('trip-dialog');
  await dialog.emit('pointerdown', inside); await dialog.emit('pointerup', inside); await dialog.emit('click', inside);
  assert.equal(dialog.open, true, 'padding inside the dialog is not the backdrop');
  await dialog.emit('pointerdown', { ...inside, target: h.$('trip-note') });
  await dialog.emit('pointerup', { ...inside, target: h.$('trip-note') });
  await dialog.emit('click', { ...inside, target: h.$('trip-note') });
  assert.equal(dialog.open, true);
  await dialog.emit('pointerdown', { ...inside, target: h.$('trip-note') });
  await dialog.emit('pointerup', outside);
  await dialog.emit('click', outside);
  assert.equal(dialog.open, true, 'a drag beginning in a field must not dismiss');
  await dialog.emit('pointerdown', outside); await dialog.emit('pointerup', inside); await dialog.emit('click', inside);
  assert.equal(dialog.open, true, 'a gesture ending in the dialog must not dismiss');
  await dialog.emit('pointerdown', outside); await dialog.emit('pointercancel', outside); await dialog.emit('pointerup', outside); await dialog.emit('click', outside);
  assert.equal(dialog.open, true);
  await dialog.emit('pointerdown', { ...outside, button: 2 }); await dialog.emit('pointerup', outside); await dialog.emit('click', outside);
  assert.equal(dialog.open, true, 'secondary-button interactions do not dismiss');
  await dialog.emit('pointerdown', outside); await dialog.emit('pointerup', { ...outside, pointerId: 2 }); await dialog.emit('click', outside);
  assert.equal(dialog.open, true, 'another pointer cannot complete the dismissal');
});

test('WebKit compatibility mouse clicks can complete a touch dismissal with a different pointer ID', async () => {
  const h = openTrip(), dialog = h.$('trip-dialog');
  const touch = { ...outside, pointerId: 0, pointerType: 'touch' };
  await dialog.emit('pointerdown', touch); await dialog.emit('pointerup', touch);
  await dialog.emit('click', { ...outside, pointerType: 'mouse' });
  assert.equal(dialog.open, false);
});

test('background dismissal uses the existing unsaved-day confirmation and keeps a declined draft', async () => {
  let discard = false, prompts = 0;
  const h = openTrip({ ask: async title => { assert.equal(title, 'Discard unsaved day changes?'); prompts++; return discard; } });
  h.$('trip-note').value = 'Unsaved discoveries';
  await backdropClick(h);
  assert.equal(h.$('trip-dialog').open, true);
  assert.equal(h.$('trip-note').value, 'Unsaved discoveries');
  assert.equal(h.session.tripDays[0].note, 'Existing notes');
  discard = true;
  await backdropClick(h);
  assert.equal(h.$('trip-dialog').open, false);
  assert.equal(prompts, 2);
  assert.equal(h.session.tripDays[0].note, 'Existing notes');
});

test('background dismissal cannot interrupt an image upload or silently discard its result', async () => {
  let finish, prompts = 0;
  const h = openTrip({ upload: () => new Promise(resolve => { finish = resolve; }), ask: async () => { prompts++; return false; } });
  await add(h, 'trip');
  await backdropClick(h);
  assert.equal(h.$('trip-dialog').open, true);
  assert.equal(prompts, 0);
  assert.match(h.toasts.at(-1), /Wait for the image upload/);
  finish(attachment(2)); await settle();
  await backdropClick(h);
  assert.equal(h.$('trip-dialog').open, true);
  assert.equal(prompts, 1);
  assert.equal(h.controller.getDrafts().trip.attachments.length, 2);
  assert.equal(h.session.tripDays[0].attachments.length, 1);
});
