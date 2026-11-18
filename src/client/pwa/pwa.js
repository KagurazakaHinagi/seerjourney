(function () {
  'use strict';
  const standalone = window.matchMedia('(display-mode: standalone)');
  const update = () => document.documentElement.classList.toggle('is-standalone', standalone.matches || navigator.standalone === true);
  update(); standalone.addEventListener?.('change', update);
  const status = document.getElementById('offline-status');
  if (status) status.textContent = window.MapJourneyI18n.locale === 'zh-CN' ? '共享冒险进度 · 同步需要网络连接' : 'Shared campaign · a connection is needed to sync';
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  const register = () => navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' }).catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
})();
