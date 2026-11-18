/* Bookmark artwork and accessible, swatch-bearing select controls. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const colors = { gold: '#e7bd6a', green: '#88c7a0', red: '#ef8e7b', blue: '#8ec4e6', purple: '#c2a7e5', grey: '#b7bfbc' };
  const kinds = new Set(['place', 'camp', 'danger', 'ruin', 'tomb', 'treasure']);
  function icon(kind) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'bookmark-icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', `assets/iconoir/markers.svg#${kinds.has(kind) ? kind : 'place'}`);
    svg.append(use);
    return svg;
  }
  function swatch(value) {
    const el = document.createElement('span');
    el.className = 'marker-swatch'; el.style.backgroundColor = colors[value]; el.setAttribute('aria-hidden', 'true');
    return el;
  }
  function createPicker(select, type) {
    const field = select.parentElement, dialog = select.closest('dialog');
    const label = document.querySelector(`label[for="${select.id}"]`);
    label.id ||= `${select.id}-label`;
    const button = document.createElement('button');
    button.type = 'button'; button.id = `${select.id}-picker`; button.className = 'marker-picker';
    button.setAttribute('role', 'combobox'); button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-labelledby', label.id);
    const valueLabel = document.createElement('span'); valueLabel.className = 'marker-picker-label';
    const menu = document.createElement('div');
    menu.id = `${select.id}-options`; menu.className = 'marker-picker-menu'; menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-labelledby', label.id); menu.hidden = true;
    button.setAttribute('aria-controls', menu.id);
    const topLayer = typeof menu.showPopover === 'function';
    if (topLayer) menu.setAttribute('popover', 'auto');
    let opened = false, active = 0, typed = '', typedAt = 0;
    const entries = [...select.options];
    const visual = value => type === 'color' ? swatch(value) : icon(value);
    const options = entries.map((entry, index) => {
      const row = document.createElement('div');
      row.id = `${select.id}-option-${entry.value}`; row.className = 'marker-picker-option';
      row.setAttribute('role', 'option'); row.dataset.value = entry.value;
      const name = document.createElement('span'); name.textContent = entry.textContent;
      const check = document.createElementNS(NS, 'svg');
      check.setAttribute('viewBox', '0 0 24 24'); check.setAttribute('class', 'marker-picker-check'); check.setAttribute('aria-hidden', 'true');
      const checkIcon = document.createElementNS(NS, 'use'); checkIcon.setAttribute('href', '#i-check'); check.append(checkIcon);
      row.append(visual(entry.value), name, check);
      row.addEventListener('click', () => choose(index));
      menu.append(row);
      return row;
    });
    function markActive(index, scroll = true) {
      active = index;
      options.forEach((row, i) => row.classList.toggle('is-active', i === active));
      button.setAttribute('aria-activedescendant', options[active].id);
      if (scroll) options[active].scrollIntoView({ block: 'nearest' });
    }
    function position() {
      if (!opened || !topLayer) return;
      const r = button.getBoundingClientRect(), v = window.visualViewport;
      const left = v?.offsetLeft || 0, top = v?.offsetTop || 0;
      const width = v?.width || window.innerWidth, height = v?.height || window.innerHeight;
      const below = top + height - r.bottom - 12, above = r.top - top - 12;
      const upward = below < Math.min(menu.scrollHeight, 248) && above > below;
      menu.style.width = `${Math.min(Math.max(r.width, 160), width - 24)}px`;
      menu.style.maxHeight = `${Math.max(48, Math.min(260, upward ? above : below))}px`;
      menu.style.left = `${Math.max(left + 12, Math.min(r.left, left + width - menu.offsetWidth - 12))}px`;
      menu.style.top = `${upward ? r.top - menu.offsetHeight - 6 : r.bottom + 6}px`;
    }
    function closed() {
      opened = false; menu.hidden = true;
      button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-activedescendant');
    }
    function close() {
      if (topLayer && menu.matches(':popover-open')) menu.hidePopover();
      closed();
    }
    function refresh() {
      const entry = entries.find(item => item.value === select.value) || entries[0];
      valueLabel.textContent = entry.textContent;
      button.replaceChildren(visual(entry.value), valueLabel, field.querySelector('.select-chevron').cloneNode(true));
      button.disabled = select.disabled;
      options.forEach(row => row.setAttribute('aria-selected', String(row.dataset.value === entry.value)));
      if (button.disabled) close();
    }
    function open() {
      if (select.disabled) return;
      opened = true; menu.hidden = false;
      if (topLayer) menu.showPopover();
      button.setAttribute('aria-expanded', 'true');
      position(); markActive(Math.max(0, entries.findIndex(item => item.value === select.value)));
    }
    function choose(index) {
      if (select.disabled) return;
      select.value = entries[index].value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      close(); button.focus({ preventScroll: true });
    }
    button.addEventListener('click', () => opened ? close() : open());
    button.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        if (!opened) { open(); if (event.key.startsWith('Arrow')) return; }
        markActive(event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (active + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); if (opened) choose(active); else open();
      } else if (event.key === 'Escape' && opened) {
        event.preventDefault(); event.stopPropagation(); close();
      } else if (event.key === 'Tab') close();
      else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        typed = Date.now() - typedAt > 700 ? event.key : typed + event.key; typedAt = Date.now();
        const match = entries.findIndex(entry => entry.textContent.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase()));
        if (match >= 0) { event.preventDefault(); if (!opened) open(); markActive(match); }
      }
    });
    menu.addEventListener('pointerdown', event => event.preventDefault());
    menu.addEventListener('toggle', () => { if (!menu.matches(':popover-open')) closed(); });
    document.addEventListener('pointerdown', event => { if (opened && !field.contains(event.target)) close(); });
    document.addEventListener('scroll', event => { if (event.target !== menu) position(); }, true);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    dialog.addEventListener('close', close);
    dialog.addEventListener('cancel', event => { if (opened) { event.preventDefault(); close(); } });
    select.addEventListener('change', refresh);
    label.htmlFor = button.id;
    select.hidden = true;
    field.classList.add('marker-picker-field');
    field.append(button, menu);
    refresh();
    return { refresh, close };
  }
  window.MapJourneyMarkerUI = { colors, icon, createPicker };
})();
