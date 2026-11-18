'use strict';
const { sourcePath } = require('./source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../../src/shared/core.js');
const S = require('../../src/shared/supplies-core.js');
const root = path.resolve(__dirname, '../..');
const manifest = require('../../examples/demo-map/map.json');
const config = { id: manifest.id, name: manifest.name, grid: manifest.grid, fogHexes: manifest.fog.cells };
const attachment = n => ({ id: `image-${n}`, name: `photo-${n}.jpg`, url: `https://example.public.blob.vercel-storage.com/photo-${n}.jpg`, pathname: `photo-${n}.jpg`, type: 'image/jpeg', size: 1000, width: 400, height: 300 });
class FixtureEvent {
  constructor(type, options = {}) { this.type = type; this.cancelable = Boolean(options.cancelable); this.defaultPrevented = false; }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
}
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.handlers = {}; this.pendingEvents = []; this.attributes = {}; this.dataset = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.open = false; this.disabled = false; this.classList = { add() {}, remove() {}, toggle() {} }; }
  append(...elements) { for (const element of elements) this.children.push(...(element.tagName === '#fragment' ? element.children : [element])); }
  replaceChildren(...elements) { this.children = []; this.append(...elements); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, listener) { (this.handlers[type] ||= []).push(listener); }
  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.handlers[event.type] || []) {
      const result = listener(event);
      if (result?.then) this.pendingEvents.push(result);
    }
    return !event.defaultPrevented;
  }
  async emit(type, changes = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...changes };
    for (const fn of this.handlers[type] || []) await fn(event);
    while (this.pendingEvents.length) await Promise.all(this.pendingEvents.splice(0));
  }
  click() { return this.emit('click'); }
  focus() {} scrollIntoView() {} setCustomValidity() {}
  close() { this.open = false; this.dispatchEvent(new FixtureEvent('close')); }
  querySelectorAll(tag) { return this.children.flatMap(child => [ ...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
}
function harness({ editable = true, upload, omitAccessCheck = false, createSnapshot = () => null, ask = async () => true, deferredSession = false } = {}) {
  const nodes = new Map();
  for (const id of fs.readFileSync(sourcePath('index.html'), 'utf8').matchAll(/id="([^"]+)"/g)) { const element = new Element(); element.id = id[1]; nodes.set(id[1], element); }
  const find = (element, id) => element.id === id ? element : element.children.map(child => find(child, id)).find(Boolean);
  const $ = id => { const element = nodes.get(id) || [...nodes.values()].map(node => find(node, id)).find(Boolean); assert.ok(element, `Missing real UI element ${id}`); return element; };
  $('log-editor').hidden = true;
  const session = C.freshSession(config);
  session.tripDays = [{ id: 'day-0', day: 0, note: 'Existing notes', hex: null, attachments: [attachment(1)] }];
  let uploadCalls = 0, controller, sessionAvailable = !deferredSession;
  const toasts = [];
  const context = vm.createContext({ Event: FixtureEvent, window: {
    MapJourneyI18n: { t: (value, data = {}) => value.replace(/\{(\w+)\}/g, (match, key) => String(data[key] ?? match)), number: String, text: value => value },
    matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {},
    MapJourneySuppliesCore: S,
    CampaignImages: { upload: async (file, options) => { uploadCalls++; return upload ? upload(file, options) : attachment(2); } }
  }, document: { getElementById: $, querySelectorAll: selector => selector === 'dialog' ? [...nodes].filter(([id]) => id.endsWith('-dialog')).map(([, element]) => element) : [],
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element('#fragment') } });
  vm.runInContext(fs.readFileSync(sourcePath('dialog-dismiss.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(sourcePath('participant-tags.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(sourcePath('supply-fields.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(sourcePath('game-log.js'), 'utf8'), context);
  controller = context.window.MapJourneyGameLog.create({ core: C, grid: config.grid, ...(omitAccessCheck ? {} : { canEdit: () => editable }), getSession: () => sessionAvailable ? session : undefined,
    ask, toast: message => toasts.push(message), openDialog: id => { $(id).open = true; }, createSnapshot,
    mutate: action => { if (!editable) return false; action(); controller.refresh(); return true; }, placeOnMap() {} });
  return { $, session, controller, toasts, provideSession: () => { sessionAvailable = true; }, setEditable: value => { editable = value; controller.updateAccess(); }, calls: () => uploadCalls };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function add(h, context = 'log', files = [{}]) { h.$(`${context}-image-file`).files = files; await h.$(`${context}-image-file`).emit('change'); await settle(); }

module.exports = { C, Element, harness, attachment, settle, add };
