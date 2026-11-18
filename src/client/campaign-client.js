/* Shared campaign synchronization. Cookies stay HttpOnly; view preferences stay local. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CampaignClient = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  function sharedSession(session) { return { ...copy(session), view: null, showJourney: true }; }
  function fingerprint(session) {
    const { updatedAt, view, showJourney, ...shared } = sharedSession(session);
    return JSON.stringify(shared);
  }
  function create(options = {}) {
    const fetcher = options.fetch || globalThis.fetch.bind(globalThis);
    const schedule = options.setTimeout || globalThis.setTimeout;
    const cancel = options.clearTimeout || globalThis.clearTimeout;
    let campaign = null, pending = null, remote = null, authenticated = false, connected = false;
    let writing = false, polling = false, stopped = false, conflict = false, timer, saveTimer, failure = '';
    const listeners = new Set();
    const canEdit = () => authenticated && connected && !conflict;
    const hasPending = () => Boolean(pending || writing || conflict);
    const status = () => ({ editable: canEdit(), authenticated, connected, conflict, pending: Boolean(pending),
      mode: conflict ? 'conflict' : !connected ? 'offline' : !authenticated && (pending || options.hasDraft?.()) ? 'expired' : writing || pending ? 'saving' : 'live',
      message: failure, revision: campaign?.revision, updatedAt: campaign?.updatedAt });
    const emit = event => { for (const listener of listeners) listener(event); };
    const changed = () => emit({ type: 'status', ...status() });
    async function request(path, init) {
      const controller = new AbortController();
      const timeout = schedule(() => controller.abort(), 12000);
      try {
        const response = await fetcher(path, { cache: 'no-store', credentials: 'same-origin', ...init, signal: controller.signal,
          headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
        let data;
        try { data = await response.json(); } catch (_) { throw new Error('The campaign server returned an unreadable response.'); }
        if (!response.ok) {
          const error = new Error(data.message || 'The request could not be completed.');
          error.status = response.status; error.data = data; throw error;
        }
        return data;
      } catch (error) {
        if (error.status) throw error;
        throw new Error('The campaign could not be reached. Check your connection and try again.');
      } finally { cancel(timeout); }
    }
    function validateSnapshot(next) {
      if (!next || !Number.isSafeInteger(next.revision) || next.revision < 0 || !next.session) throw new Error('The campaign server returned an unreadable response.');
      return next;
    }
    function accept(next, force = false) {
      validateSnapshot(next);
      if (campaign && next.revision < campaign.revision) return;
      if (!force && campaign && next.revision === campaign.revision) return;
      if (!force && campaign && (pending || writing || options.hasDraft?.())) {
        remote = copy(next); conflict = true; changed(); return;
      }
      campaign = copy(next); remote = null; conflict = false;
      emit({ type: 'session', session: copy(campaign.session), revision: campaign.revision });
    }
    async function start() {
      const [next, auth] = await Promise.all([request('/api/campaign'), request('/api/auth')]);
      campaign = copy(validateSnapshot(next)); authenticated = Boolean(auth.editable); connected = true;
      changed(); armPoll(); return copy(campaign.session);
    }
    function armPoll() {
      cancel(timer);
      if (!stopped) timer = schedule(async () => { await refresh(); armPoll(); }, options.isHidden?.() ? 30000 : 5000);
    }
    async function refresh() {
      if (polling || writing || stopped) return;
      polling = true;
      try {
        const [next, auth] = await Promise.all([request('/api/campaign'), request('/api/auth')]);
        authenticated = Boolean(auth.editable); connected = true; failure = '';
        accept(next);
      } catch (error) { connected = false; failure = error.message; }
      finally { polling = false; changed(); }
      if (pending && canEdit()) await flush();
    }
    function save(session) {
      if (!campaign || !canEdit()) return false;
      const next = sharedSession(session);
      if (fingerprint(next) === fingerprint(pending || campaign.session)) return true;
      pending = next; cancel(saveTimer); changed();
      saveTimer = schedule(flush, 350); return true;
    }
    async function flush() {
      cancel(saveTimer);
      if (!pending || writing || polling || !canEdit()) return;
      writing = true; changed();
      const sent = copy(pending), revision = campaign.revision;
      try {
        const next = validateSnapshot(await request('/api/campaign', { method: 'PUT', body: JSON.stringify({ revision, session: sent }) }));
        campaign = copy(next); connected = true; failure = '';
        if (pending && fingerprint(pending) === fingerprint(sent)) pending = null;
      } catch (error) {
        failure = error.message;
        if (error.status === 409 && error.data.campaign) { remote = copy(validateSnapshot(error.data.campaign)); conflict = true; }
        else if (error.status === 401 || error.status === 403) authenticated = false;
        else if (error.status >= 400 && error.status < 500) { conflict = true; }
        else connected = false;
      } finally { writing = false; changed(); }
      if (pending && canEdit()) saveTimer = schedule(flush, 350);
    }
    async function login(passphrase) {
      const auth = await request('/api/auth', { method: 'POST', body: JSON.stringify({ passphrase }) });
      authenticated = Boolean(auth.editable); connected = true; failure = '';
      await refresh(); changed();
      return canEdit();
    }
    async function logout() {
      if (hasPending() || options.hasDraft?.()) throw new Error('Save or download your local changes before signing out.');
      await request('/api/auth', { method: 'DELETE' });
      authenticated = false; changed();
    }
    async function loadLatest() {
      if (writing) return false;
      const next = validateSnapshot(await request('/api/campaign'));
      pending = null; failure = ''; connected = true;
      accept(next, true); changed(); return true;
    }
    return { start, refresh, save, flush, login, logout, loadLatest, canEdit, hasPending, status,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      stop() { stopped = true; cancel(timer); cancel(saveTimer); },
      getSnapshot() { return campaign && copy(campaign); },
      getPending() { return pending && copy(pending); } };
  }
  return { create, sharedSession, fingerprint };
});
