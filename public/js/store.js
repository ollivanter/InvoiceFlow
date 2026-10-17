// Application state + cloud sync engine.
//
// - Every change is written to a per-user local cache first (never shared between accounts).
// - Changes are uploaded with the revision the client last saw. If another device saved in the
//   meantime the server answers 409 with its copy; we merge record-by-record (newest edit wins,
//   deletions tracked with tombstones) and retry. Nothing is silently overwritten.
// - Uploads are serialized, debounced, retried with backoff while offline, and flushed when the
//   tab is hidden. Closing the tab with unsynced changes shows a warning.
import { api } from './api.js';
import { nowIso, storageGet, storageSet, storageRemove } from './util.js';

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const LEGACY_KEYS = ['profile', 'invoices'];

export const state = {
  user: null,
  profile: {},
  invoices: [],
  clients: [],
  tombstones: { invoices: {}, clients: {}, catalog: {} },
  revision: 0,
  dirty: false,
  localVersion: 0,
  sync: { status: 'synced', message: '', at: null }
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(kind = 'data') {
  for (const fn of listeners) fn(kind);
}

let onAuthLost = () => {};
export function setAuthLostHandler(fn) { onAuthLost = fn; }

// ─── Local cache ────────────────────────────────────────────────────────────
const cacheKey = id => `if:data:${id}`;

function persistLocal() {
  if (!state.user) return;
  const ok = storageSet(cacheKey(state.user.id), JSON.stringify({
    profile: state.profile,
    invoices: state.invoices,
    clients: state.clients,
    tombstones: state.tombstones,
    revision: state.revision,
    dirty: state.dirty
  }));
  if (!ok) console.warn('Local cache is full or unavailable; changes are kept in memory until synced.');
}

function readLocal(userId) {
  try { return JSON.parse(storageGet(cacheKey(userId)) || 'null'); } catch { return null; }
}

function normalizeDoc(doc = {}) {
  const t = doc.tombstones || {};
  return {
    profile: doc.profile && typeof doc.profile === 'object' ? doc.profile : {},
    invoices: Array.isArray(doc.invoices) ? doc.invoices : [],
    clients: Array.isArray(doc.clients) ? doc.clients : [],
    tombstones: { invoices: t.invoices || {}, clients: t.clients || {}, catalog: t.catalog || {} }
  };
}

function applyDoc(doc) {
  const d = normalizeDoc(doc);
  state.profile = d.profile;
  state.profile.catalog = Array.isArray(d.profile.catalog) ? d.profile.catalog : [];
  state.profile.branding = d.profile.branding || {};
  state.invoices = d.invoices.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  state.clients = d.clients.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  state.tombstones = d.tombstones;
}

const currentDoc = () => ({ profile: state.profile, invoices: state.invoices, clients: state.clients, tombstones: state.tombstones });

// ─── Merge ──────────────────────────────────────────────────────────────────
function mergeTombstones(a = {}, b = {}) {
  const out = { ...a };
  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_MS).toISOString();
  for (const [id, ts] of Object.entries(b)) if (!out[id] || ts > out[id]) out[id] = ts;
  for (const [id, ts] of Object.entries(out)) if (ts < cutoff) delete out[id];
  return out;
}

function mergeList(local = [], remote = [], tombstones = {}) {
  const map = new Map();
  for (const item of [...remote, ...local]) {
    if (!item?.id) continue;
    const dead = tombstones[item.id];
    if (dead && dead >= String(item.updatedAt || '')) continue;
    const existing = map.get(item.id);
    if (!existing || String(item.updatedAt || '') > String(existing.updatedAt || '')) map.set(item.id, item);
  }
  return [...map.values()];
}

export function mergeDocs(localDoc, remoteDoc) {
  const local = normalizeDoc(localDoc);
  const remote = normalizeDoc(remoteDoc);
  const tombstones = {
    invoices: mergeTombstones(local.tombstones.invoices, remote.tombstones.invoices),
    clients: mergeTombstones(local.tombstones.clients, remote.tombstones.clients),
    catalog: mergeTombstones(local.tombstones.catalog, remote.tombstones.catalog)
  };
  const localNewer = String(local.profile.updatedAt || '') >= String(remote.profile.updatedAt || '');
  const profile = { ...(localNewer ? local.profile : remote.profile) };
  profile.catalog = mergeList(local.profile.catalog, remote.profile.catalog, tombstones.catalog);
  return {
    profile,
    invoices: mergeList(local.invoices, remote.invoices, tombstones.invoices),
    clients: mergeList(local.clients, remote.clients, tombstones.clients),
    tombstones
  };
}

// ─── Session lifecycle ──────────────────────────────────────────────────────
export function initSession(user, remote) {
  // The old app stored data under shared keys, which could leak between accounts. Drop them.
  LEGACY_KEYS.forEach(storageRemove);
  state.user = user;
  const local = readLocal(user.id);
  if (local?.dirty) {
    // Unsynced edits from a previous visit: merge them with the server copy and upload.
    applyDoc(mergeDocs(local, remote));
    state.revision = remote.revision;
    state.dirty = true;
    state.localVersion += 1;
    persistLocal();
    scheduleSync(300);
  } else {
    applyDoc(remote);
    state.revision = remote.revision;
    state.dirty = false;
    persistLocal();
    setSync('synced');
  }
  emit();
}

export function updateUser(user) {
  state.user = { ...state.user, ...user };
  emit('user');
}

export function clearSession() {
  if (state.user) storageRemove(cacheKey(state.user.id));
  clearTimeout(timer);
  Object.assign(state, {
    user: null, profile: {}, invoices: [], clients: [],
    tombstones: { invoices: {}, clients: {}, catalog: {} }, revision: 0, dirty: false
  });
}

export function replaceFromServer(data) {
  applyDoc(data);
  state.revision = data.revision;
  state.dirty = false;
  persistLocal();
  setSync('synced');
  emit();
}

// ─── Mutations ──────────────────────────────────────────────────────────────
function commit() {
  state.dirty = true;
  state.localVersion += 1;
  persistLocal();
  emit();
  setSync('pending');
  scheduleSync();
}

export function updateProfile(patch) {
  state.profile = { ...state.profile, ...patch, updatedAt: nowIso() };
  commit();
}

export function updateBranding(patch) {
  updateProfile({ branding: { ...(state.profile.branding || {}), ...patch } });
}

export function upsertInvoice(invoice) {
  const stamped = { ...invoice, updatedAt: nowIso(), createdAt: invoice.createdAt || nowIso() };
  const idx = state.invoices.findIndex(i => i.id === stamped.id);
  if (idx >= 0) state.invoices[idx] = stamped;
  else state.invoices.unshift(stamped);
  commit();
  return stamped;
}

export function deleteInvoice(id) {
  state.invoices = state.invoices.filter(i => i.id !== id);
  state.tombstones.invoices[id] = nowIso();
  commit();
}

export function restoreInvoice(invoice) {
  delete state.tombstones.invoices[invoice.id];
  upsertInvoice(invoice);
}

export function upsertClient(client) {
  const stamped = { ...client, updatedAt: nowIso(), createdAt: client.createdAt || nowIso() };
  const idx = state.clients.findIndex(c => c.id === stamped.id);
  if (idx >= 0) state.clients[idx] = stamped;
  else state.clients.push(stamped);
  state.clients.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  commit();
  return stamped;
}

export function deleteClient(id) {
  state.clients = state.clients.filter(c => c.id !== id);
  state.tombstones.clients[id] = nowIso();
  commit();
}

export function upsertCatalogItem(item) {
  const catalog = [...(state.profile.catalog || [])];
  const stamped = { ...item, updatedAt: nowIso() };
  const idx = catalog.findIndex(c => c.id === item.id);
  if (idx >= 0) catalog[idx] = stamped;
  else catalog.push(stamped);
  // The catalog is merged per item, so changing it shouldn't make the rest of the profile "newer".
  state.profile = { ...state.profile, catalog };
  commit();
}

export function deleteCatalogItem(id) {
  state.profile = { ...state.profile, catalog: (state.profile.catalog || []).filter(c => c.id !== id) };
  state.tombstones.catalog[id] = nowIso();
  commit();
}

// ─── Sync engine ────────────────────────────────────────────────────────────
let timer = null;
let inFlight = false;
let again = false;
let backoff = 0;
let conflicts = 0;

function setSync(status, message = '') {
  state.sync = { status, message, at: status === 'synced' ? Date.now() : state.sync.at };
  emit('sync');
}

export function scheduleSync(delay = 700) {
  clearTimeout(timer);
  timer = setTimeout(flush, delay);
}

export async function flush() {
  if (!state.user || !state.dirty) return;
  if (inFlight) { again = true; return; }
  if (!navigator.onLine) { setSync('offline', 'You are offline. Changes are saved on this device.'); return; }
  inFlight = true;
  setSync('syncing');
  const sentVersion = state.localVersion;
  try {
    const result = await api('/api/sync', { method: 'PUT', body: { ...currentDoc(), baseRevision: state.revision } });
    state.revision = result.revision;
    if (state.localVersion === sentVersion) state.dirty = false;
    backoff = 0;
    conflicts = 0;
    persistLocal();
    setSync(state.dirty ? 'pending' : 'synced');
  } catch (error) {
    if (error.status === 409 && error.data?.data && conflicts < 5) {
      conflicts += 1;
      const remote = error.data.data;
      applyDoc(mergeDocs(currentDoc(), remote));
      state.revision = remote.revision;
      persistLocal();
      emit();
      again = true;
    } else if (error.status === 401) {
      setSync('auth', 'Your session expired. Sign in again to sync your changes.');
      onAuthLost();
    } else if (error.status === 400 || error.status === 413) {
      // The server rejected the data itself; retrying won't help until it is changed.
      setSync('error', error.message);
    } else {
      backoff = Math.min(60000, backoff ? backoff * 2 : 2000);
      setSync(navigator.onLine ? 'error' : 'offline', navigator.onLine ? `Sync failed — retrying in ${Math.round(backoff / 1000)}s.` : 'You are offline. Changes are saved on this device.');
      scheduleSync(backoff);
    }
  } finally {
    inFlight = false;
    if (again) { again = false; scheduleSync(50); }
  }
}

/** Pull changes made on other devices (only when there are no local edits pending). */
export async function refresh() {
  if (!state.user || state.dirty || inFlight) return;
  try {
    const remote = await api('/api/sync');
    if (remote.revision !== state.revision && !state.dirty) replaceFromServer(remote);
  } catch (error) {
    if (error.status === 401) { setSync('auth', 'Your session expired.'); onAuthLost(); }
  }
}

/** Waits (up to `timeoutMs`) for pending changes to upload. Resolves true if everything synced. */
export async function flushNow(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  clearTimeout(timer);
  while (state.dirty && Date.now() < deadline) {
    if (!inFlight) await flush();
    if (state.sync.status === 'auth' || state.sync.status === 'offline' || (state.sync.status === 'error' && !backoff)) break;
    await new Promise(r => setTimeout(r, 150));
  }
  return !state.dirty;
}

window.addEventListener('online', () => { if (state.dirty) scheduleSync(100); });
window.addEventListener('offline', () => { if (state.user) setSync('offline', 'You are offline. Changes are saved on this device.'); });
document.addEventListener('visibilitychange', () => {
  if (!state.user) return;
  if (document.visibilityState === 'hidden') flush();
  else refresh();
});
window.addEventListener('beforeunload', event => {
  if (state.user && state.dirty) {
    flush();
    event.preventDefault();
    event.returnValue = '';
  }
});
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 120000);
