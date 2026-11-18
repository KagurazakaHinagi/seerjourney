'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, fingerprint } = require('../../src/client/campaign-client.js');
const C = require('../../src/shared/core.js');
const original = C.freshSession({ id: 'demo-map', name: 'Demo expedition' });
function fixture() {
  let snapshot = { revision: 0, session: structuredClone(original), updatedAt: original.updatedAt };
  let editable = true, failNetwork = false, forceStatus = 0, onPut = null, draft = false;
  const requests = [], events = [], timers = new Map(); let id = 0;
  const client = create({
    async fetch(path, options) {
      if (failNetwork) throw new Error('Network unavailable');
      const method = options.method || 'GET'; requests.push({ path, method, options });
      if (path === '/api/auth') {
        if (method === 'DELETE') editable = false;
        if (method === 'POST') editable = true;
        return { ok: true, json: async () => ({ editable }) };
      }
      if (method === 'GET') return { ok: true, json: async () => structuredClone(snapshot) };
      const input = JSON.parse(options.body);
      if (onPut) await onPut();
      if (forceStatus) return { ok: false, status: forceStatus, json: async () => ({ error: 'unauthorized', message: 'Sign in to edit this campaign.' }) };
      if (input.revision !== snapshot.revision) return { ok: false, status: 409, json: async () => ({ error: 'conflict', campaign: structuredClone(snapshot) }) };
      snapshot = { revision: snapshot.revision + 1, session: input.session, updatedAt: new Date().toISOString() };
      return { ok: true, json: async () => structuredClone(snapshot) };
    },
    hasDraft: () => draft,
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(id) { timers.delete(id); }
  });
  client.subscribe(event => events.push(event));
  return { client, requests, events,
    setEditable(v) { editable = v; }, setNetwork(v) { failNetwork = !v; }, setStatus(v) { forceStatus = v; },
    setDraft(v) { draft = v; }, setPut(fn) { onPut = fn; },
    advance(note = 'Remote update') { snapshot.revision++; snapshot.session = { ...snapshot.session, name: note }; },
    replaceSnapshot(value) { snapshot = structuredClone(value); },
    snapshot: () => snapshot };
}
test('guest can read and poll campaign but never queues a write', async () => {
  const f = fixture(); f.setEditable(false); const initial = await f.client.start();
  assert.equal(initial.mapId, 'demo-map'); assert.equal(f.client.canEdit(), false);
  assert.equal(f.client.save({ ...initial, name: 'Unauthorized' }), false);
  await f.client.flush(); f.advance(); await f.client.refresh();
  assert.equal(f.events.filter(e => e.type === 'session').at(-1).session.name, 'Remote update');
  assert.equal(f.requests.filter(r => r.method === 'PUT').length, 0);
});
test('camera, journey visibility and update timestamps are local preferences', async () => {
  const f = fixture(); const initial = await f.client.start();
  f.client.save({ ...initial, view: { x: 20, y: 30, scale: 2 }, showJourney: false, updatedAt: 'different' });
  await f.client.flush(); assert.equal(f.requests.filter(r => r.method === 'PUT').length, 0);
  f.client.save({ ...initial, name: 'Changed', view: { x: 4, y: 4, scale: 4 }, showJourney: false });
  await f.client.flush();
  const sent = JSON.parse(f.requests.find(r => r.method === 'PUT').options.body);
  assert.equal(sent.session.view, null); assert.equal(sent.session.showJourney, true);
});
test('serialized autosaves retain edits made while a request is in flight', async () => {
  const f = fixture(); const initial = await f.client.start(); let release;
  f.setPut(() => new Promise(resolve => { release = resolve; }));
  f.client.save({ ...initial, name: 'First' }); const request = f.client.flush();
  f.client.save({ ...initial, name: 'Second' });
  release(); await request; f.setPut(null); await f.client.flush();
  assert.equal(f.snapshot().revision, 2); assert.equal(f.snapshot().session.name, 'Second');
  assert.deepEqual(f.requests.filter(r => r.method === 'PUT').map(r => JSON.parse(r.options.body).revision), [0, 1]);
  assert.equal(f.client.hasPending(), false);
});
test('stale revision preserves local work until explicit latest reload', async () => {
  const f = fixture(); const initial = await f.client.start();
  f.client.save({ ...initial, name: 'Local draft' }); f.advance('Other editor'); await f.client.flush();
  assert.equal(f.client.status().conflict, true); assert.equal(f.client.canEdit(), false);
  assert.equal(f.client.getPending().name, 'Local draft'); assert.equal(f.snapshot().session.name, 'Other editor');
  await f.client.loadLatest();
  assert.equal(f.client.getPending(), null); assert.equal(f.client.canEdit(), true);
  assert.equal(f.events.filter(e => e.type === 'session').at(-1).session.name, 'Other editor');
});
test('a remote change cannot erase an unsaved dialog draft', async () => {
  const f = fixture(); await f.client.start(); f.setDraft(true); f.advance(); await f.client.refresh();
  assert.equal(f.client.status().conflict, true); assert.equal(f.events.filter(e => e.type === 'session').length, 0);
  assert.equal(f.client.getSnapshot().revision, 0);
});
test('expired authentication retains queued changes and blocks further mutations', async () => {
  const f = fixture(); const initial = await f.client.start();
  f.client.save({ ...initial, name: 'Unsent' }); f.setStatus(401); await f.client.flush();
  assert.equal(f.client.canEdit(), false); assert.equal(f.client.status().mode, 'expired');
  assert.equal(f.client.getPending().name, 'Unsent');
  assert.equal(f.client.save({ ...initial, name: 'Blocked' }), false);
});
test('network failure pauses editing and reconnect retries unchanged revision safely', async () => {
  const f = fixture(); const initial = await f.client.start(); f.client.save({ ...initial, name: 'Queued' });
  f.setNetwork(false); await f.client.flush(); assert.equal(f.client.status().mode, 'offline'); assert.equal(f.client.canEdit(), false);
  f.setNetwork(true); await f.client.refresh();
  assert.equal(f.snapshot().session.name, 'Queued'); assert.equal(f.client.hasPending(), false);
});
test('logout refuses to discard pending changes or open editor drafts', async () => {
  const f = fixture(); const initial = await f.client.start(); f.setDraft(true);
  await assert.rejects(f.client.logout(), /Save or download/); f.setDraft(false);
  f.client.save({ ...initial, name: 'Pending' }); await assert.rejects(f.client.logout(), /Save or download/);
  await f.client.flush(); await f.client.logout(); assert.equal(f.client.canEdit(), false);
});

test('out-of-order polling never replaces a newer campaign with an older revision', async () => {
  const f = fixture(); await f.client.start(); const older = structuredClone(f.snapshot());
  f.advance('Newer'); await f.client.refresh(); f.replaceSnapshot(older); await f.client.refresh();
  assert.equal(f.client.getSnapshot().revision, 1);
  assert.equal(f.events.filter(e => e.type === 'session').at(-1).session.name, 'Newer');
});
