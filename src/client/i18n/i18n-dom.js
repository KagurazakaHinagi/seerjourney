/* Translate the authored shell once, before any user or map content is mounted. */
(function () {
  'use strict';
  const I = window.MapJourneyI18n;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    if (node.parentElement.closest('script, style, textarea, [translate="no"]')) continue;
    const source = node.nodeValue.trim();
    if (source) node.nodeValue = node.nodeValue.replace(source, I.t(source));
  }
  for (const element of document.querySelectorAll('[aria-label], [title], [placeholder], [alt]')) {
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, I.t(element.getAttribute(attribute)));
    }
  }
  for (const select of document.querySelectorAll('[data-language-select]')) {
    select.value = I.locale;
    select.addEventListener('change', () => {
      const language = select.value;
      const status = document.getElementById(`${select.id}-status`);
      // The setting is reachable from Options and the welcome/library only.
      // Do not replace an expedition when a save is blocked by another tab.
      if (window.MapJourneyApp?.save() === false) {
        select.value = I.locale;
        status.textContent = I.t('Save or export your current session before changing the language.');
        status.hidden = false;
        return;
      }
      if (!I.setLocale(language)) {
        select.value = I.locale;
        status.textContent = I.t('The language setting could not be saved. Allow browser storage and try again.');
        status.hidden = false;
        return;
      }
      // A fresh shell localizes every derived state while preserving saved map
      // data. The existing beforeunload draft guard remains in force.
      location.reload();
    });
  }
})();
