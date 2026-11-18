/* Participant names stay in each editor's draft until its day is saved. */
(function () {
  'use strict';
  const t = window.MapJourneyI18n.t;
  window.MapJourneyParticipants = { create };

  function create({ container, core, canEdit = () => false, getSuggestions = () => [] }) {
    let participants = [];
    const prefix = container.id;
    container.classList.add('participant-tags');
    const heading = document.createElement('strong');
    heading.className = 'participant-heading'; heading.id = `${prefix}-heading`; heading.textContent = t('Participants');
    container.setAttribute('aria-labelledby', heading.id);
    const list = document.createElement('ul'); list.className = 'participant-list';
    const empty = document.createElement('p'); empty.className = 'participant-empty'; empty.textContent = t('No participants recorded.');
    const entry = document.createElement('div'); entry.className = 'participant-entry';
    const input = document.createElement('input'); input.type = 'text'; input.className = 'participant-input';
    input.id = `${prefix}-input`; input.maxLength = 80; input.autocomplete = 'off'; input.enterKeyHint = 'done';
    input.placeholder = t('Add a name'); input.setAttribute('aria-label', t('Participant name'));
    const suggestions = document.createElement('datalist'); suggestions.id = `${prefix}-suggestions`;
    input.setAttribute('list', suggestions.id);
    const add = document.createElement('button'); add.type = 'button'; add.className = 'icon-button participant-add';
    add.title = t('Add participant'); add.setAttribute('aria-label', t('Add participant'));
    add.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg>';
    const error = document.createElement('p'); error.id = `${prefix}-error`; error.className = 'field-error participant-error';
    error.hidden = true; error.setAttribute('role', 'alert'); input.setAttribute('aria-describedby', error.id);
    entry.append(input, add, suggestions);
    container.replaceChildren(heading, list, empty, entry, error);

    function showError(message = '') {
      error.textContent = message; error.hidden = !message;
      input.setAttribute('aria-invalid', String(Boolean(message)));
    }

    function refreshSuggestions() {
      const selected = new Set(participants.map(core.participantKey));
      const fragment = document.createDocumentFragment();
      for (const name of [...getSuggestions()].sort(core.compareNames)) {
        if (selected.has(core.participantKey(name))) continue;
        const option = document.createElement('option'); option.value = name; fragment.append(option);
      }
      suggestions.replaceChildren(fragment);
    }

    function renderAccess() {
      const editable = canEdit();
      entry.hidden = !editable; input.disabled = !editable; add.disabled = !editable || !input.value.trim();
      error.hidden = !editable || !error.textContent;
      const fragment = document.createDocumentFragment();
      for (const name of [...participants].sort(core.compareNames)) {
        const tag = document.createElement('li'); tag.className = 'participant-tag';
        const label = document.createElement('span'); label.className = 'participant-name'; label.textContent = name;
        tag.append(label);
        if (editable) {
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button participant-remove';
          remove.setAttribute('aria-label', t('Remove participant: {name}', { name }));
          remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
          remove.addEventListener('click', () => {
            if (!canEdit()) return;
            participants = participants.filter(value => core.participantKey(value) !== core.participantKey(name));
            showError(); renderAccess(); input.focus({ preventScroll: true });
          });
          tag.append(remove);
        }
        fragment.append(tag);
      }
      list.replaceChildren(fragment); list.hidden = !participants.length;
      empty.hidden = editable || participants.length > 0;
      refreshSuggestions();
    }

    function commitPending() {
      if (!canEdit()) return false;
      const name = input.value.normalize('NFC').trim().replace(/\s+/gu, ' ');
      if (!name) { input.value = ''; showError(); renderAccess(); return true; }
      if (name.length > 80) { showError(t('Keep participant names within 80 characters.')); input.focus(); return false; }
      const exists = participants.some(value => core.participantKey(value) === core.participantKey(name));
      if (!exists && participants.length >= 32) { showError(t('Keep each day within 32 participants.')); input.focus(); return false; }
      try {
        const normalized = core.normalizeParticipants([input.value]);
        if (!exists) participants = core.normalizeParticipants([...participants, ...normalized]);
      } catch (cause) {
        showError(t(cause.message)); input.focus(); return false;
      }
      input.value = ''; showError(); renderAccess(); return true;
    }

    input.addEventListener('input', () => { showError(); add.disabled = !canEdit() || !input.value.trim(); });
    input.addEventListener('focus', refreshSuggestions);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault(); commitPending();
    });
    add.addEventListener('click', () => { if (commitPending()) input.focus({ preventScroll: true }); });
    renderAccess();
    return {
      getValue: () => [...participants],
      getDraft: () => ({ participants: [...participants], participantInput: input.value }),
      commitPending,
      setValue(values = []) { participants = core.normalizeParticipants(values); input.value = ''; showError(); renderAccess(); },
      renderAccess
    };
  }
})();
