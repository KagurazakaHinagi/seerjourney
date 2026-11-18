/* Personal character route filters; never written into shared campaign data. */
(function () {
  'use strict';
  const I = window.MapJourneyI18n;
  function create({ core: C, root, onSelect, onEmptyFocus = () => {} }) {
    let selected = null, logs = [], query = '';
    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    function choose(name) {
      selected = name;
      render();
      onSelect(name);
    }
    function render() {
      const focused = root.contains(document.activeElement) ? document.activeElement?.getAttribute('data-participant-key') : null;
      const names = C.participantNames(logs);
      root.hidden = !names.length;
      root.replaceChildren();
      if (!names.length) { if (focused !== null) onEmptyFocus(); return; }
      const heading = element('h2', 'participant-paths-heading', I.t('Character paths'));
      const description = element('p', 'participant-paths-help', I.t('Choose a character to show their route.'));
      const list = element('div', 'participant-path-list');
      list.setAttribute('role', 'group'); list.setAttribute('aria-label', I.t('Character paths'));
      const all = element('button', 'participant-path', I.t('Whole journey'));
      all.type = 'button'; all.setAttribute('aria-pressed', String(!selected));
      all.setAttribute('data-participant-key', '');
      all.addEventListener('click', () => choose(null)); list.append(all);
      const matches = names.filter(name => C.participantKey(name).includes(C.participantKey(query)));
      // Keep the current selection reachable even when searching for another name.
      const choices = [...new Set([...(selected ? [selected] : []), ...matches])];
      const visible = choices.slice(0, 30).sort(C.compareNames);
      for (const name of visible) {
        const button = element('button', 'participant-path', name);
        button.type = 'button'; button.title = name;
        button.setAttribute('data-participant-key', C.participantKey(name));
        button.setAttribute('aria-pressed', String(C.participantKey(name) === C.participantKey(selected || '')));
        button.addEventListener('click', () => choose(name)); list.append(button);
      }
      const status = element('p', 'participant-path-status');
      status.setAttribute('role', 'status');
      if (selected) {
        const days = logs.filter(day => (day.participants || []).some(name => C.participantKey(name) === C.participantKey(selected)));
        const mapped = days.filter(day => day.hex).length;
        status.textContent = I.t('{name}: {days} days · {stops} mapped', { name: selected, days: I.number(days.length), stops: I.number(mapped) });
        const help = element('span', 'participant-path-rule', I.t(mapped ? 'The route breaks on recorded days without this character.' : 'These days have no map locations yet.'));
        status.append(help);
      } else if (query && !matches.length) status.textContent = I.t('No matching characters.');
      else status.hidden = true;
      root.append(heading, description, list, status);
      if (choices.length > visible.length) root.append(element('p', 'participant-paths-help', I.t('Type a name to narrow the list.')));
      if (focused !== null) {
        const target = [...list.children].find(button => button.getAttribute('data-participant-key') === focused) || all;
        target.focus({ preventScroll: true });
      }
    }
    return {
      getValue: () => selected,
      clear: () => { selected = null; },
      update(nextLogs, nextQuery = '') {
        logs = nextLogs; query = nextQuery;
        // Reconcile live renames/removals without changing anyone else's view.
        if (selected) selected = C.participantNames(logs).find(name => C.participantKey(name) === C.participantKey(selected)) || null;
        render();
      }
    };
  }
  window.MapJourneyParticipantPaths = { create };
})();
