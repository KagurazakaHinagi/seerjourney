'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, attachment, add } = require('../helpers/campaign-game-log.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const participantInput = (h, context = 'log') => h.$(`${context}-participants-input`);
const participantAdd = (h, context = 'log') => h.$(`${context}-participants`).querySelectorAll('button').find(button => button.className.includes('participant-add'));
const participantRemoves = (h, context = 'log') => h.$(`${context}-participants`).querySelectorAll('button').filter(button => button.className.includes('participant-remove'));
async function type(h, name, context = 'log') { participantInput(h, context).value = name; await participantInput(h, context).emit('input'); }
const displayedParticipants = (h, context) => h.$(`${context}-participants`).querySelectorAll('span')
  .filter(element => element.className === 'participant-name').map(element => element.textContent);

test('both day editors alphabetize visible tags for guests and editors without altering saved order or drafts', () => {
  const saved = ['Zelda', 'Player 10', 'bob', 'ALICE', 'Player 2', '张三', '阿兰', '李明'];
  const expected = ['阿兰', '李明', '张三', 'ALICE', 'bob', 'Player 2', 'Player 10', 'Zelda'];
  for (const editable of [false, true]) for (const context of ['log', 'trip']) {
    const h = harness({ editable }); h.session.tripDays[0].participants = [...saved];
    const before = plain(h.session);
    if (context === 'log') h.controller.open(); else h.controller.openTrip(null, 'day-0');
    assert.deepEqual(displayedParticipants(h, context), expected);
    assert.equal(h.controller.hasDraft(), false, 'display sorting must not create an unsaved edit');
    assert.deepEqual(h.session, before);
  }
});

test('new participant tags sort immediately and removal targets the chosen name in either editor', async () => {
  for (const context of ['log', 'trip']) {
    const h = harness(); h.session.tripDays[0].participants = ['Zelda', 'bob'];
    if (context === 'log') h.controller.open(); else h.controller.openTrip(null, 'day-0');
    await type(h, 'ALICE', context); await participantAdd(h, context).click();
    assert.deepEqual(displayedParticipants(h, context), ['ALICE', 'bob', 'Zelda']);
    assert.deepEqual(h.session.tripDays[0].participants, ['Zelda', 'bob']);
    const remove = participantRemoves(h, context).find(button => button.attributes['aria-label'] === 'Remove participant: bob');
    assert.ok(remove); await remove.click();
    assert.deepEqual(displayedParticipants(h, context), ['ALICE', 'Zelda']);
    await h.$(`${context}-form`).emit('submit');
    assert.deepEqual(plain(h.session.tripDays[0].participants), ['Zelda', 'ALICE']);
  }
});

test('participant suggestions use Chinese-aware alphabetical and numeric ordering', () => {
  const h = harness(); h.session.tripDays[0].participants = ['bob'];
  h.session.tripDays.push({ id: 'day-1', day: 1, note: '', hex: null,
    participants: ['Zelda', 'Player 10', 'bob', 'ALICE', 'Player 2', '张三', '阿兰', '李明'] });
  for (const context of ['log', 'trip']) {
    if (context === 'log') h.controller.open(); else h.controller.openTrip(null, 'day-0');
    assert.deepEqual(h.$(`${context}-participants-suggestions`).children.map(option => option.value),
      ['阿兰', '李明', '张三', 'ALICE', 'Player 2', 'Player 10', 'Zelda']);
  }
});

test('game log initializes before the campaign arrives and reads later participant suggestions', async () => {
  const h = harness({ deferredSession: true, editable: false });
  h.controller.updateAccess(); h.controller.refresh();
  assert.equal(h.controller.hasDraft(), false);
  assert.deepEqual(plain(h.controller.getDrafts()), { log: null, trip: null });
  for (const context of ['log', 'trip']) {
    assert.equal(h.$(`${context}-participants-suggestions`).children.length, 0);
    assert.equal(participantInput(h, context).disabled, true);
  }
  h.session.tripDays[0].participants = ['Mei'];
  h.session.tripDays.push({ id: 'day-1', day: 1, note: '', hex: null, participants: ['林'] });
  h.provideSession(); h.setEditable(true); h.controller.refresh(); h.controller.open();
  assert.deepEqual(plain(h.controller.getDrafts().log.participants), ['Mei']);
  assert.deepEqual(h.$('log-participants-suggestions').children.map(option => option.value), ['林']);
  await type(h, '林'); await h.$('log-form').emit('submit');
  assert.deepEqual(plain(h.session.tripDays[0].participants), ['Mei', '林']);
  assert.equal(h.controller.hasDraft(), false);
  h.$('log-dialog').close(); h.controller.openTrip(null, 'day-1');
  assert.deepEqual(h.$('trip-participants-suggestions').children.map(option => option.value), ['Mei']);
  await type(h, 'Mei', 'trip'); await h.$('trip-form').emit('submit');
  assert.deepEqual(plain(h.session.tripDays[1].participants), ['林', 'Mei']);
});

test('saving either editor commits the pending participant without losing notes or images', async () => {
  const h = harness(); h.session.tripDays[0].participants = ['Li']; h.controller.open();
  await type(h, '  Mei  '); h.$('log-day').value = '4'; await h.$('log-form').emit('submit');
  assert.deepEqual(plain(h.session.tripDays[0].participants), ['Li', 'Mei']);
  assert.equal(h.session.tripDays[0].day, 4);
  assert.equal(h.session.tripDays[0].note, 'Existing notes');
  assert.deepEqual(plain(h.session.tripDays[0].attachments), [attachment(1)]);
  assert.equal(h.controller.hasDraft(), false);
  h.$('log-dialog').close(); h.controller.openTrip({ key: '40,45' }, 'day-0');
  await type(h, 'Wei', 'trip'); h.$('trip-note').value = 'Camped here.'; await h.$('trip-form').emit('submit');
  assert.deepEqual(plain(h.session.tripDays[0].participants), ['Li', 'Mei', 'Wei']);
  assert.equal(h.session.tripDays[0].hex, '40,45');
  assert.equal(h.session.tripDays[0].note, 'Camped here.');
});

test('participant names deduplicate and Enter respects IME composition', async () => {
  const h = harness(); h.session.tripDays[0].participants = ['Mei']; h.controller.open();
  await type(h, '林'); let prevented = 0;
  await participantInput(h).emit('keydown', { key: 'Enter', isComposing: true, preventDefault() { prevented++; } });
  assert.deepEqual(plain(h.controller.getDrafts().log.participants), ['Mei']);
  assert.equal(participantInput(h).value, '林'); assert.equal(prevented, 0);
  await participantInput(h).emit('keydown', { key: 'Enter', preventDefault() { prevented++; } });
  assert.deepEqual(plain(h.controller.getDrafts().log.participants), ['Mei', '林']);
  assert.equal(prevented, 1); assert.equal(participantInput(h).value, '');
  await type(h, ' mei '); await participantAdd(h).click();
  assert.deepEqual(plain(h.controller.getDrafts().log.participants), ['Mei', '林']);
  assert.equal(participantInput(h).value, '');
});

test('suggestions use saved participant names and tags render names as plain text', async () => {
  const h = harness(); h.session.tripDays[0].participants = ['Mei'];
  h.session.tripDays.push({ id: 'day-1', day: 1, note: '', hex: null, participants: ['Mei', '林', '<img src=x onerror=alert(1)>'] });
  h.controller.open();
  const suggestions = h.$('log-participants-suggestions').children.map(option => option.value);
  assert.deepEqual(new Set(suggestions), new Set(['林', '<img src=x onerror=alert(1)>']));
  await type(h, '<img src=x onerror=alert(1)>'); await participantAdd(h).click();
  const names = h.$('log-participants').querySelectorAll('span').filter(element => element.className === 'participant-name');
  const literal = names.find(element => element.textContent === '<img src=x onerror=alert(1)>');
  assert.ok(literal);
  assert.equal(literal.innerHTML, undefined);
  await participantRemoves(h).find(button => button.attributes['aria-label'] === 'Remove participant: <img src=x onerror=alert(1)>').click();
  assert.deepEqual(plain(h.controller.getDrafts().log.participants), ['Mei']);
});

test('typed participant drafts block remote refresh and are recoverable after auth loss', async () => {
  const h = harness({ ask: async () => false }); h.session.tripDays[0].participants = ['Mei']; h.controller.open();
  await type(h, 'Unfinished name');
  assert.equal(h.controller.hasDraft(), true);
  h.session.tripDays[0].participants = ['Remote']; h.controller.refresh();
  assert.deepEqual(plain(h.controller.getDrafts().log.participants), ['Mei']);
  assert.equal(h.controller.getDrafts().log.participantInput, 'Unfinished name');
  await h.$('log-add').click(); assert.equal(h.$('log-day').value, '0');
  const oldRemove = participantRemoves(h)[0]; h.setEditable(false); await oldRemove.click();
  await h.$('log-form').emit('submit');
  assert.equal(participantInput(h).disabled, true);
  assert.equal(participantRemoves(h).length, 0);
  assert.equal(h.controller.getDrafts().log.participantInput, 'Unfinished name');
  assert.deepEqual(plain(h.controller.getDrafts().log.participants), ['Mei']);
  assert.deepEqual(h.session.tripDays[0].participants, ['Remote']);
  h.setEditable(true); await h.$('log-form').emit('submit');
  assert.deepEqual(plain(h.session.tripDays[0].participants), ['Mei', 'Unfinished name']);
});

test('guests and missing access checks cannot add or remove participants in either editor', async () => {
  for (const options of [{ editable: false }, { omitAccessCheck: true }]) {
    const h = harness(options); h.session.tripDays[0].participants = ['Mei'];
    h.controller.open(); h.controller.openTrip(null, 'day-0');
    for (const context of ['log', 'trip']) {
      assert.equal(participantInput(h, context).disabled, true);
      assert.equal(participantAdd(h, context).disabled, true);
      assert.equal(participantRemoves(h, context).length, 0);
      await type(h, 'Not allowed', context); await participantAdd(h, context).click();
      await h.$(`${context}-form`).emit('submit');
    }
    assert.deepEqual(h.session.tripDays[0].participants, ['Mei']);
  }
});

test('participant limits preserve rejected input and prevent the day being saved', async () => {
  const h = harness(); h.session.tripDays[0].participants = Array.from({ length: 32 }, (_, i) => `Player ${i}`); h.controller.open();
  await type(h, 'Extra player'); h.$('log-note').value = 'Unsaved note'; await h.$('log-form').emit('submit');
  assert.match(h.$('log-participants-error').textContent, /32 participants/);
  assert.equal(h.session.tripDays[0].note, 'Existing notes');
  assert.equal(h.controller.getDrafts().log.participantInput, 'Extra player');
  await type(h, 'Player 0'); await h.$('log-form').emit('submit');
  assert.equal(h.session.tripDays[0].participants.length, 32);
  assert.equal(h.session.tripDays[0].note, 'Unsaved note');
  await type(h, 'x'.repeat(81)); await participantAdd(h).click();
  assert.match(h.$('log-participants-error').textContent, /80 characters/);
  assert.equal(h.controller.getDrafts().log.participantInput.length, 81);
  await participantRemoves(h)[0].click();
  await type(h, 'Invisible\u200b name'); await participantAdd(h).click();
  assert.match(h.$('log-participants-error').textContent, /control characters/);
  assert.equal(h.controller.getDrafts().log.participantInput, 'Invisible\u200b name');
});

test('map-location and image changes preserve participants and trip drafts stay isolated', async () => {
  const h = harness(); h.session.tripDays[0].participants = ['Mei']; h.session.tripDays[0].hex = '40,45'; h.controller.open();
  await add(h); await h.$('log-remove-location').click();
  assert.deepEqual(plain(h.session.tripDays[0].participants), ['Mei']);
  assert.equal(h.session.tripDays[0].attachments.length, 2); assert.equal(h.session.tripDays[0].hex, null);
  h.$('log-dialog').close(); h.controller.openTrip({ key: '40,45' }, 'day-0');
  await type(h, '林', 'trip'); h.controller.refresh();
  assert.equal(h.controller.getDrafts().trip.participantInput, '林');
  assert.deepEqual(plain(h.session.tripDays[0].participants), ['Mei']);
  await h.$('trip-form').emit('submit');
  assert.deepEqual(plain(h.session.tripDays[0].participants), ['Mei', '林']);
  assert.equal(h.session.tripDays[0].attachments.length, 2);
});

test('new days retain participant drafts until saved and reset clears pending names', async () => {
  const h = harness(); h.controller.open(); await h.$('log-add').click();
  await type(h, 'Mei'); await participantAdd(h).click();
  assert.equal(h.session.tripDays.length, 1); assert.equal(h.controller.hasDraft(), true);
  await h.$('log-form').emit('submit');
  assert.deepEqual(plain(h.session.tripDays[1].participants), ['Mei']);
  await type(h, 'Unsaved'); h.controller.reset();
  assert.deepEqual(plain(h.controller.getDrafts().log.participants), []);
  assert.equal(h.controller.getDrafts().log.participantInput, '');
});
