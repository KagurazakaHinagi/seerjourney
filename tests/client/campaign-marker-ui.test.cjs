'use strict';
const { sourcePath } = require('../helpers/source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../..');

function harness(t, { popover = false } = {}) {
  const dom = new JSDOM(fs.readFileSync(sourcePath('index.html'), 'utf8'), { url: 'https://campaign.test/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, $ = id => w.document.getElementById(id);
  $('marker-dialog').open = true;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  if (popover) {
    // Model the native auto-popover lifecycle; jsdom does not implement it.
    const opened = new Set(), matches = w.Element.prototype.matches;
    w.Element.prototype.matches = function (selector) { return selector === ':popover-open' ? opened.has(this) : matches.call(this, selector); };
    w.HTMLElement.prototype.hidePopover = function () { opened.delete(this); this.dispatchEvent(new w.Event('toggle')); };
    w.HTMLElement.prototype.showPopover = function () {
      for (const other of opened) if (other !== this) other.hidePopover();
      opened.add(this); this.dispatchEvent(new w.Event('toggle'));
    };
  }
  w.eval(fs.readFileSync(sourcePath('marker-ui.js'), 'utf8'));
  const pickers = Object.fromEntries(['kind', 'color'].map(type => [type, w.MapJourneyMarkerUI.createPicker($(`marker-${type}`), type)]));
  const key = (type, value) => {
    const event = new w.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
    $(`marker-${type}-picker`).dispatchEvent(event); return event;
  };
  const pointer = element => { element.dispatchEvent(new w.Event('pointerdown', { bubbles: true, cancelable: true })); element.click(); };
  return { w, $, pickers, key, pointer };
}

test('bookmark choices expose Iconoir artwork and matching color swatches with labelled listboxes', t => {
  const { $ } = harness(t);
  for (const type of ['kind', 'color']) {
    const select = $(`marker-${type}`), button = $(`marker-${type}-picker`), menu = $(`marker-${type}-options`);
    assert.equal(select.hidden, true);
    assert.equal(button.getAttribute('role'), 'combobox');
    assert.equal(button.getAttribute('aria-controls'), menu.id);
    assert.equal(menu.getAttribute('role'), 'listbox');
    assert.equal(button.getAttribute('aria-labelledby'), `marker-${type}-label`);
    assert.equal($(`marker-${type}-label`).htmlFor, button.id);
    assert.equal(menu.children.length, select.options.length);
    for (const option of select.options) {
      const row = $(`marker-${type}-option-${option.value}`);
      assert.equal(row.getAttribute('role'), 'option');
      assert.equal(row.textContent, option.textContent);
      assert.equal(row.getAttribute('aria-selected'), String(option.selected));
      if (type === 'kind') {
        const icon = row.querySelector('.bookmark-icon');
        assert.equal(icon.getAttribute('viewBox'), '0 0 24 24');
        assert.equal(icon.getAttribute('aria-hidden'), 'true');
        assert.equal(icon.querySelector('use').getAttribute('href'), `assets/iconoir/markers.svg#${option.value}`);
      } else {
        const colors = { gold: 'rgb(231, 189, 106)', green: 'rgb(136, 199, 160)', red: 'rgb(239, 142, 123)', blue: 'rgb(142, 196, 230)', purple: 'rgb(194, 167, 229)', grey: 'rgb(183, 191, 188)' };
        assert.equal(row.querySelector('.marker-swatch').style.backgroundColor, colors[option.value]);
        assert.equal(row.querySelector('.marker-swatch').getAttribute('aria-hidden'), 'true');
      }
    }
  }
});

test('pointer choice updates the backing select, bubbles one change and returns focus to the picker', t => {
  const { w, $, pointer } = harness(t);
  for (const [type, value, name] of [['kind', 'ruin', 'Ruin'], ['color', 'blue', 'River'], ['kind', 'tomb', 'Tomb'], ['color', 'grey', 'Grey']]) {
    const select = $(`marker-${type}`), button = $(`marker-${type}-picker`), menu = $(`marker-${type}-options`);
    let changes = 0, bubbled = 0;
    select.addEventListener('change', () => changes++);
    select.parentElement.addEventListener('change', () => bubbled++);
    pointer(button);
    assert.equal(button.getAttribute('aria-expanded'), 'true'); assert.equal(menu.hidden, false);
    pointer($(`marker-${type}-option-${value}`));
    assert.equal(select.value, value); assert.equal(changes, 1); assert.equal(bubbled, 1);
    assert.equal(button.querySelector('.marker-picker-label').textContent, name);
    assert.equal($(`marker-${type}-option-${value}`).getAttribute('aria-selected'), 'true');
    assert.equal(button.getAttribute('aria-expanded'), 'false'); assert.equal(menu.hidden, true);
    assert.equal(w.document.activeElement, button);
  }
});

test('keyboard navigation previews choices and Enter or Space commits the active item', t => {
  const { $, key } = harness(t), select = $('marker-kind'), button = $('marker-kind-picker');
  assert.equal(key('kind', 'ArrowDown').defaultPrevented, true);
  assert.equal(button.getAttribute('aria-activedescendant'), 'marker-kind-option-place');
  key('kind', 'ArrowDown');
  assert.equal(button.getAttribute('aria-activedescendant'), 'marker-kind-option-camp');
  assert.equal(select.value, 'place', 'navigation must not commit a choice');
  key('kind', 'Enter'); assert.equal(select.value, 'camp');
  key('kind', 'End'); assert.equal(button.getAttribute('aria-activedescendant'), 'marker-kind-option-treasure');
  key('kind', 'ArrowDown'); assert.equal(button.getAttribute('aria-activedescendant'), 'marker-kind-option-place');
  key('kind', 'ArrowUp'); assert.equal(button.getAttribute('aria-activedescendant'), 'marker-kind-option-treasure');
  key('kind', 'Home'); assert.equal(button.getAttribute('aria-activedescendant'), 'marker-kind-option-place');
  key('kind', 'ArrowDown'); key('kind', 'ArrowDown'); key('kind', ' ');
  assert.equal(select.value, 'danger'); assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('Escape dismisses only the picker; Tab closes without trapping keyboard navigation', t => {
  const { $, key } = harness(t), button = $('marker-color-picker');
  let propagatedEscape = 0;
  $('marker-dialog').addEventListener('keydown', event => { if (event.key === 'Escape') propagatedEscape++; });
  key('color', 'End');
  assert.equal(key('color', 'Escape').defaultPrevented, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.hasAttribute('aria-activedescendant'), false);
  assert.equal($('marker-color').value, 'gold'); assert.equal(propagatedEscape, 0);
  key('color', 'ArrowDown');
  assert.equal(key('color', 'Tab').defaultPrevented, false);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('loaded marker values and guest access refresh the displayed choice and prevent edits', t => {
  const { $, pickers, pointer } = harness(t);
  for (const [type, value] of [['kind', 'tomb'], ['color', 'grey']]) {
    const select = $(`marker-${type}`), button = $(`marker-${type}-picker`);
    select.value = value; pickers[type].refresh();
    assert.equal(button.querySelector('.marker-picker-label').textContent, select.selectedOptions[0].textContent);
    assert.equal($(`marker-${type}-option-${value}`).getAttribute('aria-selected'), 'true');
    pointer(button); assert.equal(button.getAttribute('aria-activedescendant'), `marker-${type}-option-${value}`);
    select.disabled = true; pickers[type].refresh();
    assert.equal(button.disabled, true); assert.equal(button.getAttribute('aria-expanded'), 'false');
    pointer(button); $(`marker-${type}-options`).firstElementChild.click();
    assert.equal(button.getAttribute('aria-expanded'), 'false'); assert.equal(select.value, value);
    select.disabled = false; pickers[type].refresh(); pointer(button);
    assert.equal(button.disabled, false); assert.equal(button.getAttribute('aria-expanded'), 'true');
    pickers[type].close();
  }
});

for (const popover of [false, true]) test(`outside clicks and dialog dismissal close picker menus (${popover ? 'native popover lifecycle' : 'fallback'})`, t => {
  const { w, $, pointer } = harness(t, { popover });
  pointer($('marker-kind-picker')); pointer($('marker-color-picker'));
  assert.equal($('marker-kind-picker').getAttribute('aria-expanded'), 'false');
  assert.equal($('marker-color-picker').getAttribute('aria-expanded'), 'true');
  pointer($('marker-title'));
  assert.equal($('marker-color-picker').getAttribute('aria-expanded'), 'false');
  pointer($('marker-color-picker'));
  const cancel = new w.Event('cancel', { cancelable: true }); $('marker-dialog').dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true, 'Escape first dismisses the open picker');
  assert.equal($('marker-color-picker').getAttribute('aria-expanded'), 'false');
  pointer($('marker-kind-picker')); $('marker-dialog').dispatchEvent(new w.Event('close'));
  assert.equal($('marker-kind-picker').getAttribute('aria-expanded'), 'false');
});
