/* Only artwork and the app shell are cached. Live state/auth always use the API. */
'use strict';
const PREFIX = 'seerjourney-campaign:';
const CACHE = PREFIX + '__BUILD_ID__';
const SHELL = /* __SHELL_FILES__ */ [];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const path = url.pathname.slice(1);
  if (!SHELL.includes(path) && path !== '' && !/^campaign-map\/[a-zA-Z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/.test(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Content-versioned raster tiles are immutable. Revisited map areas should
    // not wait for the network; live campaign state still bypasses this worker.
    if (/^campaign-map\/tiles\/.+\.(?:jpg|jpeg|png|webp)$/.test(path) && url.searchParams.has('v')) {
      const tile = await cache.match(request);
      if (tile) return tile;
    }
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (_) {
      return await cache.match(request) || Response.error();
    }
  })());
});
