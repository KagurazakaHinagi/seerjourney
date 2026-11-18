/* Shared party supplies. Quantities are calculated in thousandths of a lb/gal. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapJourneySuppliesCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SCALE = 1000, MAX_AMOUNT = 1000000;
  const empty = () => ({ foods: [], water: 0, foodConsumed: 0, waterConsumed: 0 });
  const fail = message => { throw new Error(message); };
  const units = value => Math.round(value * SCALE);
  const amount = value => value / SCALE;

  function quantity(value, positive = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT || (positive && value === 0) || amount(units(value)) !== value) {
      fail(positive ? 'Food amounts must be greater than 0 and no more than 1,000,000 lbs, with up to 3 decimal places.' : 'Supply amounts must be between 0 and 1,000,000, with up to 3 decimal places.');
    }
    return value === 0 ? 0 : value;
  }

  function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Daily supplies are not valid.');
    if (!Array.isArray(value.foods) || value.foods.length > 100) fail('A game day can record up to 100 foods.');
    const ids = new Set();
    const foods = value.foods.map(food => {
      if (!food || typeof food !== 'object' || Array.isArray(food)) fail('A food entry is not valid.');
      if (typeof food.id !== 'string' || !food.id.trim() || food.id.length > 128 || ids.has(food.id)) fail('A food entry has an invalid or duplicate ID.');
      if (typeof food.name !== 'string' || !food.name.trim() || food.name.trim().length > 100) fail('A food name must contain 1 to 100 characters.');
      ids.add(food.id);
      return { id: food.id, name: food.name.trim(), amount: quantity(food.amount, true) };
    });
    return { foods, water: quantity(value.water), foodConsumed: quantity(value.foodConsumed), waterConsumed: quantity(value.waterConsumed) };
  }

  function ledger(tripDays, asOfDay) {
    if (!Array.isArray(tripDays)) fail('The supply ledger needs a list of game days.');
    const dayNumbers = new Set(), foodIds = new Set();
    for (const entry of tripDays) {
      if (!entry || !Number.isSafeInteger(entry.day) || entry.day < 0 || dayNumbers.has(entry.day)) fail('The supply ledger has an invalid or duplicate day.');
      dayNumbers.add(entry.day);
    }
    const day = asOfDay === undefined ? tripDays.reduce((latest, entry) => Math.max(latest, entry.day), 0) : asOfDay;
    if (!Number.isSafeInteger(day) || day < 0) fail('Choose a whole supply day starting at 0.');
    const batches = [], days = [], errors = [];
    let water = 0, foodBalance = 0, oldest = 0;
    const expire = at => {
      while (oldest < batches.length && (!batches[oldest].remaining || at - batches[oldest].day >= 7)) {
        foodBalance -= batches[oldest].remaining;
        oldest++;
      }
    };
    for (const entry of [...tripDays].sort((a, b) => a.day - b.day)) {
      if (entry.day > day) break;
      expire(entry.day);
      const supplies = entry.supplies === undefined ? empty() : validate(entry.supplies);
      let foodFound = 0;
      for (const food of supplies.foods) {
        if (foodIds.has(food.id)) fail('A food entry has an invalid or duplicate ID.');
        foodIds.add(food.id);
        const found = units(food.amount);
        const expiresDay = Number.isSafeInteger(entry.day + 7) ? entry.day + 7 : null;
        batches.push({ id: food.id, name: food.name, day: entry.day, expiresDay, amount: found, remaining: found });
        foodFound += found; foodBalance += found;
      }
      water += units(supplies.water);
      const foodBefore = foodBalance, waterBefore = water;
      const foodRequested = units(supplies.foodConsumed), waterRequested = units(supplies.waterConsumed);
      if (foodRequested > foodBefore) errors.push({ day: entry.day, resource: 'food', requested: supplies.foodConsumed, available: amount(foodBefore) });
      if (waterRequested > waterBefore) errors.push({ day: entry.day, resource: 'water', requested: supplies.waterConsumed, available: amount(waterBefore) });
      let remaining = Math.min(foodRequested, foodBefore);
      while (remaining > 0) {
        const batch = batches[oldest];
        const consumed = Math.min(batch.remaining, remaining);
        batch.remaining -= consumed; remaining -= consumed; foodBalance -= consumed;
        if (!batch.remaining) oldest++;
      }
      water -= Math.min(waterRequested, waterBefore);
      days.push({ id: entry.id, day: entry.day, foodFound: amount(foodFound), waterFound: supplies.water,
        foodConsumed: amount(Math.min(foodRequested, foodBefore)), waterConsumed: amount(Math.min(waterRequested, waterBefore)),
        foodRemaining: amount(foodBalance), waterRemaining: amount(water) });
    }
    expire(day);
    return { day, food: amount(foodBalance), water: amount(water), batches: batches.map(batch => ({ ...batch,
      amount: amount(batch.amount), remaining: amount(batch.remaining),
      status: batch.remaining === 0 ? 'consumed' : day - batch.day >= 7 ? 'expired' : 'available' })), days, errors };
  }

  function assertLedger(tripDays) {
    const result = ledger(tripDays), shortage = result.errors[0];
    if (shortage) {
      const error = new Error(`Day ${shortage.day}: not enough ${shortage.resource === 'food' ? 'unexpired food' : 'fresh water'}. Available: ${shortage.available} ${shortage.resource === 'food' ? 'lbs' : 'gals'}; requested: ${shortage.requested}.`);
      error.supplyShortage = shortage;
      throw error;
    }
    return result;
  }

  return { empty, validate, ledger, assertLedger };
});
