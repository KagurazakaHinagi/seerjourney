'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Images = require('../../src/client/features/game-log/image-attachments.js');
const C = require('../../src/shared/core.js');
const manifest = require('../../examples/demo-map/map.json');
const map = { ...manifest, fogHexes: manifest.fog.cells };
const file = (size, type = 'image/png') => new File([new Uint8Array(size)], '远征照片.png', { type });
const decode = async () => ({ image: {}, width: 5000, height: 4000, close() {} });
const attachment = (changes = {}) => ({ id: 'da6810e0-f2a6-4ac2-a5d0-bf3bc94ca828', pathname: 'campaigns/demo-map/da6810e0-f2a6-4ac2-a5d0-bf3bc94ca828.png',
  url: 'https://example.public.blob.vercel-storage.com/campaigns/demo-map/da6810e0-f2a6-4ac2-a5d0-bf3bc94ca828.png', name: '营地.png', type: 'image/png', size: 400, width: 20, height: 20, ...changes });
const session = images => ({ ...C.freshSession(map), tripDays: [{ id: 'day-one', day: 0, hex: null, note: '营地', attachments: images }] });

test('images at or below 8 MiB keep their original bytes and format', async () => {
  const original = file(Images.MAX_BYTES);
  let encodes = 0;
  const prepared = await Images.prepare(original, { decode, encode: async () => { encodes++; } });
  assert.equal(prepared.file, original); assert.equal(prepared.compressed, false); assert.equal(encodes, 0);
});
test('oversized images are compressed and resized before any upload', async () => {
  const events = [], sizes = [];
  const result = await Images.upload(file(Images.MAX_BYTES + 1), {
    decode, encode: async (_, w, h, type) => { events.push('encode'); sizes.push([w, h]); return new Blob([new Uint8Array(1200)], { type }); },
    fetch: async (_, options) => {
      events.push('request');
      if (options.method === 'GET') return new Response(JSON.stringify({ mode: 'blob', campaignId: 'demo-map' }));
      const body = JSON.parse(options.body); assert.equal(body.op, 'confirm');
      return new Response(JSON.stringify({ ...body, size: 1200, url: 'https://example.public.blob.vercel-storage.com/' + body.pathname }));
    },
    uploadBlob: async (pathname, image, options) => {
      events.push('upload'); assert.ok(image.size <= Images.MAX_BYTES); assert.equal(image.type, 'image/webp'); assert.equal(options.multipart, false);
      assert.match(pathname, /^campaigns\/demo-map\/[a-f0-9-]+\.webp$/);
    }
  });
  assert.ok(events.indexOf('encode') < events.indexOf('request'));
  assert.ok(events.indexOf('encode') < events.indexOf('upload'));
  assert.deepEqual(sizes[0], [4096, 3277]); assert.equal(result.size, 1200);
});
test('compression retries quality and dimensions until the stored size fits', async () => {
  const attempts = [];
  const prepared = await Images.prepare(file(Images.MAX_BYTES + 1), { decode,
    encode: async (_, width, height, type, quality) => {
      attempts.push({width,height,quality});
      return new Blob([new Uint8Array(attempts.length < 5 ? Images.MAX_BYTES + 1 : 6000)], {type});
    }
  });
  assert.equal(attempts.length, 5); assert.ok(attempts[3].width < attempts[0].width); assert.equal(prepared.file.size, 6000);
});
test('unsupported WebP canvas encoding falls back to JPEG', async () => {
  const types = [];
  const result = await Images.prepare(file(Images.MAX_BYTES + 1), { decode,
    encode: async (_, w, h, type) => { types.push(type); return new Blob([new Uint8Array(1000)], {type: type === 'image/webp' ? 'image/png' : type}); }
  });
  assert.deepEqual(types, ['image/webp', 'image/jpeg']); assert.equal(result.file.type, 'image/jpeg');
});
test('invalid formats, unprocessable dimensions and failed compression never upload', async () => {
  let uploaded = false, closed = false;
  await assert.rejects(Images.prepare(file(20, 'image/svg+xml')), /JPEG/);
  await assert.rejects(Images.upload(file(Images.MAX_BYTES + 1), {
    decode: async () => ({image:{},width:40000,height:10,close(){closed=true;}}), uploadBlob: async () => { uploaded=true; }
  }), /too large/);
  assert.equal(uploaded, false); assert.equal(closed, true);
});
test('attachment metadata survives saves and invalid storage locations are rejected', () => {
  const result=C.validateSession(session([attachment()]),map);
  assert.deepEqual(result.tripDays[0].attachments,[attachment()]);
  for (const changes of [{url:'javascript:alert(1)'},{url:'https://unrelated.example/image.png'},{size:Images.MAX_BYTES+1},{type:'image/svg+xml'},{pathname:'../../secret'},{width:0}]) {
    assert.throws(()=>C.validateSession(session([attachment(changes)]),map));
  }
  assert.throws(()=>C.validateSession(session([attachment(),attachment()]),map),/duplicate/);
  assert.throws(()=>C.validateSession(session(Array(13).fill(attachment())),map),/12/);
});
test('stalled image requests time out and abort instead of trapping an editor', async () => {
  let signal;
  await assert.rejects(Images.withDeadline(value => { signal=value; return new Promise(()=>{}); }, 5, 'Upload timed out'), /timed out/);
  assert.equal(signal.aborted,true);
});
