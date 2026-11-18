/* This deployment loads the staged map. Campaign state is loaded separately. */
(function () {
  'use strict';
  const ready = (async () => {
    try {
      const tileURL = new URL('campaign-map/tiles/manifest.json', location.href);
      const [config, runtime] = await Promise.all([
        window.MapJourneyMods.loadBundled('campaign-map/map.json', { embedAssets: false }),
        fetch(new URL('campaign-map/runtime.json', location.href), { cache: 'no-cache' }).then(response => {
          if (!response.ok) throw new Error('Map configuration unavailable');
          return response.json();
        })
      ]);
      if (runtime.tiles) {
        const response = await fetch(tileURL, { cache: 'no-cache' });
        if (!response.ok) throw new Error('Map tiles unavailable');
        config.tileManifest = { ...await response.json(), baseURL: new URL('./', tileURL).href };
      }
      document.body.classList.remove('no-map');
      return config;
    } catch (_) {
      const I = window.MapJourneyI18n;
      document.getElementById('map-loading').hidden = true;
      document.body.classList.remove('map-booting');
      document.getElementById('map-viewport').removeAttribute('aria-busy');
      const error = document.getElementById('map-error');
      error.hidden = false;
      error.textContent = I.locale === 'zh-CN' ? '地图加载失败。请检查网络连接，然后重新载入页面。' : 'The map could not load. Check your connection, then reload this page.';
      return null;
    }
  })();
  window.MapJourneyBootstrap = { ready };
})();
