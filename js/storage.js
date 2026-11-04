// storage.js
// ------------------------------------------------------------
// Safe localStorage adapter shared by every state module.
//
//   - Every call is wrapped: private mode, disabled storage, quota
//     errors and SecurityError never throw into the UI.
//   - When storage is unusable the adapter switches to an in-memory
//     map for the rest of the session and reports status "memory",
//     so the UI can say plainly that changes will not survive a reload.
//   - Status changes are broadcast as `filsafat:storage-status`.
// ------------------------------------------------------------

const memory = new Map();
const dirty = new Set();
let status = 'unknown'; // 'ok' | 'memory' | 'error'
let lastError = null;
let backend = null;

function probe() {
  if (backend !== null) return backend;
  try {
    const ls = globalThis.localStorage;
    const k = '__filsafat_probe__';
    ls.setItem(k, '1');
    ls.removeItem(k);
    backend = ls;
    setStatus('ok');
  } catch (error) {
    backend = false;
    lastError = error;
    setStatus('memory');
  }
  return backend;
}

function setStatus(next, error) {
  if (error) lastError = error;
  if (status === next) return;
  status = next;
  try {
    globalThis.dispatchEvent?.(new CustomEvent('filsafat:storage-status', { detail: { status, error: lastError ? String(lastError.message || lastError) : null } }));
  } catch { /* non-browser */ }
}

export function getStorageStatus() {
  probe();
  return { status, error: lastError ? String(lastError.message || lastError) : null };
}

export function getItem(key) {
  const ls = probe();
  if (!ls) return memory.has(key) ? memory.get(key) : null;
  try {
    return dirty.has(key) ? memory.get(key) ?? null : ls.getItem(key);
  } catch (error) {
    setStatus('error', error);
    return memory.has(key) ? memory.get(key) : null;
  }
}

/** @returns {boolean} true when the value is durably stored (not memory-only). */
export function setItem(key, value) {
  const ls = probe();
  memory.set(key, value);
  dirty.add(key);
  if (!ls) return false;
  try {
    ls.setItem(key, value);
    dirty.delete(key);
    if (!dirty.size && status !== 'ok') setStatus('ok');
    return true;
  } catch (error) {
    setStatus('error', error); // e.g. QuotaExceededError — value kept in memory
    return false;
  }
}

export function removeItem(key) {
  const ls = probe();
  memory.delete(key);
  dirty.delete(key);
  if (!ls) return false;
  try { ls.removeItem(key); return true; } catch (error) { dirty.add(key); setStatus('error', error); return false; }
}

export function keys() {
  const ls = probe();
  if (!ls) return [...memory.keys()];
  try {
    const out = [];
    for (let i = 0; i < ls.length; i++) out.push(ls.key(i));
    return out;
  } catch (error) {
    setStatus('error', error);
    return [...memory.keys()];
  }
}

export function readJSON(key, fallback = null) {
  const raw = getItem(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function writeJSON(key, value) {
  return setItem(key, JSON.stringify(value));
}

/** Test hook: forget the probed backend (e.g. after stubbing localStorage). */
export function __resetStorageForTests() {
  backend = null;
  status = 'unknown';
  lastError = null;
  memory.clear();
  dirty.clear();
}
