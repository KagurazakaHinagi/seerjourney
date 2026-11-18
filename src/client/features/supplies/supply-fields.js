/* Daily shared supplies remain part of the game-log draft until it is saved. */
(function () {
  'use strict';
  const I = window.MapJourneyI18n, t = I.t;
  window.MapJourneySupplyFields = { create };

  function create({ root, prefix, canEdit = () => false, getTripDays = () => [], getDay = () => null, getEntryId = () => null }) {
    const S = window.MapJourneySuppliesCore;
    let rows = [], sequence = 0;
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const iconButton = (label, icon) => {
      const button = el('button', 'icon-button supply-remove'); button.type = 'button';
      button.setAttribute('aria-label', t(label)); button.title = t(label);
      button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${icon}"/></svg>`;
      return button;
    };
    const numericInput = (id, label, parent) => {
      const field = el('div', 'supply-field'), name = el('label', 'form-label', t(label));
      name.htmlFor = id;
      const input = el('input'); input.id = id; input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off'; input.placeholder = '0'; input.maxLength = 20;
      input.addEventListener('input', () => { clearError(); renderAvailable(); });
      field.append(name, input); parent.append(field); return input;
    };
    root.classList.add('supply-fields');
    const heading = el('h3', '', t('Food & water')); heading.id = `${prefix}-supplies-heading`;
    root.setAttribute('aria-labelledby', heading.id);
    const help = el('p', 'form-help', t('Record what the party found and consumed. Unused supplies carry forward.'));
    const edit = el('div', 'supply-edit'), foundHeading = el('div', 'supply-section-heading');
    const add = el('button', 'button subtle', t('Add food')); add.id = `${prefix}-food-add`; add.type = 'button'; add.setAttribute('data-editor-only', '');
    foundHeading.append(el('h4', '', t('Food found')), add);
    const foodList = el('div', 'supply-food-list'); foodList.id = `${prefix}-food-list`;
    const noFood = el('p', 'form-help', t('No food found. Add a food name and its weight, or leave this empty.'));
    const waterGroup = el('div', 'supply-water-row');
    const water = numericInput(`${prefix}-water-found`, 'Fresh water found (gals)', waterGroup);
    const consumeHeading = el('h4', 'supply-consume-heading', t('Consumed by the party'));
    const consume = el('div', 'supply-consumption');
    const foodConsumed = numericInput(`${prefix}-food-consumed`, 'Food consumed (lbs)', consume);
    const waterConsumed = numericInput(`${prefix}-water-consumed`, 'Water consumed (gals)', consume);
    const available = el('p', 'form-help supply-available'); available.id = `${prefix}-supplies-available`;
    const rule = el('p', 'form-help', t('Oldest unexpired food is used first. Food lasts 7 days including collection day; fresh water does not expire.'));
    const issue = el('p', 'form-error'); issue.id = `${prefix}-supplies-error`; issue.hidden = true; issue.setAttribute('role', 'alert');
    for (const input of [water, foodConsumed, waterConsumed]) input.setAttribute('aria-describedby', `${available.id} ${issue.id}`);
    edit.append(foundHeading, foodList, noFood, waterGroup, consumeHeading, consume, available, rule, issue);
    const summary = el('div', 'supply-read'); summary.id = `${prefix}-supplies-read`;
    root.replaceChildren(heading, help, edit, summary);

    function clearError() { issue.textContent = ''; issue.hidden = true; }
    function fail(message, field) { issue.textContent = t(message); issue.hidden = false; field?.focus(); throw new Error(t(message)); }
    function amount(input, positive = false) {
      const value = input.value.trim();
      if (!value && !positive) return 0;
      if (!/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(value) || !Number.isFinite(Number(value)) || Number(value) > 1000000 || (positive && Number(value) <= 0)) {
        fail(positive ? 'Enter a food weight above 0, up to 1,000,000 lbs, with at most 3 decimal places.' : 'Enter an amount from 0 to 1,000,000, with at most 3 decimal places.', input);
      }
      return Number(value);
    }
    function getValue() {
      const foods = rows.map(row => {
        const name = row.name.value.trim();
        if (!name || name.length > 100) fail('Enter a food name of 1 to 100 characters.', row.name);
        return { id: row.id, name, amount: amount(row.amount, true) };
      });
      return S.validate({ foods, water: amount(water), foodConsumed: amount(foodConsumed), waterConsumed: amount(waterConsumed) });
    }
    function getDraft() {
      return { foods: rows.map(row => ({ id: row.id, name: row.name.value, amount: row.amount.value })), water: water.value, foodConsumed: foodConsumed.value, waterConsumed: waterConsumed.value };
    }
    function appendFood(food = {}) {
      const row = el('div', 'supply-food-row'), key = `${prefix}-food-${++sequence}`;
      const nameField = el('div', 'supply-field supply-food-name'), nameLabel = el('label', 'form-label', t('Food name'));
      const name = el('input'); name.type = 'text'; name.id = `${key}-name`; name.maxLength = 100; name.autocomplete = 'off'; name.placeholder = t('e.g. fruit, dried meat'); name.value = food.name || ''; nameLabel.htmlFor = name.id;
      nameField.append(nameLabel, name); row.append(nameField);
      const weight = numericInput(`${key}-amount`, 'Weight (lbs)', row); weight.value = food.amount === undefined ? '' : String(food.amount);
      const remove = iconButton('Remove food', 'trash'); remove.setAttribute('data-editor-only', '');
      const item = { id: food.id || `food-${crypto.randomUUID()}`, name, amount: weight, element: row, remove };
      name.addEventListener('input', clearError);
      remove.addEventListener('click', () => {
        if (!canEdit()) return;
        const index = rows.indexOf(item); rows = rows.filter(other => other !== item); row.remove();
        (rows[index]?.name || rows[index - 1]?.name || add).focus({ preventScroll: true });
        refreshRows(); clearError(); renderAvailable();
      });
      row.append(remove); rows.push(item); foodList.append(row); refreshRows(); return item;
    }
    function refreshRows() { noFood.hidden = rows.length > 0; add.disabled = !canEdit() || rows.length >= 100; }
    function renderAvailable() {
      const day = getDay();
      if (!Number.isSafeInteger(day) || day < 0) { available.textContent = t('Set a trip day to check available supplies.'); return; }
      try {
        const raw = getDraft(), foods = raw.foods.filter(food => food.name.trim() && /^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(food.amount.trim())).map(food => ({ ...food, name: food.name.trim(), amount: Number(food.amount) }));
        const foundWater = raw.water.trim() && /^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(raw.water.trim()) ? Number(raw.water) : 0;
        const projected = getTripDays().filter(entry => entry.id !== getEntryId() && entry.day < day);
        projected.push({ id: '__supply_preview__', day, supplies: { foods, water: foundWater, foodConsumed: 0, waterConsumed: 0 } });
        const balance = S.ledger(projected, day);
        available.textContent = t('Available before consumption: {food} lbs food · {water} gals water', { food: I.number(balance.food), water: I.number(balance.water) });
      } catch (_) { available.textContent = t('Complete the food and water amounts to check available supplies.'); }
    }
    function renderSummary() {
      const fragment = document.createDocumentFragment(), list = el('ul', 'supply-read-foods');
      for (const row of rows) list.append(el('li', '', t('{name} · {amount} lbs', { name: row.name.value, amount: I.number(Number(row.amount.value) || 0) })));
      if (rows.length) fragment.append(list);
      else fragment.append(el('p', '', t('No food found.')));
      fragment.append(el('p', '', t('Fresh water found: {amount} gals', { amount: I.number(Number(water.value) || 0) })));
      fragment.append(el('p', '', t('Consumed: {food} lbs food · {water} gals water', { food: I.number(Number(foodConsumed.value) || 0), water: I.number(Number(waterConsumed.value) || 0) })));
      summary.replaceChildren(fragment);
    }
    function updateAccess() {
      edit.hidden = !canEdit(); summary.hidden = canEdit();
      for (const input of edit.querySelectorAll('input')) { input.readOnly = !canEdit(); input.disabled = !canEdit(); }
      for (const control of edit.querySelectorAll('button')) { control.disabled = !canEdit(); control.hidden = !canEdit(); }
      refreshRows(); if (!canEdit()) renderSummary();
    }
    function setValue(value) {
      const current = value || S.empty(); rows = []; foodList.replaceChildren();
      for (const food of current.foods) appendFood(food);
      water.value = String(current.water); foodConsumed.value = String(current.foodConsumed); waterConsumed.value = String(current.waterConsumed);
      clearError(); refreshRows(); renderAvailable(); updateAccess();
    }
    add.addEventListener('click', () => { if (canEdit() && rows.length < 100) appendFood().name.focus(); });
    setValue();
    return { setValue, getValue, getDraft, updateAccess, refresh: renderAvailable };
  }
})();
