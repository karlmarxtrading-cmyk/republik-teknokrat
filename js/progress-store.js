// progress-store.js
// ------------------------------------------------------------
// Local learning state for FILSAFAT - 1: what the learner actually
// DID with each unit, their written responses, revisions, notes and
// bookmarks. Device-local only (localStorage via js/storage.js); never
// sent anywhere, never synced.
//
// KEYS (namespaced so other apps on the same origin are untouched)
//   filsafat-1:v1:unit:<unitId>   one JSON document per unit
//   filsafat-1:v1:prefs           view mode, last unit
//   filsafat-1:v1:migration       migration journal
//
// HONEST PROGRESS
//   Steps are recorded from real actions (opened the unit, wrote a
//   response, opened the model answer, opened the explanation, saved a
//   revision). "Selesai untuk sekarang", "Perlu ditinjau ulang" and
//   "Saya merasa memahami" are explicit self-assessments, labelled as
//   such in the UI. Nothing here is a score or a verified assessment.
//
// CONCURRENCY
//   Each top-level field carries a timestamp (fieldTimes). A write
//   re-reads the stored document and keeps, per field, the newer value,
//   so two tabs (or a stale debounced autosave) cannot clobber a newer
//   edit wholesale.
//
// LEGACY MIGRATION (idempotent, non-destructive)
//   Old "✓ Mastered" marks lived under `practice-mastery:<contentId>`
//   (and earlier `practice-mastery:practice-<N>`, translated through
//   js/practice-legacy-ids.js). A mark on any of a unit's legacyIds
//   becomes the self-assessment "Saya merasa memahami". Each migrated
//   key is recorded in the unit's `migratedFrom`, so re-running never
//   re-applies a mark the learner has since removed. Old keys are NOT
//   deleted (they may belong to another app on the same origin).
// ------------------------------------------------------------

import { getItem, keys as storageKeys, readJSON, writeJSON, removeItem, getStorageStatus } from './storage.js';
import { legacyPositionalIds } from './practice-legacy-ids.js';
import { resolveUnitId } from './unit-identity.js';

export const PACKAGE_ID = 'filsafat-1';
export const NS = `${PACKAGE_ID}:v1:`;
const UNIT_PREFIX = `${NS}unit:`;
const PREFS_KEY = `${NS}prefs`;
const MIGRATION_KEY = `${NS}migration`;
const LEGACY_MASTERY_PREFIX = 'practice-mastery:';
// Writing is preserved in full. Storage quota is reported, never silently sliced.
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_HISTORY = 40;
const MAX_BOOKMARKS = 200;

export const RESPONSE_FIELDS = Object.freeze([
  { key: 'position', label: 'Posisi awal saya', hint: 'Apa jawaban Anda atas pertanyaan ini, dalam satu atau dua kalimat?' },
  { key: 'reasons', label: 'Alasan pendukung', hint: 'Mengapa Anda memegang posisi itu? Tulis premis atau alasan utama.' },
  { key: 'evidence', label: 'Bukti, contoh, atau sumber', hint: 'Data, pengalaman, contoh, atau bacaan yang mendukung alasan Anda.' },
  { key: 'counter', label: 'Sanggahan terkuat', hint: 'Keberatan paling kuat terhadap posisi Anda.' },
  { key: 'rebuttal', label: 'Tanggapan terhadap sanggahan', hint: 'Bagaimana Anda menjawab keberatan itu — atau bagian mana yang Anda terima?' },
  { key: 'confidence', label: 'Tingkat keyakinan dan alasannya', hint: 'Misalnya: “cukup yakin, karena… tetapi belum yakin tentang…”.' },
]);
const RESPONSE_KEYS = RESPONSE_FIELDS.map((f) => f.key).concat('revision');

export const STEPS = Object.freeze([
  { key: 'opened', label: 'Mulai mempelajari' },
  { key: 'attempted', label: 'Menulis respons awal' },
  { key: 'answerOpened', label: 'Membuka jawaban model' },
  { key: 'explanationOpened', label: 'Membuka pembahasan' },
  { key: 'revised', label: 'Menyimpan revisi posisi' },
]);
export const FLAGS = Object.freeze([
  { key: 'done', label: 'Selesai untuk sekarang' },
  { key: 'review', label: 'Perlu ditinjau ulang' },
  { key: 'understood', label: 'Saya merasa memahami', note: 'penilaian diri, bukan hasil asesmen' },
]);

const now = () => Date.now();
const str = (v) => (typeof v === 'string' ? v : '');
const ts = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : null);

export function emptyUnitState() {
  return {
    v: 1,
    opened: null,
    answerOpened: null,
    explanationOpened: null,
    response: Object.fromEntries(RESPONSE_KEYS.map((k) => [k, ''])),
    history: [],
    revisedAt: null,
    flags: { done: false, review: false, understood: false },
    notes: '',
    bookmarks: [],
    migratedFrom: [],
    fieldTimes: {},
    updatedAt: null,
  };
}

/** Validates and clamps any (possibly hostile) object into a unit state. */
export function normalizeUnitState(input) {
  const base = emptyUnitState();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  for (const k of ['opened', 'answerOpened', 'explanationOpened', 'revisedAt', 'updatedAt']) base[k] = ts(input[k]);
  const r = input.response && typeof input.response === 'object' ? input.response : {};
  for (const k of RESPONSE_KEYS) base.response[k] = str(r[k]);
  base.history = (Array.isArray(input.history) ? input.history : []).slice(-MAX_HISTORY).filter((h) => h && typeof h === 'object').map((h) => ({
    at: ts(h.at) || 0,
    kind: h.kind === 'revised' ? 'revised' : 'before-answer',
    response: Object.fromEntries(RESPONSE_KEYS.map((k) => [k, str(h.response?.[k])])),
  }));
  const f = input.flags && typeof input.flags === 'object' ? input.flags : {};
  for (const k of Object.keys(base.flags)) base.flags[k] = f[k] === true;
  base.notes = str(input.notes);
  base.bookmarks = (Array.isArray(input.bookmarks) ? input.bookmarks : []).slice(0, MAX_BOOKMARKS).filter((b) => b && typeof b.slug === 'string').map((b) => ({
    field: b.field === 'explanation' ? 'explanation' : 'answer',
    slug: String(b.slug).replace(/[^a-z0-9-]/g, '').slice(0, 64),
    title: str(b.title).slice(0, 300),
    at: ts(b.at) || 0,
  }));
  base.migratedFrom = (Array.isArray(input.migratedFrom) ? input.migratedFrom : []).filter((x) => typeof x === 'string').slice(0, 50);
  const ft = input.fieldTimes && typeof input.fieldTimes === 'object' ? input.fieldTimes : {};
  for (const [k, v] of Object.entries(ft)) if ((Object.prototype.hasOwnProperty.call(base, k) || RESPONSE_KEYS.some(key=>k === `response.${key}`)) && (ts(v) || v === 0)) base.fieldTimes[k] = ts(v) || 0;
  return base;
}

const cache = new Map();
const listeners = new Set();
function emit(unitId, source = 'local') {
  for (const fn of listeners) { try { fn(unitId, source); } catch (e) { console.warn('progress-store listener failed', e); } }
}
export function onProgressChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getUnitState(unitId) {
  if (!cache.has(unitId)) cache.set(unitId, normalizeUnitState(readJSON(UNIT_PREFIX + unitId)));
  return cache.get(unitId);
}

/**
 * Applies `mutator(draft)` to a unit and persists it with per-field
 * last-writer-wins merging against whatever is currently stored.
 * @returns {{ state, durable }}
 */
export function updateUnitState(unitId, mutator) {
  const before = JSON.stringify(getUnitState(unitId));
  const draft = normalizeUnitState(JSON.parse(before));
  for (const key of RESPONSE_KEYS) draft.fieldTimes[`response.${key}`] ??= draft.fieldTimes.response || 0;
  mutator(draft);
  const stored = normalizeUnitState(readJSON(UNIT_PREFIX + unitId));
  const t = Math.max(now(), (stored.updatedAt || 0) + 1, (draft.updatedAt || 0) + 1);
  const after = normalizeUnitState(draft);
  for (const k of Object.keys(after)) {
    if (k === 'fieldTimes' || k === 'updatedAt') continue;
    if (JSON.stringify(after[k]) !== JSON.stringify(JSON.parse(before)[k])) after.fieldTimes[k] = t;
  }
  for (const key of RESPONSE_KEYS) if (after.response[key] !== JSON.parse(before).response[key]) after.fieldTimes[`response.${key}`] = t;
  after.updatedAt = t;
  const merged = mergeStates(stored, after);
  cache.set(unitId, merged);
  const durable = writeJSON(UNIT_PREFIX + unitId, merged);
  emit(unitId);
  return { state: merged, durable };
}

/** Per-field newer-wins merge. Exported for tests. */
export function mergeStates(a, b) {
  const out = normalizeUnitState(a);
  for (const k of Object.keys(out)) {
    if (k === 'fieldTimes' || k === 'updatedAt') continue;
    if (k === 'response') {
      for (const key of RESPONSE_KEYS) {
        const ta = a.fieldTimes?.[`response.${key}`] ?? a.fieldTimes?.response ?? 0;
        const tb = b.fieldTimes?.[`response.${key}`] ?? b.fieldTimes?.response ?? 0;
        if (tb >= ta) out.response[key] = b.response[key];
        out.fieldTimes[`response.${key}`] = Math.max(ta,tb);
      }
      out.fieldTimes.response = Math.max(a.fieldTimes?.response || 0,b.fieldTimes?.response || 0);
      continue;
    }
    const ta = a.fieldTimes?.[k] || 0;
    const tb = b.fieldTimes?.[k] || 0;
    if (tb >= ta) { out[k] = b[k]; out.fieldTimes[k] = tb || ta || undefined; }
  }
  for (const k of Object.keys(out.fieldTimes)) if (!out.fieldTimes[k] && !k.startsWith('response.')) delete out.fieldTimes[k];
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0) || null;
  return normalizeUnitState(out);
}

// ---------- derived, honest status ----------
export function hasInitialResponse(state) {
  return RESPONSE_FIELDS.some((f) => state.response[f.key].trim());
}
export function stepsOf(state) {
  return {
    opened: Boolean(state.opened),
    attempted: hasInitialResponse(state),
    answerOpened: Boolean(state.answerOpened),
    explanationOpened: Boolean(state.explanationOpened),
    revised: Boolean(state.revisedAt),
  };
}
export function hasActivity(state) {
  const s = stepsOf(state);
  return Object.values(s).some(Boolean) || Object.values(state.flags).some(Boolean) || Boolean(state.notes.trim()) || state.bookmarks.length > 0;
}
/** Short, truthful one-line status for lists. */
export function statusLabel(state) {
  if (state.flags.review) return 'Perlu ditinjau ulang';
  if (state.flags.done) return 'Selesai untuk sekarang';
  const s = stepsOf(state);
  if (s.revised) return 'Sudah merevisi posisi';
  if (s.explanationOpened) return 'Sudah membuka pembahasan';
  if (s.answerOpened) return 'Sudah membuka jawaban model';
  if (s.attempted) return 'Sudah mencoba menjawab';
  if (s.opened) return 'Sedang dipelajari';
  return 'Belum dipelajari';
}

export const STATUS_FILTERS = Object.freeze([
  { value: 'all', label: 'Semua status' },
  { value: 'untouched', label: 'Belum dipelajari', test: (s) => !hasActivity(s) },
  { value: 'in-progress', label: 'Sedang dipelajari', test: (s) => hasActivity(s) && !s.flags.done },
  { value: 'attempted', label: 'Sudah mencoba menjawab', test: (s) => stepsOf(s).attempted },
  { value: 'answer', label: 'Sudah membuka jawaban model', test: (s) => stepsOf(s).answerOpened },
  { value: 'explanation', label: 'Sudah membuka pembahasan', test: (s) => stepsOf(s).explanationOpened },
  { value: 'revised', label: 'Sudah merevisi posisi', test: (s) => stepsOf(s).revised },
  { value: 'done', label: 'Selesai untuk sekarang', test: (s) => s.flags.done },
  { value: 'review', label: 'Perlu ditinjau ulang', test: (s) => s.flags.review },
  { value: 'understood', label: 'Saya merasa memahami (penilaian diri)', test: (s) => s.flags.understood },
  { value: 'bookmarked', label: 'Memiliki penanda bagian', test: (s) => s.bookmarks.length > 0 },
]);

// ---------- actions ----------
export function markStep(unitId, step) {
  const state = getUnitState(unitId);
  if (state[step]) return state;
  return updateUnitState(unitId, (d) => {
    d[step] = now();
    if (step !== 'opened' && !d.opened) d.opened = d[step];
  }).state;
}

export function setResponseField(unitId, key, value) {
  if (!RESPONSE_KEYS.includes(key)) throw new Error('unknown response field ' + key);
  return updateUnitState(unitId, (d) => {
    d.response[key] = str(value);
    if (!d.opened) d.opened = now();
  });
}

/** Snapshot taken the first time the model answer is opened. */
export function snapshotBeforeAnswer(unitId) {
  const state = getUnitState(unitId);
  if (!hasInitialResponse(state) || state.history.some((h) => h.kind === 'before-answer')) return state;
  return updateUnitState(unitId, (d) => { d.history.push({ at: now(), kind: 'before-answer', response: { ...d.response } }); }).state;
}

export function saveRevision(unitId) {
  return updateUnitState(unitId, (d) => {
    d.revisedAt = now();
    d.history.push({ at: d.revisedAt, kind: 'revised', response: { ...d.response } });
  });
}

export function setFlag(unitId, flag, value) {
  return updateUnitState(unitId, (d) => { d.flags[flag] = Boolean(value); });
}

export function setNotes(unitId, text) {
  return updateUnitState(unitId, (d) => { d.notes = str(text); });
}

export function toggleBookmark(unitId, { field, slug, title }) {
  let added = false;
  const result = updateUnitState(unitId, (d) => {
    const i = d.bookmarks.findIndex((b) => b.field === field && b.slug === slug);
    if (i >= 0) d.bookmarks.splice(i, 1);
    else { d.bookmarks.push({ field, slug, title, at: now() }); added = true; }
  });
  return { ...result, added };
}

/** Deletes the learner's writing for one unit (responses, history, notes). */
export function clearUnitWriting(unitId) {
  return updateUnitState(unitId, (d) => {
    for (const k of RESPONSE_KEYS) d.response[k] = '';
    d.history = [];
    d.notes = '';
    d.revisedAt = null;
  });
}

/** Deletes every FILSAFAT - 1 key (never touches other apps' keys). */
export function clearAllPackageState() {
  const failed = [];
  for (const key of storageKeys()) if (key && key.startsWith(NS) && !removeItem(key)) failed.push(key);
  cache.clear();
  emit(null);
  return {durable:failed.length === 0,failed};
}

export function getPrefs() {
  const p = readJSON(PREFS_KEY, {}) || {};
  return { mode: p.mode === 'focus' ? 'focus' : 'overview', lastUnit: typeof p.lastUnit === 'string' ? p.lastUnit : null };
}
export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  writeJSON(PREFS_KEY, next);
  return next;
}

// ---------- legacy migration ----------
/**
 * @param {Array<{id:string, legacyIds:string[]}>} units
 * @returns {{ migrated: Array<{unitId,key}>, checked: number }}
 */
export function migrateLegacyProgress(units) {
  const migrated = [];
  let checked = 0;
  const positionalByLegacyId = new Map();
  legacyPositionalIds.forEach((legacyId, n) => {
    if (!positionalByLegacyId.has(legacyId)) positionalByLegacyId.set(legacyId, []);
    positionalByLegacyId.get(legacyId).push(n);
  });
  for (const unit of units) {
    // v2.2.0: preserve complete state previously stored under fallback IDs.
    // Keep old keys, merge field timestamps, and journal each copy so a later
    // deliberate clearing of a new field cannot resurrect an old value.
    for (const alias of unit.legacyIds || []) {
      if (alias === unit.id) continue;
      const key = UNIT_PREFIX + alias;
      const old = readJSON(key);
      const current = getUnitState(unit.id);
      if (!old || current.migratedFrom.includes(key)) continue;
      const merged = readJSON(UNIT_PREFIX + unit.id) ? mergeStates(normalizeUnitState(old), current) : normalizeUnitState(old);
      merged.migratedFrom = [...new Set([...merged.migratedFrom, ...current.migratedFrom, key])];
      cache.set(unit.id, merged);
      if (writeJSON(UNIT_PREFIX + unit.id, merged)) migrated.push({ unitId: unit.id, key });
    }
    const candidates = [];
    for (const legacyId of unit.legacyIds || []) {
      candidates.push(LEGACY_MASTERY_PREFIX + legacyId);
      for (const n of positionalByLegacyId.get(legacyId) || []) candidates.push(`${LEGACY_MASTERY_PREFIX}practice-${n}`);
    }
    for (const key of candidates) {
      checked += 1;
      if (getItem(key) !== '1') continue;
      const state = getUnitState(unit.id);
      if (state.migratedFrom.includes(key)) continue; // idempotent
      const { durable } = updateUnitState(unit.id, (d) => {
        d.flags.understood = true;
        d.migratedFrom.push(key);
      });
      // Verify by reading back before recording success in the journal.
      const back = normalizeUnitState(readJSON(UNIT_PREFIX + unit.id));
      if (durable && back.migratedFrom.includes(key) && back.flags.understood) migrated.push({ unitId: unit.id, key });
    }
  }
  const prefs = getPrefs();
  const resolved = resolveUnitId(prefs.lastUnit, units);
  if (resolved && resolved !== prefs.lastUnit) setPrefs({ lastUnit: resolved });
  const journal = readJSON(MIGRATION_KEY, { version: 1, runs: [] }) || { version: 1, runs: [] };
  journal.runs = (Array.isArray(journal.runs) ? journal.runs : []).slice(-9);
  journal.runs.push({ at: now(), checked, migrated: migrated.length });
  writeJSON(MIGRATION_KEY, journal);
  return { migrated, checked };
}

// ---------- backup / restore ----------
export function exportBackup(units, manifest) {
  const data = {};
  for (const u of units) {
    const s = getUnitState(u.id);
    if (hasActivity(s) || s.migratedFrom.length) data[u.id] = s;
  }
  return {
    format: 'filsafat-1-backup',
    version: 1,
    packageId: manifest?.packageId || PACKAGE_ID,
    exportedAt: new Date().toISOString(),
    note: 'Cadangan lokal progres dan catatan FILSAFAT - 1. Dapat dipulihkan melalui menu Data lokal.',
    units: data,
    prefs: getPrefs(),
  };
}

/**
 * Validates a backup WITHOUT applying it.
 * @returns {{ ok: boolean, error?: string, units?: object, unknown?: string[] }}
 */
export function validateBackup(json, knownUnitIds) {
  let value = json;
  if (typeof json === 'string') {
    if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) return { ok: false, error: 'Cadangan melebihi batas impor 50 MiB. Simpan berkas asli; data belum diubah.' };
    try { value = JSON.parse(json); } catch { return { ok: false, error: 'Berkas bukan JSON yang valid.' }; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Struktur cadangan tidak dikenali.' };
  if (value.format !== 'filsafat-1-backup') return { ok: false, error: 'Ini bukan berkas cadangan FILSAFAT - 1.' };
  if (value.version !== 1) return { ok: false, error: 'Versi cadangan tidak didukung.' };
  if (value.packageId !== PACKAGE_ID) return { ok: false, error: 'Cadangan ini milik paket lain.' };
  if (!value.units || typeof value.units !== 'object' || Array.isArray(value.units)) return { ok: false, error: 'Cadangan tidak memuat data unit.' };
  // Accept old callers with string IDs and the UI's full registry with aliases.
  const registry = knownUnitIds.map((u) => typeof u === 'string' ? { id: u } : u);
  const units = {};
  const unknown = [];
  const entries = Object.entries(value.units).sort(([a], [b]) =>
    Number(registry.some((u) => u.id === a)) - Number(registry.some((u) => u.id === b)));
  for (const [id, state] of entries) {
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
    const resolved = resolveUnitId(id, registry);
    if (!resolved) { unknown.push(id); continue; }
    const normalized = normalizeUnitState(state);
    units[resolved] = units[resolved] ? mergeStates(units[resolved], normalized) : normalized;
  }
  return { ok: true, units, unknown };
}

export function applyBackup(validated) {
  if (!validated?.ok) throw new Error('backup not validated');
  const originals = new Map(Object.keys(validated.units).map(id => [id, normalizeUnitState(getUnitState(id))]));
  const results = [];
  for (const [id, state] of Object.entries(validated.units)) {
    const t = now();
    const s = normalizeUnitState(state);
    for (const k of Object.keys(s)) if (k !== 'fieldTimes' && k !== 'updatedAt') s.fieldTimes[k] = t;
    for (const key of RESPONSE_KEYS) s.fieldTimes[`response.${key}`] = t;
    s.updatedAt = t;
    const durable = writeJSON(UNIT_PREFIX + id, s);
    results.push({ id, durable });
    if (!durable) {
      // localStorage has no transaction: roll back every attempted write.
      const rollback = results.map(({ id: key }) => {
        const old = originals.get(key);
        const restored = writeJSON(UNIT_PREFIX + key, old);
        cache.set(key, old);
        emit(key);
        return { id: key, durable: restored };
      });
      return { durable: false, status: rollback.every(r => r.durable) ? 'rolled-back' : 'rollback-incomplete', results, rollback,
        recovery: Object.fromEntries(originals) };
    }
    cache.set(id, s);
  }
  results.forEach(({id}) => emit(id));
  return { durable: true, status: 'complete', results, rollback: [] };
}

// ---------- cross-tab sync ----------
export function handleExternalStorageEvent(event) {
  if (!event || typeof event.key !== 'string' || !event.key.startsWith(UNIT_PREFIX)) return;
  const unitId = event.key.slice(UNIT_PREFIX.length);
  const incoming = normalizeUnitState(readJSON(event.key));
  const mine = cache.get(unitId);
  cache.set(unitId, mine ? mergeStates(mine, incoming) : incoming);
  emit(unitId, 'external');
}

export function __clearProgressCacheForTests() {
  cache.clear();
  listeners.clear();
}

export { getStorageStatus };
