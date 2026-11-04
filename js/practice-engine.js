// practice-engine.js
// ------------------------------------------------------------
// READ-ONLY ADAPTER from the canon (data/practices.js) to the runtime
// units the UI uses. DOM-free. It never writes files and never mutates
// the imported source objects. See docs/CANON-AND-CHANGE-CONTROL.md.
//
// SOURCE AS IT IS (not as this engine would like it to be)
//   data/practices.js is the only authority for content and order. The
//   engine reads whatever representation the source uses:
//     - Current source: { number, title, question, shortAnswer, explanation,
//       answer, source }; `answer` mirrors shortAnswer + SEPARATOR + explanation.
//     - { number, title, question, answer } with an embedded explanation
//       separator remains supported without adding any metadata elsewhere.
//     - A separate `explanation` property, if the owner ever writes one,
//       is read as written.
//     - The older { shortAnswer, explanation, answer } archive shape is
//       still readable (compatibility only).
//   Extra properties (e.g. `number`) are NOT errors.
//
// IN-MEMORY ANSWER / EXPLANATION SPLIT
//   prepared = normalizeMathVisualFences(dedent(source.answer))
//   - separator found exactly once  -> answer = before, explanation = after
//     (no trim, no further dedent; prepared === before + SEP + after)
//   - separator not found           -> whole value is the answer;
//                                      explanation = source.explanation or ''
//                                      (nothing is invented)
//   - separator found more than once -> no guessing: whole value stays the
//                                      answer, an "ambiguous separator"
//                                      diagnostic is reported
//   For the current canon `prepared` is byte-identical to the source
//   string (verified by scripts/verify-data.mjs).
//
// IDENTITY (also owned by data/practices.js)
//   An optional `id`, otherwise a positive `number`, defines a stable ID.
//   Reordering or editing text cannot reset identity. Metadata is derived
//   automatically and only supplements historical aliases/package labels.
//   Missing metadata and stale title mirrors never block new/edited units.
//
// DIAGNOSTICS report only real problems: non-array data, entries that
// cannot render (missing/non-string question or answer), non-string
// optional fields, ambiguous separators, conflicting answer mirrors,
// duplicate source identities, malformed identity metadata, invalid
// difficulty, invalid math visuals and duplicate visual ids in a unit.
// ------------------------------------------------------------

import { titleText } from './content-document.js';
import * as bank from '../data/practices.js';
import { packageManifest } from '../data/package-manifest.js';
import { dedent, hasSerializedContent } from './text-utils.js';
import { contentId, withOccurrenceSuffix, cyrb53 } from './id-utils.js';
import { isUnitId, isSourceNumber, numberedUnitId, sourceUnitId } from './unit-identity.js';
import { collectVisualDeclarations, normalizeMathVisualFences } from './math-content-parser.js';
import { parseMeta, mapHeaderToBucket } from './practice-meta.js';

export const SEPARATOR = '\n\nexplanation:\n';
/** Kept for compatibility with earlier imports; same value as SEPARATOR. */
export const LEGACY_DELIMITER = SEPARATOR;
/** The only fields the renderer cannot work without. */
export const REQUIRED_FIELDS = Object.freeze(['question', 'answer']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const prepare = (s) => normalizeMathVisualFences(dedent(s));

/** Why an entry cannot render at all (null when renderable). */
export function describeMalformation(entry) {
  if (!isPlainObject(entry)) return 'entry is not a plain object';
  for (const key of REQUIRED_FIELDS) {
    if (entry[key] === undefined) return `missing "${key}"`;
    if (typeof entry[key] !== 'string') return `"${key}" is not a string`;
    if (entry[key].trim().length === 0) return `"${key}" is empty`;
  }
  return null;
}

/** Type problems in optional fields the UI reads (never "unexpected key"). */
export function describeFieldIssues(entry) {
  const issues = [];
  if (entry.title !== undefined && typeof entry.title !== 'string') issues.push('"title" is not a string');
  if (entry.title === undefined || (typeof entry.title === 'string' && !entry.title.trim())) issues.push('no title in source; showing "Unit N"');
  if (entry.explanation !== undefined && typeof entry.explanation !== 'string') issues.push('"explanation" is not a string');
  if (entry.shortAnswer !== undefined && typeof entry.shortAnswer !== 'string') issues.push('"shortAnswer" is not a string');
  if (entry.number !== undefined && !isSourceNumber(entry.number)) issues.push('"number" must be a positive safe integer');
  if (entry.id !== undefined && !isUnitId(entry.id)) issues.push('"id" must be 2–80 letters, digits, underscores or hyphens, beginning with a letter or digit');
  return issues;
}

/**
 * Splits a source answer in memory. Pure; returns new strings only.
 * @returns {{ answer, explanation, status: 'split'|'no-separator'|'ambiguous'|'explicit'|'legacy-archive', occurrences, prepared }}
 */
export function splitAnswer(entry) {
  // Archive shape { shortAnswer, explanation }: read as written.
  if (typeof entry.shortAnswer === 'string' && typeof entry.explanation === 'string') {
    const answer = prepare(entry.shortAnswer);
    const explanation = prepare(entry.explanation);
    const prepared = prepare(entry.answer ?? entry.shortAnswer);
    const mirrorMatches = typeof entry.answer !== 'string' || entry.answer === entry.shortAnswer + SEPARATOR + entry.explanation;
    return { answer, explanation, status: 'legacy-archive', occurrences: 0, prepared, mirrorMatches };
  }
  const prepared = prepare(entry.answer);
  const occurrences = prepared.split(SEPARATOR).length - 1;
  const explicit = typeof entry.explanation === 'string' ? prepare(entry.explanation) : null;
  if (occurrences === 1 && explicit === null) {
    const at = prepared.indexOf(SEPARATOR);
    return { answer: prepared.slice(0, at), explanation: prepared.slice(at + SEPARATOR.length), status: 'split', occurrences, prepared };
  }
  if (occurrences > 1) return { answer: prepared, explanation: explicit ?? '', status: 'ambiguous', occurrences, prepared };
  return { answer: prepared, explanation: explicit ?? '', status: explicit !== null ? 'explicit' : 'no-separator', occurrences, prepared };
}

function shortRepr(entry) {
  try {
    if (!isPlainObject(entry)) return JSON.stringify(entry);
    const d = (v) => (typeof v === 'string' ? JSON.stringify(v.length > 50 ? v.slice(0, 50) + '…' : v) : String(v));
    return `{ number: ${d(entry.number)}, title: ${d(entry.title)} }`;
  } catch {
    return '[unrepresentable entry]';
  }
}

function emptyDiagnostics() {
  return {
    raw: 0, valid: 0, nonArraySource: 0, malformed: 0, fieldIssues: 0, split: 0, noSeparator: 0, ambiguousSeparator: 0, answerMirrorMismatches: 0,
    unmatchedManifest: 0, orphanManifest: 0, duplicateManifestIds: 0, duplicateSourceNumbers: 0, titleMirrorMismatches: 0,
    invalidManifestIds: 0, duplicateManifestNumbers: 0, duplicateSourceIds: 0, invalidSourceIds: 0, invalidSourceNumbers: 0, missingStableIdentity: 0,
    generatedIdentities: 0, unusedMetadata: 0, ambiguousLegacyIds: 0,
    invalidDifficulty: 0, duplicateContent: 0, invalidVisuals: 0, duplicateVisualIds: 0, available: 0, messages: [],
  };
}

function logDiagnostics(d) {
  if (typeof console === 'undefined') return;
  console.info([
    'FILSAFAT - 1 — content diagnostics',
    '----------------------------------',
    `Source entries: ${d.raw}`,
    `Renderable units: ${d.valid} (not renderable: ${d.malformed})`,
    `Answers split in memory: ${d.split} · no separator: ${d.noSeparator} · ambiguous: ${d.ambiguousSeparator}`,
    `Source identity — duplicate numbers: ${d.duplicateSourceNumbers} · duplicate ids: ${d.duplicateSourceIds} · missing stable identity: ${d.missingStableIdentity}`,
    `Invalid source numbers: ${d.invalidSourceNumbers} · invalid ids: ${d.invalidSourceIds} · answer mirror mismatches: ${d.answerMirrorMismatches}`,
    `Optional metadata — duplicate ids: ${d.duplicateManifestIds} · duplicate numbers: ${d.duplicateManifestNumbers} · invalid difficulty: ${d.invalidDifficulty}`,
    `Duplicate content: ${d.duplicateContent} · ambiguous legacy aliases: ${d.ambiguousLegacyIds}`,
    `Invalid math visuals: ${d.invalidVisuals} · duplicate visual ids in a unit: ${d.duplicateVisualIds}`,
  ].join('\n'));
}

let lastDiagnostics = null;
export function getLastDiagnostics() {
  return lastDiagnostics;
}

/**
 * Pure builder used by loadPractices(), scripts/verify-data.mjs and tests.
 * Never mutates `rawPractices` or `manifest`.
 */
export function buildPractices(rawPractices, manifest = { units: [] }, { log = false } = {}) {
  const diagnostics = emptyDiagnostics();
  const note = (msg) => { diagnostics.messages.push(msg); if (log) console.warn('practice-engine: ' + msg); };
  if (!Array.isArray(rawPractices)) {
    diagnostics.nonArraySource = 1;
    note('data/practices.js must export an array named "practices" — got ' + typeof rawPractices);
    const empty = [];
    empty.diagnostics = diagnostics;
    return empty;
  }
  diagnostics.raw = rawPractices.length;

  // ---- metadata index ----
  const records = [];
  const seenIds = new Set();
  for (const unit of Array.isArray(manifest?.units) ? manifest.units : []) {
    if (!isPlainObject(unit) || !isUnitId(unit.id)) { diagnostics.invalidManifestIds += 1; note('manifest record with an invalid id ignored'); continue; }
    if (seenIds.has(unit.id)) { diagnostics.duplicateManifestIds += 1; note(`manifest id "${unit.id}" appears more than once — later record ignored`); continue; }
    seenIds.add(unit.id);
    records.push({ unit, used: false });
  }
  const byNumber = new Map();
  for (const r of records) {
    if (!isSourceNumber(r.unit.number)) continue;
    if (byNumber.has(r.unit.number)) { diagnostics.duplicateManifestNumbers += 1; note(`manifest number ${r.unit.number} is used by more than one record`); continue; }
    byNumber.set(r.unit.number, r);
  }
  const takeByTitle = (title) => records.find((r) => !r.used && typeof r.unit.title === 'string' && r.unit.title === title);

  const sourceNumbers = new Map();
  const sourceIds = new Map();
  const contentOccurrences = new Map();
  const idOccurrences = new Map();
  const usedIds = new Set();
  // A repair suffix must never steal a different unit's authored identity.
  const reservedIds = new Set(rawPractices.map((entry) => sourceUnitId(entry, manifest?.packageId)).filter(Boolean));
  const valid = [];

  rawPractices.forEach((entry, i) => {
    const problem = describeMalformation(entry);
    if (problem) {
      diagnostics.malformed += 1;
      note(`source entry at index ${i} cannot be rendered — ${problem} ${shortRepr(entry)}`);
      return;
    }
    const fieldIssues = describeFieldIssues(entry);
    if (fieldIssues.length) { diagnostics.fieldIssues += 1; fieldIssues.forEach((m) => note(`source entry at index ${i}: ${m}`)); }

    const position = valid.length + 1;
    const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : `Unit ${position}`;
    const question = prepare(entry.question);
    const parts = splitAnswer(entry);
    if (parts.status === 'split' || parts.status === 'legacy-archive') diagnostics.split += 1;
    else if (parts.status === 'ambiguous') { diagnostics.ambiguousSeparator += 1; note(`unit ${position} ("${title.slice(0, 60)}"): the separator "\\n\\nexplanation:\\n" occurs ${parts.occurrences} times — not split; the whole value is shown as the answer`); }
    else if (parts.status === 'no-separator') diagnostics.noSeparator += 1;
    if (parts.mirrorMatches === false) {
      diagnostics.answerMirrorMismatches += 1;
      note(`unit ${position}: answer differs from shortAnswer + separator + explanation. Synchronise those fields in data/practices.js, or use answer plus a separate explanation without shortAnswer.`);
    }

    if (entry.number !== undefined && !isSourceNumber(entry.number)) diagnostics.invalidSourceNumbers += 1;
    if (entry.id !== undefined && !isUnitId(entry.id)) diagnostics.invalidSourceIds += 1;
    if (isSourceNumber(entry.number)) {
      if (sourceNumbers.has(entry.number)) { diagnostics.duplicateSourceNumbers += 1; note(`source number ${entry.number} is used by entries at index ${sourceNumbers.get(entry.number)} and ${i}`); }
      else sourceNumbers.set(entry.number, i);
    }

    // ---- optional metadata: aliases only; never a content/count gate ----
    let record = null;
    if (isSourceNumber(entry.number) && byNumber.has(entry.number) && !byNumber.get(entry.number).used) record = byNumber.get(entry.number);
    else if (!isSourceNumber(entry.number)) record = takeByTitle(entry.title);
    if (record) record.used = true;
    const fallbackId = `auto-${cyrb53(title + '␟' + question).toString(36)}`;
    const canonicalId = sourceUnitId(entry, manifest?.packageId);
    const baseId = canonicalId || record?.unit.id || fallbackId;
    if (!record && canonicalId) diagnostics.generatedIdentities += 1;
    if (!canonicalId) {
      diagnostics.missingStableIdentity += 1;
      note(`unit ${position} has no valid source number or id; temporary identity ${baseId}. Add a unique positive number in data/practices.js to keep progress stable across text edits.`);
    }
    if (sourceIds.has(baseId)) {
      diagnostics.duplicateSourceIds += 1;
      note(`source identity "${baseId}" is used by entries at index ${sourceIds.get(baseId)} and ${i}; every source number/id must identify only one unit`);
    } else sourceIds.set(baseId, i);
    let idCount = (idOccurrences.get(baseId) || 0) + 1;
    let id = withOccurrenceSuffix(baseId, idCount);
    while (usedIds.has(id) || (id !== baseId && reservedIds.has(id))) id = withOccurrenceSuffix(baseId, ++idCount);
    idOccurrences.set(baseId, idCount);
    usedIds.add(id);

    // Legacy ids: recorded ones + the content hash older engines derived
    // from question + the full combined answer value.
    const derivedLegacyId = contentId(question, parts.status === 'legacy-archive' ? parts.prepared : prepare(entry.answer));
    const legacyIds = [...new Set([
      ...(Array.isArray(record?.unit.legacyIds) ? record.unit.legacyIds.filter(isUnitId) : []),
      ...(Array.isArray(entry.legacyIds) ? entry.legacyIds.filter(isUnitId) : []),
      record?.unit.id,
      numberedUnitId(entry.number, manifest?.packageId),
      fallbackId,
      derivedLegacyId,
    ].filter((alias) => isUnitId(alias) && alias !== id))];

    const contentKey = contentId(question, prepare(entry.answer) + '␟' + (typeof entry.explanation === 'string' ? entry.explanation : ''));
    const cCount = (contentOccurrences.get(contentKey) || 0) + 1;
    contentOccurrences.set(contentKey, cCount);
    if (cCount > 1) { diagnostics.duplicateContent += 1; note(`unit ${position} duplicates the content of an earlier unit (kept).`); }

    // ---- visuals (ids unique within a unit) ----
    const visualIssues = [];
    const unitVisualIds = new Set();
    for (const [field, value] of [['question', question], ['answer', parts.answer], ['explanation', parts.explanation]]) {
      const scan = collectVisualDeclarations(value);
      diagnostics.invalidVisuals += scan.issues.length;
      scan.issues.forEach((issue) => visualIssues.push(`Unit ${position} (${field}): ${issue.message}`));
      scan.visuals.forEach((visual) => {
        if (unitVisualIds.has(visual.id)) { diagnostics.duplicateVisualIds += 1; visualIssues.push(`Unit ${position} (${field}): duplicate math-visual id "${visual.id}" within this unit.`); }
        else unitVisualIds.add(visual.id);
      });
    }
    visualIssues.forEach((m) => note(m));

    // ---- difficulty: explicit only ----
    let difficulty = null;
    const declared = Object.prototype.hasOwnProperty.call(entry, 'difficulty') ? entry.difficulty : record?.unit.difficulty;
    if (declared !== undefined && declared !== null) {
      if (typeof declared === 'string' && mapHeaderToBucket(declared)) difficulty = declared.trim();
      else { diagnostics.invalidDifficulty += 1; note(`unit ${position}: difficulty ${JSON.stringify(declared)} is not recognised (use null, "Dasar", "Menengah" or "Lanjut") — ignored`); }
    }
    if (!difficulty) difficulty = parseMeta(question).difficulty || null;

    valid.push({
      id,
      number: position,
      sourceNumber: isSourceNumber(entry.number) ? entry.number : null,
      sourceIndex: i,
      title,
      displayTitle: titleText(title, { serialized: [entry.question, entry.shortAnswer, entry.explanation, entry.answer].some(hasSerializedContent) }),
      question,
      answer: parts.answer,
      explanation: parts.explanation,
      splitStatus: parts.status,
      legacyIds,
      difficulty,
      provenance: entry.source ?? record?.unit.provenance ?? null,
      visualIssues,
      contractIssues: fieldIssues,
    });
  });

  for (const r of records) {
    if (r.used) continue;
    // Deleted units may leave migration metadata behind. The source is authoritative.
    diagnostics.unusedMetadata += 1;
  }
  // Never migrate one old record to multiple current units. Keep ambiguous aliases
  // out of the registry instead of allowing an arbitrary first match to win.
  const aliasOwners = new Map();
  for (const unit of valid) for (const alias of unit.legacyIds) {
    if (!aliasOwners.has(alias)) aliasOwners.set(alias, new Set());
    aliasOwners.get(alias).add(unit.id);
  }
  const ambiguousAliases = new Set([...aliasOwners].filter(([alias, owners]) => owners.size > 1 || usedIds.has(alias)).map(([alias]) => alias));
  diagnostics.ambiguousLegacyIds = ambiguousAliases.size;
  if (ambiguousAliases.size) {
    note(`${ambiguousAliases.size} ambiguous legacy alias(es) ignored to prevent progress from being assigned to another unit`);
    for (const unit of valid) unit.legacyIds = unit.legacyIds.filter((alias) => !ambiguousAliases.has(alias));
  }
  diagnostics.valid = valid.length;
  diagnostics.available = valid.length;
  // Back-compat aliases used by older callers.
  diagnostics.contractViolations = diagnostics.fieldIssues;
  diagnostics.legacyAdapted = valid.filter((u) => u.splitStatus === 'legacy-archive').length;
  valid.diagnostics = diagnostics;
  return valid;
}

/** True when any diagnostic needs an author's attention. */
export function hasDataProblems(d) {
  return Boolean(d.nonArraySource || d.malformed || d.fieldIssues || d.ambiguousSeparator || d.answerMirrorMismatches || d.duplicateManifestIds || d.invalidManifestIds || d.duplicateManifestNumbers || d.duplicateSourceNumbers || d.duplicateSourceIds || d.invalidSourceIds || d.invalidSourceNumbers || d.missingStableIdentity || d.invalidDifficulty || d.invalidVisuals || d.duplicateVisualIds);
}

/**
 * Loads data/practices.js + data/package-manifest.js. Never throws: any
 * failure resolves to an empty array with diagnostics, so the shell can
 * show a recoverable error state.
 */
export async function loadPractices() {
  let list;
  try {
    list = buildPractices(bank.practices, packageManifest, { log: true });
  } catch (error) {
    list = [];
    list.diagnostics = { ...emptyDiagnostics(), messages: ['engine failure: ' + (error && error.message)] };
  }
  lastDiagnostics = list.diagnostics;
  logDiagnostics(lastDiagnostics);
  return list;
}

export function getPackageManifest() {
  return packageManifest;
}
