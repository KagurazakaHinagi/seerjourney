/* Shared reference notes use the campaign's autosave, undo, and draft recovery boundary. */
(function () {
  'use strict';
  const I = window.MapJourneyI18n, t = I.t;
  window.MapJourneyAdventureNotes = { create };

  function create(api) {
    const $ = id => document.getElementById(id), dialog = $('notes-dialog');
    const canEdit = api.canEdit || (() => false);
    const compact = window.matchMedia('(max-width: 600px), (max-width: 1000px) and (max-height: 500px)');
    let selectedId = null, baseline = '', mode = 'write', mutating = false, previewSource = null, previewHeading = null;
    const notes = () => api.getSession()?.adventureNotes || [];
    const find = id => notes().find(note => note.id === id);
    const el = (tag, className, text, id) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      if (id) element.id = id;
      return element;
    };
    const icon = name => { const span = el('span', 'adventure-action-icon'); span.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`; return span; };
    const button = (id, label, className, symbol) => {
      const element = el('button', className, undefined, id); element.type = 'button';
      element.setAttribute('aria-label', t(label)); element.title = t(label);
      element.append(symbol ? icon(symbol) : el('span', '', t(label)));
      return element;
    };
    const editorOnly = element => { element.setAttribute('data-editor-only', ''); return element; };

    const header = el('header', 'log-header');
    const back = button('adventure-back', 'All notes', 'log-back', 'chevron'); back.append(el('span', '', t('All notes')));
    const headingCopy = el('div', 'log-heading-copy');
    const heading = el('h2', '', t('Adventure notes'), 'adventure-heading');
    const summary = el('p', 'adventure-summary', '', 'adventure-summary'); headingCopy.append(heading, summary);
    const headerActions = el('div', 'log-header-actions');
    const add = editorOnly(button('adventure-add', 'Add note', 'button primary log-action-icon', 'plus'));
    const closeButton = button('adventure-close', 'Close adventure notes', 'icon-button close-button', 'close');
    headerActions.append(add, closeButton); header.append(back, headingCopy, headerActions);

    const syncNotice = el('div', 'dialog-sync-notice adventure-sync-notice');
    syncNotice.setAttribute('data-dialog-sync-notice', ''); syncNotice.setAttribute('role', 'status'); syncNotice.hidden = true;
    const syncActions = el('div');
    for (const [action, label, style] of [
      ['download', 'Download local changes', 'subtle'], ['latest', 'Load latest campaign', 'primary'],
      ['retry', 'Retry connection', 'subtle'], ['signin', 'Sign in', 'primary']
    ]) { const control = button('', label, `button ${style}`); control.setAttribute(`data-campaign-${action}`, ''); syncActions.append(control); }
    syncNotice.append(el('p'), syncActions);

    const body = el('div', 'log-body');
    const list = el('nav', 'log-days adventure-list', undefined, 'adventure-list'); list.setAttribute('aria-label', t('Adventure notes'));
    const empty = el('div', 'log-empty adventure-empty', undefined, 'adventure-empty');
    const emptyIcon = el('div', 'adventure-empty-icon'); emptyIcon.append(icon('book')); emptyIcon.setAttribute('aria-hidden', 'true');
    const emptyCopy = el('p', '', '', 'adventure-empty-copy');
    const emptyAdd = editorOnly(button('adventure-empty-add', 'Add your first note', 'button primary'));
    empty.append(emptyIcon, el('h3', '', t('Your campaign reference.')), emptyCopy, emptyAdd);

    const editor = el('section', 'log-editor adventure-editor', undefined, 'adventure-editor'); editor.hidden = true;
    editor.setAttribute('aria-label', t('Adventure note'));
    const form = el('form', 'adventure-form', undefined, 'adventure-form'); form.noValidate = true;
    const toolbar = editorOnly(el('div', 'adventure-editor-toolbar', undefined, 'adventure-editor-toolbar'));
    const tabs = el('div', 'adventure-view-switch'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', t('Note view'));
    const write = button('adventure-write', 'Write', 'adventure-view-button');
    const previewButton = button('adventure-show-preview', 'Preview', 'adventure-view-button'); tabs.append(write, previewButton);
    const actions = el('div', 'log-edit-actions');
    const remove = button('adventure-delete', 'Delete note', 'button danger-button log-action-icon', 'trash');
    const save = button('adventure-save', 'Save note', 'button primary'); save.type = 'submit'; actions.append(remove, save);
    toolbar.append(tabs, actions);
    const error = el('p', 'form-error', '', 'adventure-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const fields = el('div', 'adventure-write-fields', undefined, 'adventure-write-fields');
    const titleLabel = el('label', 'form-label', t('Title')); titleLabel.htmlFor = 'adventure-title';
    const title = el('input', '', undefined, 'adventure-title'); title.type = 'text'; title.maxLength = 160; title.required = true; title.autocomplete = 'off'; title.placeholder = t('Give this note a title');
    const contentLabel = el('label', 'form-label', t('Note')); contentLabel.htmlFor = 'adventure-body';
    const content = el('textarea', '', undefined, 'adventure-body'); content.rows = 16; content.maxLength = 50000; content.placeholder = t('Record discoveries, people, places, or plans.');
    const help = el('p', 'form-help', t('Markdown supported: headings, lists, links, and tables.'), 'adventure-markdown-help');
    content.setAttribute('aria-describedby', help.id); fields.append(titleLabel, title, contentLabel, content, help);
    const rendered = el('div', 'adventure-rendered', undefined, 'adventure-rendered');
    const renderedTitle = el('h3', 'adventure-document-title', '', 'adventure-preview-title');
    const preview = el('article', 'adventure-markdown', '', 'adventure-preview'); rendered.append(renderedTitle, preview);
    form.append(toolbar, error, fields, rendered); editor.append(form); body.append(list, empty, editor); dialog.replaceChildren(header, syncNotice, body);
    dialog.setAttribute('aria-labelledby', heading.id);

    const values = () => JSON.stringify({ title: title.value, body: content.value });
    const dirty = () => !editor.hidden && values() !== baseline;
    function showError(message = '') { error.textContent = message; error.hidden = !message; }
    function updateNavigation() {
      dialog.dataset.logView = editor.hidden ? 'list' : 'detail';
      heading.textContent = compact.matches && !editor.hidden ? t('Note') : t('Adventure notes');
    }
    function renderPreview() {
      const nextHeading = title.value.trim() || t('Untitled note');
      if (previewHeading !== nextHeading) { renderedTitle.textContent = nextHeading; previewHeading = nextHeading; }
      if (previewSource === content.value) return;
      if (content.value.trim()) preview.innerHTML = window.CampaignMarkdown.render(content.value);
      else preview.replaceChildren(el('p', 'adventure-no-content', t('No content yet.')));
      previewSource = content.value;
    }
    function renderMode() {
      const editable = canEdit(), showingPreview = !editable || mode === 'preview';
      toolbar.hidden = !editable; fields.hidden = showingPreview; rendered.hidden = !showingPreview;
      write.setAttribute('aria-pressed', String(!showingPreview)); previewButton.setAttribute('aria-pressed', String(showingPreview));
      for (const control of [write, previewButton, save, remove]) control.disabled = !editable;
      title.readOnly = !editable; content.readOnly = !editable;
      remove.hidden = !selectedId;
      if (showingPreview) renderPreview();
    }
    function renderList() {
      const focusedRow = document.activeElement?.closest?.('button[data-note-id]');
      const focusedId = focusedRow && list.contains(focusedRow) ? focusedRow.dataset.noteId : null;
      const fragment = document.createDocumentFragment();
      for (const note of notes()) {
        const row = el('button', 'adventure-list-item'); row.type = 'button'; row.dataset.noteId = note.id;
        row.setAttribute('aria-current', note.id === selectedId ? 'true' : 'false');
        const excerpt = note.body.replace(/[#*_~`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
        row.append(el('strong', '', note.title), el('span', '', excerpt || t('No content yet.')));
        row.addEventListener('click', async () => {
          if (!await leaveDraft()) return;
          const current = find(note.id); if (!current) { refresh(); return; }
          select(current); editor.scrollTop = 0;
          if (compact.matches) back.focus({ preventScroll: true });
        });
        fragment.append(row);
      }
      list.replaceChildren(fragment);
      if (focusedId) {
        const rows = [...list.querySelectorAll('button')];
        const nextFocus = rows.find(row => row.dataset.noteId === focusedId) || rows.find(row => row.dataset.noteId === selectedId) || closeButton;
        nextFocus.focus({ preventScroll: true });
      }
      const count = notes().length;
      summary.textContent = count ? t(count === 1 ? '{count} shared note' : '{count} shared notes', { count: I.number(count) }) : t('Shared knowledge for the journey.');
      empty.hidden = count > 0 || !editor.hidden;
      add.disabled = !canEdit() || count >= 200 || !api.getSession();
    }
    function select(note, nextMode = 'write') {
      selectedId = note?.id || null; title.value = note?.title || ''; content.value = note?.body || '';
      baseline = values(); mode = nextMode; editor.hidden = false; empty.hidden = true;
      showError(); updateNavigation(); renderList(); renderMode();
    }
    function showList(focus = false) {
      editor.hidden = true; updateNavigation(); renderList();
      if (focus) {
        const row = [...list.querySelectorAll('button')].find(item => item.dataset.noteId === selectedId);
        (row || (canEdit() ? add : closeButton)).focus({ preventScroll: true });
      }
    }
    async function leaveDraft() {
      return !dirty() || api.ask(t('Discard unsaved note?'), t('This note has changes that have not been saved. Keep editing to save them first.'), t('Discard changes'), t('Keep editing'));
    }
    async function addNote() {
      if (!canEdit() || !api.getSession()) return;
      if (notes().length >= 200) { api.toast(t('An expedition can have up to 200 adventure notes.')); return; }
      if (!await leaveDraft() || !canEdit()) return;
      select(null); title.focus({ preventScroll: true });
    }
    function updateAccess() {
      add.hidden = !canEdit(); emptyAdd.hidden = !canEdit(); emptyAdd.disabled = !canEdit() || !api.getSession();
      emptyCopy.textContent = canEdit() ? t('Keep discoveries, people, and plans together. Notes are shared with everyone following the campaign.') : t('Shared notes will appear here as the campaign develops.');
      renderList(); renderMode();
    }
    function refresh() {
      if (!dialog.open) return;
      renderList(); if (mutating || dirty()) return;
      if (compact.matches && editor.hidden) return;
      const selected = find(selectedId);
      if (selected) {
        if (editor.hidden || selected.title !== title.value || selected.body !== content.value) select(selected, mode);
      }
      else if (selectedId || editor.hidden) {
        const first = notes()[0];
        if (first && !compact.matches) select(first);
        else { selectedId = null; showList(); }
      }
    }
    function open() {
      if (dialog.open) { refresh(); return; }
      api.openDialog('notes-dialog'); $('open-notes').setAttribute('aria-expanded', 'true');
      updateAccess();
      const selected = find(selectedId) || notes()[0];
      if (compact.matches) showList();
      else if (selected) select(selected);
      else { selectedId = null; showList(); }
      closeButton.focus({ preventScroll: true });
    }
    async function close() {
      if (!await leaveDraft()) return;
      dialog.close(); $('open-notes').setAttribute('aria-expanded', 'false'); $('open-notes').focus({ preventScroll: true });
    }
    function saveNote() {
      if (!canEdit() || !api.getSession()) return false;
      const name = title.value.trim();
      if (!name || name.length > 160) { mode = 'write'; renderMode(); showError(t('Enter a note title of 1 to 160 characters.')); title.focus(); return false; }
      if (content.value.length > 50000) { mode = 'write'; renderMode(); showError(t('Keep each note within 50,000 characters.')); content.focus(); return false; }
      const old = find(selectedId);
      if (selectedId && !old) { showError(t('This note was removed from the shared campaign. Download your local changes before loading the latest campaign.')); return false; }
      if (!old && notes().length >= 200) { showError(t('An expedition can have up to 200 adventure notes.')); return false; }
      if (old && old.title === name && old.body === content.value) { select(old, mode); return true; }
      const now = new Date().toISOString();
      const note = { id: old?.id || `note-${api.core.freshSession().id}`, title: name, body: content.value, createdAt: old?.createdAt || now, updatedAt: now };
      let changed;
      mutating = true;
      try {
        changed = api.mutate(() => {
          const session = api.getSession(), current = session.adventureNotes || [];
          session.adventureNotes = old ? current.map(item => item.id === note.id ? note : item) : [note, ...current];
        });
      } catch (cause) { showError(I.text(cause.message)); return false; }
      finally { mutating = false; }
      if (changed === false) { showError(t('This note could not be saved. Your changes are kept here.')); return false; }
      select(note, mode); api.toast(t('Note saved.')); return true;
    }
    async function deleteNote() {
      if (!canEdit()) return;
      const old = find(selectedId); if (!old) return;
      if (!await api.ask(t('Remove “{title}”?', { title: old.title }), t('Remove this note and its contents? Undo can restore it.'), t('Remove note')) || !canEdit()) return;
      let changed;
      mutating = true;
      try { changed = api.mutate(() => { api.getSession().adventureNotes = notes().filter(note => note.id !== old.id); }); }
      catch (cause) { showError(I.text(cause.message)); return; }
      finally { mutating = false; }
      if (changed === false) { showError(t('This note could not be removed. Try again when editing is available.')); return; }
      selectedId = null; editor.hidden = true; baseline = ''; title.value = ''; content.value = '';
      if (!compact.matches && notes().length) select(notes()[0]); else showList(true);
      api.toast(t('Note removed. Undo restores it.'));
    }

    $('open-notes').addEventListener('click', open);
    add.addEventListener('click', addNote); emptyAdd.addEventListener('click', addNote);
    closeButton.addEventListener('click', close);
    back.addEventListener('click', async () => { if (await leaveDraft()) showList(true); });
    dialog.addEventListener('cancel', async event => { event.preventDefault(); if (compact.matches && !editor.hidden) { if (await leaveDraft()) showList(true); } else await close(); });
    form.addEventListener('submit', event => { event.preventDefault(); saveNote(); });
    remove.addEventListener('click', deleteNote);
    write.addEventListener('click', () => { if (canEdit()) { mode = 'write'; renderMode(); } });
    previewButton.addEventListener('click', () => { if (canEdit()) { mode = 'preview'; renderMode(); } });
    for (const field of [title, content]) field.addEventListener('input', () => showError());
    compact.addEventListener('change', () => {
      if (!dialog.open) return;
      if (!compact.matches && editor.hidden && notes().length) select(find(selectedId) || notes()[0]);
      updateNavigation();
    });
    const hasDraft = () => dialog.open && dirty();
    window.addEventListener('beforeunload', event => { if (hasDraft()) { event.preventDefault(); event.returnValue = ''; } });
    updateAccess(); updateNavigation();
    return { open, refresh, updateAccess, hasDraft,
      getDrafts: () => dialog.open && !editor.hidden ? { id: selectedId, ...JSON.parse(values()) } : null,
      reset() { selectedId = null; title.value = ''; content.value = ''; baseline = values(); mode = 'write'; showError(); showList(); }
    };
  }
})();
