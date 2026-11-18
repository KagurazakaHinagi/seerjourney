'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { namespace: campaignNamespace } = require('./map-config.cjs');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

function createImages({ env, mapId, now, authorize, readJSON, respond, ApiError, sdk = {} }) {
  const fail = (status, code, message) => { throw new ApiError(status, code, message); };
  const bad = message => fail(400, 'invalid_image', message);
  const namespace = campaignNamespace(env, mapId);
  const prefix = `campaigns/${namespace}/`;
  const matcher = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(${UUID})\\.(jpg|png|webp|gif)$`);
  const local = env.CAMPAIGN_STORE === 'file' && !env.VERCEL && env.NODE_ENV !== 'production';
  const imageDirectory = path.join(path.dirname(env.CAMPAIGN_DATA_FILE || path.resolve(__dirname, '../../.data/campaign.json')), 'images');
  function managed(value) {
    if (!/^[a-z0-9_-]{1,80}$/i.test(namespace)) fail(503, 'not_configured', 'Image storage is not configured.');
    const match = typeof value === 'string' && matcher.exec(value);
    if (!match) bad('Choose an image uploaded to this campaign.');
    return { pathname: value, id: match[1], extension: match[2], type: TYPES[match[2]], filename: `${match[1]}.${match[2]}` };
  }
  function meta(input) {
    const target = managed(input.pathname);
    if (input.id !== target.id) bad('The image identifier does not match its stored file.');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 || /[\u0000-\u001f\u007f]/.test(input.name)) bad('Give the image a filename within 200 characters.');
    if (![input.width, input.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 32768) || input.width * input.height > 100000000) bad('This image has unsupported dimensions.');
    return { ...target, name: input.name.trim(), width: input.width, height: input.height };
  }
  function blobOptions() {
    if (!env.BLOB_STORE_ID && !env.BLOB_READ_WRITE_TOKEN) fail(503, 'images_unavailable', 'Image storage is not configured. Please contact the campaign owner.');
    return { ...(env.BLOB_STORE_ID ? { storeId: env.BLOB_STORE_ID } : {}), ...(env.BLOB_READ_WRITE_TOKEN ? { token: env.BLOB_READ_WRITE_TOKEN } : {}), abortSignal: AbortSignal.timeout(10000) };
  }
  const head = (...args) => (sdk.head || require('@vercel/blob').head)(...args);
  async function confirm(input) {
    const target = meta(input);
    let stored;
    if (local) {
      try {
        stored = JSON.parse(await fs.readFile(path.join(imageDirectory, target.filename + '.json'), 'utf8'));
        const stat = await fs.stat(path.join(imageDirectory, target.filename));
        if (stat.size !== stored.size) throw new Error();
      } catch (_) { bad('This image is no longer available. Upload it again.'); }
    } else {
      const options = blobOptions();
      try { stored = await head(target.pathname, options); }
      catch (_) { fail(503, 'images_unavailable', 'The image could not be verified. Wait a moment and try saving again.'); }
    }
    const type = stored.contentType || stored.type;
    if (stored.pathname !== target.pathname || type !== target.type || !Number.isSafeInteger(stored.size) || stored.size < 1 || stored.size > MAX_IMAGE_BYTES) bad('The stored image is invalid or exceeds 8 MB.');
    if (local) {
      if (stored.width !== target.width || stored.height !== target.height) bad('The image dimensions do not match the uploaded file.');
    } else {
      let url;
      try { url = new URL(stored.url); } catch (_) { bad('The stored image URL is invalid.'); }
      if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/' + target.pathname) bad('The stored image URL is invalid.');
    }
    return { id: target.id, url: stored.url, pathname: target.pathname, name: target.name, type, size: stored.size, width: target.width, height: target.height };
  }
  function signatureMatches(bytes, type) {
    if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (type === 'image/png') return bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (type === 'image/gif') return bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'));
    return type === 'image/webp' && bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  }
  async function localUpload(input) {
    if (!local) fail(405, 'method_not_allowed', 'Use a direct image upload.');
    const target = meta(input);
    if (input.type !== target.type) bad('Choose a JPEG, PNG, WebP, or GIF image.');
    if (typeof input.data !== 'string' || !input.data.length || input.data.length % 4 !== 0 || input.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || /[^A-Za-z0-9+/=]/.test(input.data) || /=/.test(input.data.slice(0, -2)) || (input.data.includes('=') && !/^(?:[A-Za-z0-9+/]=|==)$/.test(input.data.slice(-2)))) bad('The image data is invalid or exceeds 8 MB.');
    const bytes = Buffer.from(input.data, 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !signatureMatches(bytes, target.type)) bad('The image data is invalid or exceeds 8 MB.');
    const stored = { id: target.id, pathname: target.pathname, url: `/api/images?pathname=${encodeURIComponent(target.pathname)}`, name: target.name, width: target.width, height: target.height, type: target.type, size: bytes.length };
    await fs.mkdir(imageDirectory, { recursive: true, mode: 0o700 });
    const filename = path.join(imageDirectory, target.filename);
    try { await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') fail(409, 'image_exists', 'This upload already exists. Choose the image again to retry.'); throw error; }
    try { await fs.writeFile(filename + '.json', JSON.stringify(stored), { flag: 'wx', mode: 0o600 }); }
    catch (error) { await fs.rm(filename, { force: true }); throw error; }
    return stored;
  }
  async function route(req, res) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const url = new URL(req.url || '/api/images', 'http://localhost');
      const pathname = url.searchParams.get('pathname');
      if (!pathname) { respond(res, 200, { mode: local ? 'local' : 'blob', maxBytes: MAX_IMAGE_BYTES, prefix, campaignId: namespace }); return; }
      if (!local) fail(404, 'not_found', 'This image is not available.');
      const target = managed(pathname);
      let stored, bytes;
      try {
        stored = JSON.parse(await fs.readFile(path.join(imageDirectory, target.filename + '.json'), 'utf8'));
        bytes = await fs.readFile(path.join(imageDirectory, target.filename));
      } catch (_) { fail(404, 'not_found', 'This image is not available.'); }
      if (bytes.length > MAX_IMAGE_BYTES || stored.type !== target.type || !signatureMatches(bytes, target.type)) fail(404, 'not_found', 'This image is not available.');
      res.statusCode = 200;
      res.setHeader('Content-Type', target.type);
      res.setHeader('Content-Length', bytes.length);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(req.method === 'HEAD' ? undefined : bytes); return;
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, HEAD, POST'); fail(405, 'method_not_allowed', 'Use GET or POST.'); }
    // The only unauthenticated POST permitted is a provider-signed completion webhook.
    // SDK token requests and local uploads are authorized before any body is stored.
    const webhook = Boolean(req.headers?.['x-vercel-signature']);
    if (!webhook) authorize(req);
    const input = await readJSON(req, local ? 12 * 1024 * 1024 : 16384);
    if (input.type === 'blob.upload-completed') {
      if (local) fail(400, 'invalid_image', 'Unexpected upload callback.');
      try {
        const result = await (sdk.handleUploadPresigned || require('@vercel/blob/client').handleUploadPresigned)({ body: input, request: req, webhookPublicKey: env.BLOB_WEBHOOK_PUBLIC_KEY, getSignedToken: async () => { throw new Error('Unexpected token request'); } });
        respond(res, 200, result); return;
      } catch (_) { fail(403, 'invalid_callback', 'This upload callback could not be verified.'); }
    }
    authorize(req);
    if (input.op === 'local') { respond(res, 200, await localUpload(input)); return; }
    if (input.op === 'confirm') { respond(res, 200, await confirm(input)); return; }
    if (local || input.type !== 'blob.generate-presigned-url') bad('Choose a supported image upload.');
    const target = managed(input.payload?.pathname);
    if (input.payload?.multipart === true) bad('Use a single image upload no larger than 8 MB.');
    const options = blobOptions();
    if (!env.BLOB_WEBHOOK_PUBLIC_KEY) fail(503, 'images_unavailable', 'Image storage is not configured. Please contact the campaign owner.');
    try {
      const result = await (sdk.handleUploadPresigned || require('@vercel/blob/client').handleUploadPresigned)({
        body: input, request: req, webhookPublicKey: env.BLOB_WEBHOOK_PUBLIC_KEY,
        getSignedToken: async pathname => {
          if (pathname !== target.pathname) bad('The upload path changed. Choose the image again.');
          const limits = { pathname, operations: ['put'], allowedContentTypes: [target.type], maximumSizeInBytes: MAX_IMAGE_BYTES, validUntil: now() + 10 * 60 * 1000 };
          const token = await (sdk.issueSignedToken || require('@vercel/blob').issueSignedToken)({ ...options, ...limits });
          return { token, urlOptions: { allowedContentTypes: [target.type], maximumSizeInBytes: MAX_IMAGE_BYTES, allowOverwrite: false, addRandomSuffix: false, cacheControlMaxAge: 31536000 } };
        }
      });
      respond(res, 200, result);
    } catch (error) { if (error instanceof ApiError) throw error; fail(503, 'images_unavailable', 'The image upload could not start. Please try again.'); }
  }
  async function verifySession(next, current) {
    const old = new Map();
    for (const day of current.tripDays || []) for (const image of day.attachments || []) old.set(image.pathname, JSON.stringify(image));
    const verified = new Map();
    for (const day of next.tripDays || []) {
      for (const image of day.attachments || []) {
        const serialized = JSON.stringify(image);
        if (old.get(image.pathname) === serialized || verified.get(image.pathname) === serialized) continue;
        const canonical = await confirm(image);
        if (image.url !== canonical.url || image.size !== canonical.size || image.type !== canonical.type || image.id !== canonical.id) bad('An image reference does not match the uploaded file. Upload it again.');
        verified.set(image.pathname, serialized);
      }
    }
  }
  return { route, verifySession };
}

module.exports = { createImages, MAX_IMAGE_BYTES, TYPES };
