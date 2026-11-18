'use strict';
const { sourcePath } = require('../helpers/source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../..');
const outside = { clientX: 40, clientY: 200, pointerId: 1, button: 0, isPrimary: true };
const inside = { ...outside, clientX: 200 };

function harness(t) {
  const dom = new JSDOM(fs.readFileSync(sourcePath('index.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://campaign.test/' });
  t.after(() => dom.window.close());
  const w = dom.window, $ = id => w.document.getElementById(id);
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  for (const dialog of w.document.querySelectorAll('dialog')) dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 540, bottom: 700 });
  w.eval(fs.readFileSync(sourcePath('dialog-dismiss.js'), 'utf8'));
  function emit(target, type, data = outside) {
    const event = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: data.clientX, clientY: data.clientY, button: data.button });
    Object.defineProperties(event, { pointerId: { value: data.pointerId }, isPrimary: { value: data.isPrimary }, pointerType: { value: data.pointerType || 'mouse' } });
    target.dispatchEvent(event);
  }
  const tap = (dialog, data = outside) => { emit(dialog, 'pointerdown', data); emit(dialog, 'pointerup', data); emit(dialog, 'click', data); };
  return { w, $, emit, tap };
}

test('every current dialog routes an outside tap through a cancelable close request', t => {
  const { w, tap } = harness(t), dialogs = [...w.document.querySelectorAll('dialog')];
  assert.equal(dialogs.length, 9);
  for (const dialog of dialogs) {
    let requests = 0;
    dialog.open = true;
    dialog.addEventListener('cancel', event => { requests++; assert.equal(event.cancelable, true); event.preventDefault(); });
    tap(dialog);
    assert.equal(requests, 1, dialog.id);
    assert.equal(dialog.open, true, `${dialog.id} must allow its draft/upload guard to intercept dismissal`);
  }
});

test('read-only utility dialogs close on an outside tap and registration is idempotent', t => {
  const { w, $, tap } = harness(t);
  for (const id of ['options-dialog', 'help-dialog', 'install-dialog']) {
    const dialog = $(id); let closes = 0;
    dialog.addEventListener('close', () => closes++);
    w.MapJourneyDialogDismiss.attach(dialog); w.MapJourneyDialogDismiss.attach(dialog);
    dialog.open = true; tap(dialog);
    assert.equal(dialog.open, false); assert.equal(closes, 1, 'repeated attachment cannot duplicate a close request');
    tap(dialog); assert.equal(closes, 1, 'closed dialogs cannot respond to stale backdrop input');
  }
});

test('dialog padding, content clicks, outward drags and interrupted pointers never dismiss', t => {
  const { $, emit } = harness(t), dialog = $('options-dialog');
  dialog.open = true;
  let requests = 0; dialog.addEventListener('cancel', () => requests++);
  const gesture = (start, end, downTarget = dialog, extras = () => {}) => {
    emit(downTarget, 'pointerdown', start); extras(); emit(dialog, 'pointerup', end); emit(dialog, 'click', end);
    assert.equal(dialog.open, true); assert.equal(requests, 0);
  };
  gesture(inside, inside);
  gesture(inside, outside, $('options-heading'));
  gesture(outside, inside);
  gesture({ ...outside, button: 2 }, outside);
  gesture({ ...outside, isPrimary: false }, outside);
  gesture(outside, { ...outside, pointerId: 2 });
  gesture(outside, outside, dialog, () => emit(dialog, 'pointercancel'));
  gesture(outside, outside, dialog, () => { dialog.close(); dialog.open = true; });
});

test('WebKit touch-to-mouse compatibility clicks dismiss only after matching touch endpoints', t => {
  const { $, emit } = harness(t), dialog = $('install-dialog');
  dialog.open = true;
  const touch = { ...outside, pointerType: 'touch', pointerId: 0 };
  emit(dialog, 'pointerdown', touch); emit(dialog, 'pointerup', touch);
  emit(dialog, 'click', { ...outside, pointerType: 'mouse', pointerId: 1 });
  assert.equal(dialog.open, false);
});

test('outside confirmation cancellation resolves the decision without closing the underlying editor', async t => {
  const { $, tap } = harness(t), editor = $('marker-dialog'), confirm = $('confirm-dialog');
  editor.open = true; confirm.open = true;
  let editorRequests = 0; editor.addEventListener('cancel', () => editorRequests++);
  const answer = new Promise(resolve => confirm.addEventListener('cancel', event => { event.preventDefault(); confirm.close(); resolve(false); }, { once: true }));
  tap(confirm);
  assert.equal(await answer, false);
  assert.equal(confirm.open, false);
  assert.equal(editor.open, true);
  assert.equal(editorRequests, 0, 'a backdrop tap belongs only to the topmost receiving dialog');
});

test('a popover cancellation can consume the close request before the parent dialog closes', t => {
  const { $, tap } = harness(t), dialog = $('marker-dialog');
  let pickerOpen = true, parentRequests = 0;
  dialog.open = true;
  dialog.addEventListener('cancel', event => { if (pickerOpen) { event.preventDefault(); pickerOpen = false; } });
  dialog.addEventListener('cancel', event => { if (!event.defaultPrevented) parentRequests++; });
  tap(dialog);
  assert.equal(dialog.open, true); assert.equal(pickerOpen, false); assert.equal(parentRequests, 0);
  tap(dialog);
  assert.equal(dialog.open, false); assert.equal(parentRequests, 1);
});
