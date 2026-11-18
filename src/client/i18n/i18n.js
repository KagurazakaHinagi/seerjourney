/* English source messages are stable IDs; language packs add translated values. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else {
    let storage;
    try { storage = localStorage; } catch (_) { /* Private contexts may deny access. */ }
    root.MapJourneyI18n = factory({ storage, languages: navigator.languages || [navigator.language], document });
  }
})(typeof window !== 'undefined' ? window : globalThis, function (options) {
  'use strict';
  const { storage, languages = [], document } = options || {};
  const STORAGE_KEY = 'seerjourney.language';
  const supported = ['en', 'zh-CN'];
  const catalogs = new Map(), patterns = new Map();
  function preferredLanguage() {
    for (const language of languages) {
      if (/^zh(?:-(?:CN|SG|Hans)(?:-|$)|$)/i.test(language)) return 'zh-CN';
      if (/^en(?:-|$)/i.test(language)) return 'en';
    }
    return 'en';
  }
  // The hosted campaign opens in Chinese; visitors may choose English locally.
  let locale = 'zh-CN';
  try { const saved = storage?.getItem(STORAGE_KEY); if (supported.includes(saved)) locale = saved; } catch (_) {}
  document?.documentElement?.setAttribute?.('lang', locale);

  function interpolate(message, values = {}) {
    return message.replace(/\{(\w+)\}/g, (token, name) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token);
  }
  function register(language, messages) {
    if (!supported.includes(language)) throw new Error(`Unsupported language: ${language}`);
    const catalog = catalogs.get(language) || Object.create(null);
    for (const [source, translation] of Object.entries(messages)) {
      if (typeof translation !== 'string') throw new TypeError(`Invalid translation: ${source}`);
      catalog[source] = translation;
    }
    catalogs.set(language, catalog); patterns.delete(language);
  }
  function t(source, values) { return interpolate(catalogs.get(locale)?.[source] ?? source, values); }
  function text(message) {
    if (typeof message !== 'string') return '';
    const catalog = catalogs.get(locale);
    if (!catalog) return message;
    if (Object.prototype.hasOwnProperty.call(catalog, message)) return catalog[message];
    // Validation modules retain language-independent errors for consumers. Only
    // their app-owned message templates are localized at the display boundary.
    if (!patterns.has(locale)) {
      const entries = [];
      for (const source of Object.keys(catalog)) {
        if (source === catalog[source]) continue;
        const names = [], parts = source.split(/(\{\w+\})/g);
        if (parts.length === 1) continue;
        const pattern = parts.map(part => {
          if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '([\\s\\S]+?)'; }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('');
        entries.push({ source, names, pattern: new RegExp(`^${pattern}$`) });
      }
      // Prefer specific diagnostics over broad templates such as "{name} map".
      entries.sort((a, b) => b.source.replace(/\{\w+\}/g, '').length - a.source.replace(/\{\w+\}/g, '').length);
      patterns.set(locale, entries);
    }
    for (const entry of patterns.get(locale)) {
      const match = message.match(entry.pattern);
      if (match) return t(entry.source, Object.fromEntries(entry.names.map((name, index) => [name, match[index + 1]])));
    }
    return message;
  }
  function setLocale(language) {
    if (!supported.includes(language)) return false;
    try {
      if (!storage) return false;
      storage.setItem(STORAGE_KEY, language);
      locale = language;
      document?.documentElement?.setAttribute?.('lang', locale);
      return true;
    } catch (_) { return false; }
  }
  function number(value, options) { return new Intl.NumberFormat(locale, options).format(value); }
  return { t, text, number, register, setLocale, get locale() { return locale; }, supported: [...supported], storageKey: STORAGE_KEY };
});
