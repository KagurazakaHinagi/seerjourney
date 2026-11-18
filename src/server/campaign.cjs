'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const C = require('../shared/core.js');
const { loadMap, namespace } = require('./map-config.cjs');
const manifest = loadMap().manifest;
const { createFileStore, createRedisStore } = require('./storage.cjs');
const { createImages } = require('./images.cjs');

const MAP = { id: manifest.id, name: manifest.name, grid: manifest.grid, fogHexes: manifest.fog.cells };
const COOKIE = 'seerjourney_editor';
const BODY_LIMIT = 2 * 1024 * 1024;
const SESSION_SECONDS = 12 * 60 * 60;

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const invalid = message => new ApiError(400, 'invalid_request', message);
const unavailable = () => new ApiError(503, 'not_configured', 'Campaign editing is not configured. Please contact the campaign owner.');

function hmac(secret, value) { return crypto.createHmac('sha256', secret).update(value).digest(); }
function equal(left, right) { return left.length === right.length && crypto.timingSafeEqual(left, right); }
function authConfig(env) {
  let allowed;
  try { allowed = JSON.parse(env.CAMPAIGN_PASSPHRASES); } catch (_) { throw unavailable(); }
  if (typeof env.SESSION_SECRET !== 'string' || Buffer.byteLength(env.SESSION_SECRET) < 32 ||
      !Array.isArray(allowed) || !allowed.length || allowed.length > 100 ||
      allowed.some(value => typeof value !== 'string' || value.length < 8 || value.length > 512)) throw unavailable();
  return { secret: env.SESSION_SECRET, allowed: allowed.map(value => hmac(env.SESSION_SECRET, `passphrase:${value}`)) };
}
function credentialsMatch(digest, allowed) {
  let match = false;
  // Compare every entry so position in the configured allowlist is not leaked.
  for (const value of allowed) match = equal(digest, value) || match;
  return match;
}
function cookieValue(req) {
  const raw = req.headers?.cookie;
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  const values = raw.split(';').map(value => value.trim()).filter(value => value.startsWith(`${COOKIE}=`));
  return values.length === 1 ? values[0].slice(COOKIE.length + 1) : null;
}
function authenticate(req, config, now) {
  const token = cookieValue(req);
  if (!token || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [body, signature] = parts;
  if (!equal(hmac(config.secret, body), Buffer.from(signature, 'base64url'))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (data.v !== 1 || !Number.isSafeInteger(data.exp) || data.exp <= now || data.exp > now + SESSION_SECONDS * 1000 ||
        typeof data.credential !== 'string' || !/^[a-f0-9]{64}$/.test(data.credential) ||
        !credentialsMatch(Buffer.from(data.credential, 'hex'), config.allowed)) return null;
    return { editable: true, expiresAt: new Date(data.exp).toISOString() };
  } catch (_) { return null; }
}
function requestOrigin(req, env) {
  const host = req.headers?.host;
  if (typeof host !== 'string' || !/^[a-z0-9.[\]:-]+$/i.test(host)) throw new ApiError(403, 'invalid_origin', 'This request must come from the campaign page.');
  const secure = Boolean(env.VERCEL) || req.socket?.encrypted || req.headers?.['x-forwarded-proto'] === 'https';
  return `${secure ? 'https' : 'http'}://${host}`;
}
function checkOrigin(req, env) {
  const origin = req.headers?.origin;
  if (origin !== requestOrigin(req, env) || req.headers?.['sec-fetch-site'] === 'cross-site') {
    throw new ApiError(403, 'invalid_origin', 'This request must come from the campaign page.');
  }
}
function setCookie(res, value, env, req, maxAge) {
  const secure = requestOrigin(req, env).startsWith('https:');
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}
async function readJSON(req, limit = BODY_LIMIT) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) throw new ApiError(415, 'unsupported_media_type', 'Send JSON data.');
  if (Number(req.headers?.['content-length']) > limit) throw new ApiError(413, 'payload_too_large', 'This request is too large.');
  let raw;
  if (req.body !== undefined) {
    try { raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body); }
    catch (_) { throw invalid('This request is not valid JSON.'); }
  } else {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > limit) throw new ApiError(413, 'payload_too_large', 'This request is too large.');
      chunks.push(Buffer.from(chunk));
    }
    raw = Buffer.concat(chunks);
  }
  if (raw === undefined || Buffer.byteLength(raw) > limit) throw new ApiError(413, 'payload_too_large', 'This request is too large.');
  let result;
  try { result = JSON.parse(raw.toString()); } catch (_) { throw invalid('This request is not valid JSON.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw invalid('Send a JSON object.');
  return result;
}
function respond(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}

function createAPI({ env = process.env, now = Date.now, store: providedStore, fetch, imageSDK } = {}) {
  function initial() {
    const session = C.freshSession(MAP);
    session.name = env.CAMPAIGN_NAME || MAP.name;
    session.createdAt = session.updatedAt = new Date(now()).toISOString();
    return { revision: 0, session, updatedAt: session.updatedAt };
  }
  let store;
  function storage() {
    if (providedStore) return providedStore;
    if (store) return store;
    const campaignId = namespace(env, MAP.id);
    if (env.CAMPAIGN_STORE === 'file') {
      if (env.VERCEL || env.NODE_ENV === 'production') throw unavailable();
      store = createFileStore(env.CAMPAIGN_DATA_FILE || path.resolve(__dirname, '../../.data/campaign.json'), initial, { now });
    } else {
      const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
      const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
      if (!url || !token) throw unavailable();
      store = createRedisStore({ url, token, namespace: campaignId, initial, fetch });
    }
    return store;
  }
  function guarded(handler) {
    return async (req, res) => {
      try { await handler(req, res); }
      catch (error) {
        const status = error instanceof ApiError ? error.status : 503;
        respond(res, status, { error: error.code || 'storage_unavailable', message: error instanceof ApiError ? error.message : 'Campaign storage is unavailable. Please try again.' });
      }
    };
  }
  function authorize(req) {
    checkOrigin(req, env);
    if (!authenticate(req, authConfig(env), now())) throw new ApiError(401, 'unauthorized', 'Sign in to edit this campaign.');
  }
  const imageService = createImages({ env, mapId: MAP.id, now, authorize, readJSON, respond, ApiError, sdk: imageSDK });
  const campaign = guarded(async (req, res) => {
    if (req.method === 'GET') {
      const current = await storage().read();
      if (current.session.mapId !== MAP.id) throw new ApiError(409, 'map_mismatch', 'The stored campaign belongs to a different map. Restore its map or use a different CAMPAIGN_ID.');
      respond(res, 200, current); return;
    }
    if (req.method !== 'PUT') { res.setHeader('Allow', 'GET, PUT'); respond(res, 405, { error: 'method_not_allowed', message: 'Use GET or PUT.' }); return; }
    checkOrigin(req, env);
    const auth = authenticate(req, authConfig(env), now());
    if (!auth) throw new ApiError(401, 'unauthorized', 'Sign in to edit this campaign.');
    const input = await readJSON(req);
    if (!Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= Number.MAX_SAFE_INTEGER) throw invalid('A valid campaign revision is required.');
    const current = await storage().read();
    if (current.session.mapId !== MAP.id) throw new ApiError(409, 'map_mismatch', 'The stored campaign belongs to a different map. Restore its map or use a different CAMPAIGN_ID.');
    if (current.revision !== input.revision) { respond(res, 409, { error: 'conflict', message: 'Another editor saved changes. Review the latest campaign before saving again.', campaign: current }); return; }
    const proposed = { ...input.session, view: null, showJourney: true };
    // Older open tabs omit fields they do not know. Preserve existing values;
    // Current editors explicitly clear lists or send an empty supply record.
    if (!Object.hasOwn(proposed, 'adventureNotes') && current.session.adventureNotes !== undefined) {
      proposed.adventureNotes = structuredClone(current.session.adventureNotes);
    }
    if (Array.isArray(proposed.tripDays)) {
      const previousDays = new Map(current.session.tripDays.map(day => [day.id, day]));
      proposed.tripDays = proposed.tripDays.map(day => {
        if (!day || typeof day !== 'object' || Array.isArray(day)) return day;
        const previous = previousDays.get(day.id), preserved = {};
        for (const field of ['attachments', 'participants', 'supplies']) {
          if (!Object.hasOwn(day, field) && previous?.[field] !== undefined) preserved[field] = structuredClone(previous[field]);
        }
        return { ...day, ...preserved };
      });
    }
    let session;
    try { session = C.validateSession(proposed, MAP); }
    catch (error) { throw new ApiError(400, 'invalid_session', error.message); }
    if (session.tripDays.some(day => day.attachments?.length)) {
      await imageService.verifySession(session, current.session);
    }
    const timestamp = new Date(now()).toISOString();
    session.updatedAt = timestamp;
    const next = { revision: input.revision + 1, session, updatedAt: timestamp };
    const result = await storage().compareSwap(input.revision, next);
    if (!result.ok) { respond(res, 409, { error: 'conflict', message: 'Another editor saved changes. Review the latest campaign before saving again.', campaign: result.campaign }); return; }
    respond(res, 200, result.campaign);
  });
  const auth = guarded(async (req, res) => {
    if (req.method === 'GET') { respond(res, 200, authenticate(req, authConfig(env), now()) || { editable: false }); return; }
    if (!['POST', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'GET, POST, DELETE'); respond(res, 405, { error: 'method_not_allowed', message: 'Use GET, POST, or DELETE.' }); return; }
    checkOrigin(req, env);
    if (req.method === 'DELETE') { setCookie(res, '', env, req, 0); respond(res, 200, { editable: false }); return; }
    const config = authConfig(env);
    const forwarded = env.VERCEL ? req.headers?.['x-forwarded-for'] : null;
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || 'local';
    const bucket = hmac(config.secret, `ip:${ip}`).toString('hex');
    const rate = await storage().rateLimit([{ key: bucket, limit: 10 }, { key: 'global', limit: 100 }], 900);
    if (!rate.allowed) { res.setHeader('Retry-After', String(Math.max(1, rate.retryAfter))); throw new ApiError(429, 'rate_limited', 'Too many sign-in attempts. Try again later.'); }
    const input = await readJSON(req, 4096);
    if (typeof input.passphrase !== 'string' || input.passphrase.length > 512 || !credentialsMatch(hmac(config.secret, `passphrase:${input.passphrase}`), config.allowed)) {
      throw new ApiError(401, 'invalid_passphrase', 'The passphrase is incorrect.');
    }
    const exp = now() + SESSION_SECONDS * 1000;
    const body = Buffer.from(JSON.stringify({ v: 1, exp, credential: hmac(config.secret, `passphrase:${input.passphrase}`).toString('hex') })).toString('base64url');
    setCookie(res, `${body}.${hmac(config.secret, body).toString('base64url')}`, env, req, SESSION_SECONDS);
    respond(res, 200, { editable: true, expiresAt: new Date(exp).toISOString() });
  });
  return { campaign, auth, images: guarded(imageService.route) };
}

module.exports = { createAPI, MAP, BODY_LIMIT, COOKIE, SESSION_SECONDS };
