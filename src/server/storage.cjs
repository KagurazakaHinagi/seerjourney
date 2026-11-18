'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

class StoreError extends Error {
  constructor() { super('Campaign storage is unavailable. Please try again.'); this.code = 'storage_unavailable'; }
}

// Local development runs in one Node process. Serialize all store instances for
// the same file, then rename atomically so an interrupted write cannot truncate it.
const locks = new Map();
function serialized(file, operation) {
  const previous = locks.get(file) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(file, current);
  return current.finally(() => { if (locks.get(file) === current) locks.delete(file); });
}

function createFileStore(file, initial, { now = Date.now } = {}) {
  file = path.resolve(file);
  async function transact(operation) {
    return serialized(file, async () => {
      let data;
      try { data = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw new StoreError();
        data = { campaign: initial(), rates: {} };
      }
      if (!data || !data.campaign || !Number.isSafeInteger(data.campaign.revision) || !data.rates) throw new StoreError();
      const result = operation(data);
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
        await fs.rename(temporary, file);
      } catch (_) { await fs.rm(temporary, { force: true }).catch(() => {}); throw new StoreError(); }
      return structuredClone(result);
    });
  }
  return {
    read: () => transact(data => data.campaign),
    compareSwap: (revision, next) => transact(data => {
      if (data.campaign.revision !== revision) return { ok: false, campaign: data.campaign };
      data.campaign = next;
      return { ok: true, campaign: next };
    }),
    rateLimit: (buckets, seconds) => transact(data => {
      const timestamp = now();
      for (const [key, rate] of Object.entries(data.rates)) if (rate.expires <= timestamp) delete data.rates[key];
      let allowed = true, retryAfter = 0;
      for (const { key, limit } of buckets) {
        const rate = data.rates[key] ||= { count: 0, expires: timestamp + seconds * 1000 };
        rate.count++;
        if (rate.count > limit) { allowed = false; retryAfter = Math.max(retryAfter, Math.ceil((rate.expires - timestamp) / 1000)); }
      }
      return { allowed, retryAfter };
    })
  };
}

const COMPARE_SWAP = `
local current = redis.call('GET', KEYS[1])
if not current then
  current = ARGV[3]
  redis.call('SET', KEYS[1], current)
end
local snapshot = cjson.decode(current)
if snapshot.revision ~= tonumber(ARGV[1]) then
  return {0, current}
end
redis.call('SET', KEYS[1], ARGV[2])
return {1, ARGV[2]}`;

const RATE_LIMIT = `
local allowed = true
local retryAfter = 0
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, tonumber(ARGV[1])) end
  if count > tonumber(ARGV[i+1]) then
    allowed = false
    retryAfter = math.max(retryAfter, redis.call('TTL', key))
  end
end
return cjson.encode({allowed=allowed, retryAfter=retryAfter})`;

function createRedisStore({ url, token, namespace, initial, fetch: fetcher = globalThis.fetch }) {
  let endpoint;
  try {
    endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
  } catch (_) { throw new StoreError(); }
  if (!token) throw new StoreError();
  const key = `seerjourney:${namespace}:campaign`;
  async function command(args) {
    try {
      const response = await fetcher(endpoint.href, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.timeout(8000), redirect: 'error', cache: 'no-store'
      });
      if (!response.ok) throw new StoreError();
      const data = await response.json();
      if (data.error || !Object.hasOwn(data, 'result')) throw new StoreError();
      return data.result;
    } catch (_) { throw new StoreError(); }
  }
  function parse(value) {
    try { return JSON.parse(value); } catch (_) { throw new StoreError(); }
  }
  return {
    async read() {
      let value = await command(['GET', key]);
      if (value === null) {
        await command(['SET', key, JSON.stringify(initial()), 'NX']);
        value = await command(['GET', key]);
      }
      const snapshot = parse(value);
      if (!snapshot || !Number.isSafeInteger(snapshot.revision) || !snapshot.session) throw new StoreError();
      return snapshot;
    },
    async compareSwap(revision, next) {
      // Lua cjson erases the distinction between [] and {}. Decode only the
      // revision in Lua and return the original JSON bytes via a Redis tuple.
      const result = await command(['EVAL', COMPARE_SWAP, '1', key, String(revision), JSON.stringify(next), JSON.stringify(initial())]);
      if (!Array.isArray(result) || result.length !== 2 || ![0, 1].includes(result[0]) || typeof result[1] !== 'string') throw new StoreError();
      return { ok: result[0] === 1, campaign: parse(result[1]) };
    },
    async rateLimit(buckets, seconds) {
      return parse(await command(['EVAL', RATE_LIMIT, String(buckets.length), ...buckets.map(bucket => `seerjourney:${namespace}:login:${bucket.key}`), String(seconds), ...buckets.map(bucket => String(bucket.limit))]));
    }
  };
}

module.exports = { createFileStore, createRedisStore, StoreError };
