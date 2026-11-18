/* One shared inventory, derived from the daily records rather than a second stockpile. */
(function () {
  'use strict';
  const I = window.MapJourneyI18n, t = I.t, S = window.MapJourneySuppliesCore;
  window.MapJourneySuppliesPage = { create };

  function create(api) {
    const $ = id => document.getElementById(id), dialog = $('supplies-dialog');
    const C = api.core, canEdit = api.canEdit || (() => false);
    const days = () => api.getSession()?.tripDays || [];
    const currentDay = () => Math.min(C.MAX_TRIP_DAY, C.nextTripDay(days()));
    let day = currentDay(), followCurrent = true, baseline = '', saving = false, stamp = '';
    const entry = () => days().find(item => item.day === day);
    const fields = window.MapJourneySupplyFields.create({ root: $('stores-fields'), prefix: 'stores', canEdit,
      getTripDays: days, getDay: () => day, getEntryId: () => entry()?.id || null });
    const raw = () => JSON.stringify(fields.getDraft());
    const dirty = () => !$('stores-form').hidden && raw() !== baseline;
    const number = value => I.number(value, { maximumFractionDigits: 3 });
    const amount = (value, unit) => t(unit === 'food' ? '{amount} lbs' : '{amount} gals', { amount: number(value) });
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    function error(message = '') { $('stores-error').textContent = message; $('stores-error').hidden = !message; }
    function fillEditor() {
      fields.setValue(entry()?.supplies || S.empty()); baseline = raw();
      $('stores-edit-heading').textContent = t('Supplies for Day {day}', { day: number(day) });
    }
    async function leaveDraft() {
      return !dirty() || api.ask(t('Discard unsaved supplies?'), t('Your food and water changes have not been saved.'), t('Discard changes'), t('Keep editing'));
    }
    function stopEditing() { $('stores-form').hidden = true; baseline = ''; fields.setValue(S.empty()); }
    function renderBatches(target, batches, expired = false) {
      const fragment = document.createDocumentFragment();
      for (const batch of batches) {
        const row = el('li', 'stores-batch');
        const copy = el('div');
        copy.append(el('strong', '', batch.name));
        const collected = t('Collected Day {day}', { day: number(batch.day) });
        const expiry = batch.expiresDay === null ? t('Expires beyond the supported day range') : t(expired ? 'Expired Day {day}' : 'Expires Day {day}', { day: number(batch.expiresDay) });
        copy.append(el('span', 'stores-meta', `${collected} · ${expiry}`));
        row.append(copy, el('strong', 'stores-amount', amount(batch.remaining, 'food')));
        fragment.append(row);
      }
      $(target).replaceChildren(fragment);
    }
    function render() {
      if (followCurrent && !dirty() && $('stores-form').hidden) day = currentDay();
      if (document.activeElement !== $('stores-day')) $('stores-day').value = String(day);
      $('stores-summary').textContent = t('Shared party inventory · Day {day}', { day: number(day) });
      $('stores-asof').textContent = t('Remaining after recorded consumption on Day {day}.', { day: number(day) });
      $('stores-current').disabled = day === currentDay();
      $('stores-edit').textContent = t(entry()?.supplies ? 'Edit daily supplies' : 'Record daily supplies');
      $('stores-open-log').hidden = !entry();
      const nextStamp = JSON.stringify([days().map(({ id, day, supplies }) => ({ id, day, supplies })), day]);
      if (nextStamp === stamp) return;
      stamp = nextStamp;
      const inventory = S.ledger(days(), day);
      $('stores-food-total').textContent = amount(inventory.food, 'food');
      $('stores-water-total').textContent = amount(inventory.water, 'water');
      const available = inventory.batches.filter(batch => batch.status === 'available' && batch.remaining > 0);
      const expired = inventory.batches.filter(batch => batch.status === 'expired' && batch.remaining > 0);
      renderBatches('stores-inventory-list', available);
      renderBatches('stores-expired-list', expired, true);
      $('stores-food-empty').hidden = available.length > 0;
      $('stores-expired').hidden = !expired.length;
      $('stores-expired-summary').textContent = t('Expired food ({count})', { count: number(expired.length) });
      const history = document.createDocumentFragment();
      for (const record of [...inventory.days].reverse()) {
        const source = days().find(item => item.id === record.id);
        if (!source?.supplies) continue;
        const row = el('li', 'stores-history-row'), copy = el('div');
        const button = el('button', 'stores-day-link', t('Day {day}', { day: number(record.day) }));
        button.type = 'button'; button.addEventListener('click', () => chooseDay(record.day));
        copy.append(button, el('p', 'stores-meta', t('Found: {food} · {water}', { food: amount(record.foodFound, 'food'), water: amount(record.waterFound, 'water') })),
          el('p', 'stores-meta', t('Consumed: {food} · {water}', { food: amount(record.foodConsumed, 'food'), water: amount(record.waterConsumed, 'water') })));
        row.append(copy); history.append(row);
      }
      $('stores-history').replaceChildren(history);
      $('stores-history-empty').hidden = $('stores-history').children.length > 0;
    }
    async function chooseDay(value, current = false) {
      const next = C.parseTripDay(value);
      if (next === null) { error(t('Use a whole day number, starting at 0.')); $('stores-day').focus(); return false; }
      if (!await leaveDraft()) { $('stores-day').value = String(day); return false; }
      stopEditing(); day = next; followCurrent = current; $('stores-day').value = String(day); error(); stamp = ''; render(); updateAccess();
      return true;
    }
    function beginEdit() {
      if (!canEdit() || !api.getSession()) return;
      if (!$('stores-form').hidden) return;
      followCurrent = false; fillEditor(); $('stores-form').hidden = false; error(); updateAccess();
      $('stores-form').scrollIntoView({ block: 'start', behavior: 'auto' });
      $('stores-edit-heading').focus({ preventScroll: true });
    }
    function save() {
      if (!canEdit() || !api.getSession() || $('stores-form').hidden) return false;
      try {
        const supplies = fields.getValue(), old = entry();
        if (!old && days().length >= 10000) throw new Error('The session contains too many trip days.');
        const next = { ...(old || { id: `day-${C.freshSession().id}`, day, note: '', hex: null, attachments: [], participants: [] }), supplies };
        const proposed = C.sortTripDays([...days().filter(item => item.id !== next.id), next]);
        S.assertLedger(proposed);
        saving = true;
        const changed = api.mutate(() => { api.getSession().tripDays = proposed; });
        if (changed === false && JSON.stringify(old?.supplies) !== JSON.stringify(supplies)) {
          error(t('Supplies could not be saved. Your changes are kept here.')); return false;
        }
        stopEditing(); stamp = ''; render(); updateAccess(); error(); api.toast(t('Supplies saved for Day {day}.', { day: number(day) }));
        return true;
      } catch (cause) {
        const shortage = cause.supplyShortage;
        error(shortage ? t(shortage.resource === 'food'
          ? 'Day {day} needs {requested} lbs of food, but only {available} lbs is unexpired. Reduce consumption or correct earlier supplies.'
          : 'Day {day} needs {requested} gals of water, but only {available} gals is available. Reduce consumption or correct earlier supplies.',
        { day: number(shortage.day), requested: number(shortage.requested), available: number(shortage.available) }) : I.text(cause.message));
        $('stores-error').scrollIntoView({ block: 'nearest' }); return false;
      }
      finally { saving = false; }
    }
    function refresh() {
      if (!dialog.open || saving) return;
      if (!dirty() && !$('stores-form').hidden) {
        const next = entry()?.supplies || S.empty();
        if (JSON.stringify(next) !== JSON.stringify(fields.getValue())) fillEditor();
      }
      render(); updateAccess();
    }
    function updateAccess() {
      $('stores-edit').hidden = !canEdit() || !$('stores-form').hidden;
      $('stores-edit').disabled = !canEdit() || !api.getSession();
      $('stores-save').hidden = !canEdit(); $('stores-save').disabled = !canEdit();
      fields.updateAccess();
    }
    function open() {
      if (!dialog.open) {
        followCurrent = true; day = currentDay(); stopEditing(); stamp = '';
        api.openDialog('supplies-dialog');
      }
      render(); updateAccess(); dialog.querySelector('.stores-scroll').scrollTop = 0; $('stores-close').focus({ preventScroll: true });
    }
    async function close() {
      if (!await leaveDraft()) return;
      stopEditing(); dialog.close(); api.openDialog('options-dialog'); $('open-supplies').focus({ preventScroll: true });
    }
    $('open-supplies').addEventListener('click', open);
    $('stores-close').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    $('stores-day-form').addEventListener('submit', event => { event.preventDefault(); chooseDay($('stores-day').value); });
    $('stores-current').addEventListener('click', () => chooseDay(currentDay(), true));
    $('stores-edit').addEventListener('click', beginEdit);
    $('stores-cancel').addEventListener('click', async () => { if (await leaveDraft()) { stopEditing(); error(); updateAccess(); } });
    $('stores-form').addEventListener('submit', event => { event.preventDefault(); save(); });
    $('stores-open-log').addEventListener('click', async () => {
      if (!entry() || !await leaveDraft()) return;
      const id = entry().id; stopEditing(); dialog.close(); await api.openDay(id);
    });
    const hasDraft = () => dialog.open && dirty();
    updateAccess();
    return { open, refresh, updateAccess, hasDraft,
      getDrafts: () => hasDraft() ? { day, supplies: fields.getDraft() } : null,
      reset() { stopEditing(); followCurrent = true; stamp = ''; error(); refresh(); }
    };
  }
})();
