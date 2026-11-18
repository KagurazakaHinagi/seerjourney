/* Trip-day editors share the atlas session and its undo/autosave boundary. */
(function () {
  'use strict';
  const t = window.MapJourneyI18n.t, number = window.MapJourneyI18n.number;
  window.MapJourneyGameLog = { create };

  function create(api) {
    const C = api.core, $ = id => document.getElementById(id);
    const canEdit = api.canEdit || (() => false);
    const compactLayout = window.matchMedia('(max-width: 600px), (max-width: 1000px) and (max-height: 500px)');
    let selectedId = null, baseline = '', tripId = null, tripHex = null, tripContextHex = null;
    let placementId = null, saving = false, logAttachments = [], tripAttachments = [], snapshotView = null;
    const uploads = { log: { busy: false, generation: 0, status: '' }, trip: { busy: false, generation: 0, status: '' } };
    const cloneImages = images => (images || []).map(image => ({ ...image }));
    const imageCount = count => t(count === 1 ? '{count} image' : '{count} images', { count: number(count) });
    const entries = () => C.sortTripDays(api.getSession().tripDays);
    const entryById = id => api.getSession().tripDays.find(entry => entry.id === id);
    const participantEditors = Object.fromEntries(['log', 'trip'].map(context => [context, window.MapJourneyParticipants.create({
      container: $(`${context}-participants`), core: C, canEdit,
      getSuggestions: () => C.participantNames(api.getSession()?.tripDays || [])
    })]));
    const supplyEditors = Object.fromEntries(['log', 'trip'].map(context => [context, window.MapJourneySupplyFields.create({
      root: $(`${context}-supplies`), prefix: context, canEdit,
      getTripDays: () => api.getSession()?.tripDays || [], getDay: () => C.parseTripDay($(`${context}-day`).value),
      getEntryId: () => context === 'log' ? selectedId : tripId
    })]));
    const values = () => JSON.stringify({ day: $('log-day').value, note: $('log-note').value, attachments: logAttachments, ...participantEditors.log.getDraft(), supplies: supplyEditors.log.getDraft() });
    const dirty = () => !$('log-editor').hidden && (uploads.log.busy || values() !== baseline);
    const newId = () => `day-${C.freshSession().id}`;

    function error(id, message = '') {
      $(id).textContent = message;
      $(id).hidden = !message;
    }

    function renderImages(context) {
      const images = context === 'log' ? logAttachments : tripAttachments, upload = uploads[context];
      const section = $(`${context}-images`), gallery = $(`${context}-image-list`);
      section.hidden = !canEdit() && !images.length && !upload.busy;
      section.setAttribute('aria-busy', String(upload.busy));
      $(`${context}-image-count`).textContent = canEdit() ? t('{count} of {max}', { count: number(images.length), max: number(12) }) : imageCount(images.length);
      $(`${context}-image-add`).hidden = !canEdit();
      $(`${context}-image-add`).disabled = !canEdit() || upload.busy || images.length >= 12;
      $(`${context}-image-file`).disabled = !canEdit() || upload.busy;
      $(`${context}-save`).disabled = !canEdit() || upload.busy;
      $(`${context}-delete`).disabled = !canEdit() || upload.busy;
      $(`${context}-image-status`).textContent = upload.status;
      $(`${context}-image-status`).hidden = !upload.status;
      const fragment = document.createDocumentFragment();
      for (const image of [...images].sort((a, b) => C.compareNames(a.name, b.name))) {
        const figure = document.createElement('figure'); figure.className = 'day-image';
        const link = document.createElement('a'); link.className = 'day-image-open'; link.href = image.url;
        link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', t('Open image: {name}', { name: image.name }));
        const preview = document.createElement('img'); preview.src = image.url; preview.alt = image.name;
        preview.loading = 'lazy'; preview.decoding = 'async'; preview.width = image.width; preview.height = image.height;
        preview.addEventListener('error', () => { preview.hidden = true; figure.classList.add('image-unavailable'); });
        const missing = document.createElement('span'); missing.className = 'day-image-unavailable'; missing.textContent = t('Preview unavailable · open image');
        link.append(preview, missing);
        const caption = document.createElement('figcaption'); caption.textContent = image.name; caption.title = image.name;
        figure.append(link, caption);
        if (canEdit()) {
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button day-image-remove'; remove.disabled = upload.busy;
          remove.setAttribute('data-editor-only', '');
          remove.setAttribute('aria-label', t('Remove image: {name}', { name: image.name })); remove.title = t('Remove image');
          remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
          remove.addEventListener('click', () => {
            if (!canEdit() || upload.busy) return;
            if (context === 'log') logAttachments = logAttachments.filter(item => item.id !== image.id);
            else tripAttachments = tripAttachments.filter(item => item.id !== image.id);
            upload.status = ''; renderImages(context);
          });
          figure.append(remove);
        }
        fragment.append(figure);
      }
      gallery.replaceChildren(fragment);
      gallery.hidden = !images.length;
    }

    function uploadMessage(progress) {
      const stage = typeof progress === 'string' ? progress : progress?.stage;
      if (stage === 'compressing') return t('Compressing image…');
      if (stage === 'confirming') return t('Finishing image upload…');
      if (stage === 'uploading') return Number.isFinite(progress?.percent) ? t('Uploading image… {percent}%', { percent: number(Math.round(progress.percent)) }) : t('Uploading image…');
      return t('Preparing image…');
    }

    async function addImages(context, fileList) {
      const upload = uploads[context];
      if (!canEdit() || upload.busy) return;
      const images = context === 'log' ? logAttachments : tripAttachments;
      const files = Array.from(fileList || []);
      if (!files.length) return;
      if (files.length + images.length > 12) {
        error(`${context}-image-error`, t('Keep each day within 12 images. Remove an image before adding more.')); return;
      }
      if (!window.CampaignImages?.upload) { error(`${context}-image-error`, t('Image uploads are unavailable. Reload the page and try again.')); return; }
      const generation = upload.generation;
      upload.busy = true; upload.status = t('Preparing image…'); error(`${context}-image-error`); renderImages(context);
      try {
        for (const file of files) {
          if (generation !== upload.generation) break;
          if (!canEdit()) throw new Error(t('Sign in again before adding more images. Your uploaded images are kept in this draft.'));
          const image = await window.CampaignImages.upload(file, { onProgress: progress => {
            if (generation !== upload.generation) return;
            upload.status = uploadMessage(progress);
            $(`${context}-image-status`).textContent = upload.status;
            $(`${context}-image-status`).hidden = false;
          } });
          if (generation !== upload.generation) break;
          if (context === 'log') logAttachments.push(image);
          else tripAttachments.push(image);
          renderImages(context);
        }
        if (generation === upload.generation) upload.status = t('Images uploaded. Save this day to share them.');
      } catch (cause) {
        if (generation === upload.generation) {
          upload.status = '';
          error(`${context}-image-error`, window.MapJourneyI18n.text(cause.message || t('The image could not be uploaded. Try again.')));
        }
      } finally {
        if (generation === upload.generation) { upload.busy = false; renderImages(context); }
      }
    }

    function uploading(context) {
      if (!uploads[context].busy) return false;
      api.toast(t('Wait for the image upload to finish before leaving this day.'));
      return true;
    }

    function validate(dayInput, noteInput, id, errorId) {
      const day = C.parseTripDay(dayInput.value);
      dayInput.setCustomValidity('');
      if (!id && api.getSession().tripDays.length >= 10000) {
        error(errorId, t('This expedition has reached 10,000 days. Edit an existing day or save a backup and start another expedition.'));
        return null;
      }
      if (day === null) {
        const message = t('Enter a whole-number trip day of 0 or greater.');
        dayInput.setCustomValidity(message); error(errorId, message); dayInput.focus(); return null;
      }
      if (entries().some(entry => entry.day === day && entry.id !== id)) {
        error(errorId, t('Day {day} already exists. Choose another day, or edit that entry.', { day: number(day) }));
        dayInput.focus(); return null;
      }
      if (noteInput.value.length > 20000) {
        error(errorId, t('Keep daily notes within 20,000 characters.')); return null;
      }
      error(errorId);
      return { day, note: noteInput.value };
    }

    function validateSupplies(days, errorId) {
      try {
        const issue = window.MapJourneySuppliesCore.ledger(days).errors[0];
        if (issue) {
          error(errorId, t(issue.resource === 'food'
            ? 'Day {day} needs {requested} lbs of food, but only {available} lbs is unexpired. Reduce consumption or correct earlier supplies.'
            : 'Day {day} needs {requested} gals of water, but only {available} gals is available. Reduce consumption or correct earlier supplies.',
          { day: number(issue.day), requested: number(issue.requested), available: number(issue.available) }));
          return false;
        }
        return true;
      } catch (cause) { error(errorId, window.MapJourneyI18n.text(cause.message)); return false; }
    }

    function suppliesValue(context) {
      try { return supplyEditors[context].getValue(); }
      catch (cause) { error(`${context}-error`, window.MapJourneyI18n.text(cause.message)); return null; }
    }

    function locationText(hex) {
      return hex ? C.label(C.parseKey(hex, api.grid)) : t('No map location');
    }

    function renderList() {
      const days = entries(), fragment = document.createDocumentFragment();
      let expectedDay = 0, selectedButton = null;
      for (const entry of days) {
        if (entry.day > expectedDay) {
          const gap = document.createElement('p'); gap.className = 'log-day-gap';
          gap.textContent = entry.day - expectedDay === 1 ? t('Day {day} unrecorded', { day: number(expectedDay) }) : t('Days {firstDay}–{lastDay} unrecorded', { firstDay: number(expectedDay), lastDay: number(entry.day - 1) });
          fragment.append(gap);
        }
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'log-day-item';
        button.dataset.dayId = entry.id;
        button.setAttribute('aria-current', entry.id === selectedId ? 'true' : 'false');
        if (entry.id === selectedId) selectedButton = button;
        const heading = document.createElement('strong'); heading.textContent = t('Day {day}', { day: number(entry.day) });
        const detail = document.createElement('span');
        detail.textContent = entry.note.trim().replace(/\s+/g, ' ').slice(0, 90) || (entry.attachments?.length ? imageCount(entry.attachments.length) : entry.hex ? t('Map stop recorded') : t('No notes yet'));
        button.append(heading, detail);
        button.addEventListener('click', async () => {
          if (!await leaveDraft()) return;
          select(entryById(entry.id));
          $('log-editor').scrollTop = 0;
          if (compactLayout.matches) $('log-back').focus({ preventScroll: true });
        });
        fragment.append(button); expectedDay = entry.day + 1;
      }
      $('log-days').replaceChildren(fragment);
      selectedButton?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      $('log-summary').textContent = days.length ? t(days.length === 1 ? '{count} entry · Day 0 to Day {lastDay}' : '{count} entries · Day 0 to Day {lastDay}', { count: number(days.length), lastDay: number(days.at(-1).day) }) : t('The expedition starts at Day 0');
      $('log-gap-summary').hidden = !canEdit();
      $('log-gap-summary').textContent = days.length && days.some((entry, i) => entry.day !== i) ? t('Unrecorded days are kept as gaps. Edit a day number to move its entry.') : t('Edit a day number to reorganize your journey.');
    }

    function clearSnapshot() {
      snapshotView?.disposeMapTiles?.(); snapshotView = null;
      $('log-snapshot').replaceChildren();
    }

    function renderSnapshot(entry) {
      clearSnapshot();
      const snapshot = entry?.hex ? api.createSnapshot(entry) : null;
      snapshotView = snapshot;
      $('log-snapshot').replaceChildren(...(snapshot ? [snapshot] : []));
      $('log-snapshot').hidden = !snapshot;
      $('log-snapshot-caption').textContent = snapshot ? t('Day {day} · {location}', { day: number(entry.day), location: locationText(entry.hex) }) : canEdit() ? t('Add a map location to include this day in your route.') : t('No map location was recorded for this day.');
      $('log-location').textContent = locationText(entry?.hex);
      $('log-remove-location').hidden = !entry?.hex;
      $('log-place-map').disabled = !entry;
      $('log-place-map').title = entry ? t('Choose this day’s location on the map') : t('Save this day before placing it on the map');
    }

    function updateNavigation() {
      const detail = !$('log-editor').hidden;
      $('log-dialog').dataset.logView = detail ? 'detail' : 'list';
      $('log-heading').textContent = compactLayout.matches && detail
        ? (selectedId ? t('Day {day}', { day: number(entryById(selectedId)?.day ?? $('log-day').value) }) : t('New day'))
        : t('Game log');
    }

    function showList(focus = false) {
      clearSnapshot();
      $('log-editor').hidden = true;
      $('log-empty').hidden = entries().length > 0;
      updateNavigation(); renderList();
      if (focus) {
        const row = [...$('log-days').querySelectorAll('button')].find(button => button.dataset.dayId === selectedId);
        (row || $('log-add')).focus({ preventScroll: true });
      }
    }

    async function backToList() {
      if (await leaveDraft()) showList(true);
    }

    function select(entry) {
      uploads.log.generation++;
      uploads.log.status = '';
      logAttachments = cloneImages(entry?.attachments);
      participantEditors.log.setValue(entry?.participants);
      selectedId = entry?.id || null;
      $('log-empty').hidden = true; $('log-editor').hidden = false;
      $('log-day').value = String(entry ? entry.day : C.nextTripDay(entries()));
      $('log-note').value = entry?.note || '';
      supplyEditors.log.setValue(entry?.supplies);
      $('log-day').setCustomValidity(''); error('log-error'); error('log-image-error');
      $('log-delete').hidden = !entry;
      baseline = values();
      $('log-save-label').textContent = entry ? t('Save changes') : '';
      $('log-save-label').hidden = !entry;
      if (entry) $('log-save-icon').setAttribute('hidden', '');
      else $('log-save-icon').removeAttribute('hidden');
      $('log-save').classList.toggle('log-action-icon', !entry);
      $('log-save').setAttribute('aria-label', entry ? t('Save changes') : t('Add day'));
      $('log-save').title = entry ? t('Save changes') : t('Add day');
      updateNavigation(); renderList(); renderSnapshot(entry); renderImages('log');
    }

    async function leaveDraft() {
      if (uploading('log')) return false;
      if (!dirty()) return true;
      return api.ask(t('Discard unsaved notes?'), t('This entry has changes that have not been saved. Keep editing to save them first.'), t('Discard changes'), t('Keep editing'));
    }

    async function addDay() {
      if (!canEdit()) return;
      if (!await leaveDraft()) return;
      select(null); $('log-day').focus({ preventScroll: true });
    }

    function refresh() {
      if ($('trip-dialog').open && !uploads.trip.busy && tripValues() === tripBaseline) {
        const entry = entryById(tripId);
        if (entry) fillTrip(entry, entry.hex);
        else if (tripId) $('trip-dialog').close();
      }
      if (!$('log-dialog').open) return;
      renderList();
      if (saving || dirty()) return;
      if (compactLayout.matches && $('log-editor').hidden) { showList(); return; }
      const selected = entryById(selectedId);
      if (selected) select(selected);
      else if (selectedId) {
        const first = entries()[0];
        if (first) select(first);
        else { selectedId = null; showList(); }
      }
    }

    function open() {
      if (uploading('log')) return;
      api.openDialog('log-dialog');
      $('open-log').setAttribute('aria-expanded', 'true');
      const days = entries(), selected = entryById(selectedId) || days[0];
      if (compactLayout.matches) showList();
      else if (selected) select(selected);
      else { selectedId = null; showList(); }
      $('log-close').focus({ preventScroll: true });
    }

    async function openDay(id = null, day = null) {
      if ($('log-dialog').open && !await leaveDraft()) return false;
      if ($('trip-dialog').open && !await leaveTripDraft()) return false;
      const entry = entryById(id);
      if (!entry && !canEdit()) return false;
      if ($('trip-dialog').open) $('trip-dialog').close();
      api.openDialog('log-dialog'); $('open-log').setAttribute('aria-expanded', 'true');
      select(entry);
      if (!entry && Number.isSafeInteger(day) && day >= 0) { $('log-day').value = String(day); supplyEditors.log.refresh(); baseline = values(); }
      $('log-editor').scrollTop = 0;
      (compactLayout.matches ? $('log-back') : $('log-close')).focus({ preventScroll: true });
      return true;
    }

    function close() {
      clearSnapshot();
      $('log-dialog').close();
      $('open-log').setAttribute('aria-expanded', 'false');
      $('open-log').focus({ preventScroll: true });
    }

    async function requestClose() { if (await leaveDraft()) close(); }

    function saveEditor() {
      if (!canEdit() || uploading('log')) return false;
      const result = validate($('log-day'), $('log-note'), selectedId, 'log-error');
      if (!result || !participantEditors.log.commitPending()) return false;
      const supplies = suppliesValue('log'); if (!supplies) return false;
      const old = entryById(selectedId);
      const entry = { ...old, id: old?.id || newId(), ...result, hex: old?.hex || null, attachments: cloneImages(logAttachments), participants: participantEditors.log.getValue(), supplies };
      const days = C.sortTripDays([...api.getSession().tripDays.filter(day => day.id !== entry.id), entry]);
      if (!validateSupplies(days, 'log-error')) return false;
      saving = true;
      let changed;
      try { changed = api.mutate(() => { api.getSession().tripDays = days; }); }
      catch (cause) { error('log-error', window.MapJourneyI18n.text(cause.message)); return false; }
      finally { saving = false; }
      if (changed === false && (!canEdit() || JSON.stringify(old) !== JSON.stringify(entry))) { error('log-error', t('The day could not be saved. Your changes are kept here.')); return false; }
      select(entry);
      api.toast(t('Day {day} saved.', { day: number(entry.day) }));
      return true;
    }

    function renderTileDays() {
      const fragment = document.createDocumentFragment();
      const days = entries().filter(entry => entry.hex === tripContextHex && tripContextHex);
      for (const entry of days) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'trip-day-choice'; button.dataset.dayId = entry.id;
        button.textContent = t('Day {day}', { day: number(entry.day) });
        button.setAttribute('aria-pressed', String(entry.id === tripId));
        button.addEventListener('click', async () => {
          if (await leaveTripDraft()) fillTrip(entryById(entry.id), tripContextHex);
        });
        fragment.append(button);
      }
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'trip-day-choice'; add.textContent = t('New day');
      add.setAttribute('aria-pressed', String(!tripId));
      add.addEventListener('click', async () => { if (await leaveTripDraft()) fillTrip(null, tripContextHex); });
      if (canEdit()) fragment.append(add);
      $('trip-days').replaceChildren(fragment); $('trip-days').hidden = !days.length;
    }

    let tripBaseline = '';
    const tripValues = () => JSON.stringify({ day: $('trip-day').value, note: $('trip-note').value, hex: tripHex, attachments: tripAttachments, ...participantEditors.trip.getDraft(), supplies: supplyEditors.trip.getDraft() });
    async function leaveTripDraft() {
      if (uploading('trip')) return false;
      return tripValues() === tripBaseline || api.ask(t('Discard unsaved day changes?'), t('Save this day before switching entries, or discard the current changes.'), t('Discard changes'), t('Keep editing'));
    }

    function fillTrip(entry, hex) {
      uploads.trip.generation++;
      uploads.trip.status = '';
      tripAttachments = cloneImages(entry?.attachments);
      participantEditors.trip.setValue(entry?.participants);
      tripId = entry?.id || null;
      tripHex = hex || entry?.hex || null;
      $('trip-dialog-title').textContent = entry ? t(canEdit() ? 'Edit Day {day}' : 'Day {day}', { day: number(entry.day) }) : t('Log this day');
      $('trip-cancel').textContent = canEdit() ? t('Cancel') : t('Close');
      $('trip-day').value = String(entry ? entry.day : C.nextTripDay(entries()));
      $('trip-note').value = entry?.note || '';
      supplyEditors.trip.setValue(entry?.supplies);
      $('trip-day').setCustomValidity(''); error('trip-error'); error('trip-image-error');
      $('trip-location').textContent = locationText(tripHex);
      $('trip-remove-location').hidden = !tripHex;
      $('trip-delete').hidden = !entry;
      $('trip-save').textContent = entry ? t('Save changes') : t('Add day');
      tripBaseline = tripValues(); renderTileDays(); renderImages('trip');
    }

    function openTrip(hex, id = null) {
      if (uploading('trip')) return;
      const entry = entryById(id || placementId) || (!canEdit() ? entries().find(day => day.hex === hex?.key) : null);
      if (!entry && !canEdit()) return;
      placementId = null;
      tripContextHex = hex?.key || entry?.hex || null;
      fillTrip(entry, tripContextHex);
      api.openDialog('trip-dialog');
      $('trip-dialog').focus({ preventScroll: true });
    }

    async function deleteEntry(id, fromTrip = false) {
      if (!canEdit() || uploading(fromTrip ? 'trip' : 'log')) return;
      const entry = entryById(id);
      if (!entry || !await api.ask(t('Remove Day {day}?', { day: number(entry.day) }), t('Remove its notes and map stop. Other day numbers will stay unchanged. Undo can restore this entry.'), t('Remove day'))) return;
      if (!canEdit()) return;
      const days = api.getSession().tripDays.filter(day => day.id !== id);
      if (!validateSupplies(days, fromTrip ? 'trip-error' : 'log-error')) return;
      saving = true;
      let changed;
      try { changed = api.mutate(() => { api.getSession().tripDays = days; }); }
      catch (cause) { error(fromTrip ? 'trip-error' : 'log-error', window.MapJourneyI18n.text(cause.message)); return; }
      finally { saving = false; }
      if (changed === false) { error(fromTrip ? 'trip-error' : 'log-error', t('The day could not be removed. Try again when editing is available.')); return; }
      if (fromTrip) $('trip-dialog').close();
      if ($('log-dialog').open) {
        const days = entries();
        if (compactLayout.matches) { selectedId = null; showList(true); }
        else if (days.length) select(days.find(day => day.day >= entry.day) || days.at(-1));
        else { selectedId = null; showList(); }
      }
      api.toast(t('Day {day} removed. Undo restores it.', { day: number(entry.day) }));
    }

    $('open-log').addEventListener('click', open);
    $('log-back').addEventListener('click', backToList);
    $('log-close').addEventListener('click', requestClose);
    $('log-dialog').addEventListener('close', clearSnapshot);
    $('log-dialog').addEventListener('cancel', event => {
      event.preventDefault();
      if (compactLayout.matches && !$('log-editor').hidden) backToList();
      else requestClose();
    });
    compactLayout.addEventListener('change', () => {
      if (!$('log-dialog').open) return;
      if (!compactLayout.matches && $('log-editor').hidden) {
        const entry = entryById(selectedId) || entries()[0];
        if (entry) select(entry);
      }
      updateNavigation();
    });
    $('log-add').addEventListener('click', addDay);
    $('log-empty-add').addEventListener('click', addDay);
    $('log-form').addEventListener('submit', event => { event.preventDefault(); saveEditor(); });
    $('log-delete').addEventListener('click', () => deleteEntry(selectedId));
    $('log-day').addEventListener('input', () => { $('log-day').setCustomValidity(''); error('log-error'); supplyEditors.log.refresh(); });
    $('log-note').addEventListener('input', () => error('log-error'));
    $('log-place-map').addEventListener('click', () => {
      if (!saveEditor()) return;
      placementId = selectedId; close(); api.placeOnMap();
      api.toast(t('Choose a tile for Day {day}.', { day: number(entryById(placementId).day) }));
    });
    $('log-remove-location').addEventListener('click', () => {
      if (!saveEditor()) return;
      api.mutate(() => { entryById(selectedId).hex = null; });
      select(entryById(selectedId));
    });
    const tripDialog = $('trip-dialog');
    async function requestTripClose() { if (await leaveTripDraft()) tripDialog.close(); }
    $('trip-cancel').addEventListener('click', requestTripClose);
    tripDialog.addEventListener('cancel', event => { event.preventDefault(); return requestTripClose(); });
    $('trip-delete').addEventListener('click', () => deleteEntry(tripId, true));
    $('trip-remove-location').addEventListener('click', () => {
      if (!canEdit()) return;
      tripHex = null; $('trip-location').textContent = locationText(null); $('trip-remove-location').hidden = true;
    });
    $('trip-day').addEventListener('input', () => { $('trip-day').setCustomValidity(''); error('trip-error'); supplyEditors.trip.refresh(); });
    $('trip-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!canEdit() || uploading('trip')) return;
      const result = validate($('trip-day'), $('trip-note'), tripId, 'trip-error');
      if (!result || !participantEditors.trip.commitPending()) return;
      const supplies = suppliesValue('trip'); if (!supplies) return;
      const old = entryById(tripId);
      const entry = { ...old, id: tripId || newId(), ...result, hex: tripHex, attachments: cloneImages(tripAttachments), participants: participantEditors.trip.getValue(), supplies };
      const days = C.sortTripDays([...api.getSession().tripDays.filter(day => day.id !== entry.id), entry]);
      if (!validateSupplies(days, 'trip-error')) return;
      let changed;
      try { changed = api.mutate(() => { api.getSession().tripDays = days; }); }
      catch (cause) { error('trip-error', window.MapJourneyI18n.text(cause.message)); return; }
      if (changed === false && (!canEdit() || JSON.stringify(old) !== JSON.stringify(entry))) { error('trip-error', t('The day could not be saved. Your changes are kept here.')); return; }
      $('trip-dialog').close(); api.toast(t('Day {day} saved to the game log.', { day: number(entry.day) }));
    });
    for (const context of ['log', 'trip']) {
      $(`${context}-image-add`).addEventListener('click', () => { if (canEdit() && !uploads[context].busy) $(`${context}-image-file`).click(); });
      $(`${context}-image-file`).addEventListener('change', event => {
        const files = Array.from(event.target.files || []); event.target.value = '';
        addImages(context, files);
      });
    }
    window.addEventListener('beforeunload', event => {
      if (hasDraft()) { event.preventDefault(); event.returnValue = ''; }
    });

    function hasDraft() { return uploads.log.busy || uploads.trip.busy || ($('log-dialog').open && dirty()) || ($('trip-dialog').open && tripValues() !== tripBaseline); }
    function getDrafts() {
      return { log: $('log-dialog').open ? { id: selectedId, ...JSON.parse(values()) } : null,
        trip: $('trip-dialog').open ? { id: tripId, ...JSON.parse(tripValues()) } : null };
    }
    function updateAccess() {
      for (const id of ['log-day', 'log-note', 'trip-day', 'trip-note']) $(id).readOnly = !canEdit();
      $('log-editor').setAttribute('aria-label', canEdit() ? t('Edit trip day') : t('Trip day notes'));
      if ($('trip-dialog').open) {
        $('trip-dialog-title').textContent = tripId ? t(canEdit() ? 'Edit Day {day}' : 'Day {day}', { day: number(entryById(tripId)?.day ?? $('trip-day').value) }) : t('Log this day');
        $('trip-cancel').textContent = canEdit() ? t('Cancel') : t('Close');
        renderTileDays();
      }
      $('log-gap-summary').hidden = !canEdit();
      renderImages('log'); renderImages('trip');
      participantEditors.log.renderAccess(); participantEditors.trip.renderAccess();
      supplyEditors.log.updateAccess(); supplyEditors.trip.updateAccess();
    }
    return { open, openDay, openTrip, refresh, updateAccess, hasDraft, getDrafts, clearPlacement() { placementId = null; }, reset() {
      clearSnapshot();
      selectedId = null; placementId = null;
      for (const upload of Object.values(uploads)) { upload.generation++; upload.busy = false; upload.status = ''; }
      logAttachments = []; tripAttachments = [];
      participantEditors.log.setValue([]); participantEditors.trip.setValue([]);
      supplyEditors.log.setValue(); supplyEditors.trip.setValue();
    } };
  }
})();
