// practice-meta.js
// ------------------------------------------------------------
// Optional metadata parsing for FILSAFAT - 1 units.
//
//   - data/practices.js owns every authored field. An optional `difficulty`
//     on a source entry is read directly; no second metadata edit is needed.
//   - A question's text MAY optionally embed a small header of the
//     form:
//       Difficulty: INTERMEDIATE | Type: A (Write Code)
//     This module extracts that header, PURELY for presentation
//     (a small badge) and for the filter bar, if an entry ever
//     includes one. The current bank does not. Copying a question
//     always copies the authored text unchanged.
//   - Entries without a recognizable header simply get
//     { difficulty: null, tipe: null } and are treated as
//     unspecified by the filter UI — they are never hidden or
//     dropped because of missing metadata.
// ------------------------------------------------------------

const HEADER_RE = /Difficulty:\s*([^|\n]+?)\s*\|\s*(?:Type|Tipe):\s*([^\n]+)/;

/**
 * Extracts { difficulty, tipe } from a practice's (already
 * dedented) question text. Returns nulls when no header is
 * present — callers must treat that as "unspecified", not as an
 * error.
 */
export function parseMeta(questionText) {
  if (typeof questionText !== 'string') return { difficulty: null, tipe: null };
  const match = questionText.match(HEADER_RE);
  if (!match) return { difficulty: null, tipe: null };
  return {
    difficulty: match[1].trim(),
    tipe: match[2].trim(),
  };
}

// ------------------------------------------------------------
// DIFFICULTY — explicit metadata only.
//
//   The previous version fell back to the entry's POSITION in the
//   array (first third = Easy, …). For a single-unit philosophy
//   package that labelled the only question "Easy" without any
//   academic judgment (audit P0). That fallback is removed.
//
//   A unit has a difficulty only when an author states one, via
//   data/practices.js (`difficulty`) or the optional question
//   header parsed above. Everything else is "Tidak ditentukan"
//   (not specified) and the filter UI hides the difficulty control
//   when no unit specifies one.
// ------------------------------------------------------------

export const DIFFICULTY_BUCKETS = Object.freeze(['Easy', 'Medium', 'Hard']);
export const DIFFICULTY_LABELS = Object.freeze({ Easy: 'Dasar', Medium: 'Menengah', Hard: 'Lanjut' });

/** Maps an authored label (English or Indonesian) to a bucket, or null. */
export function mapHeaderToBucket(rawDifficulty) {
  if (!rawDifficulty) return null;
  const v = String(rawDifficulty).toLowerCase();
  if (/\b(beginner|basic|easy|dasar|mudah|pemula)\b/.test(v)) return 'Easy';
  if (/\b(advanced|expert|hard|lanjut|lanjutan|sulit|sukar)\b/.test(v)) return 'Hard';
  if (/\b(intermediate|medium|menengah|sedang)\b/.test(v)) return 'Medium';
  return null;
}

/**
 * Difficulty bucket for one practice, or null when unspecified.
 * Accepts either an engine practice ({ difficulty }) or a raw entry
 * ({ question } with an optional header). Never positional.
 */
export function getDifficultyBucket(practice) {
  if (!practice) return null;
  const explicit = practice.difficulty ?? parseMeta(practice.question).difficulty;
  return mapHeaderToBucket(explicit);
}

/**
 * Counts per bucket plus `unspecified`. `anySpecified` tells the UI
 * whether a difficulty filter is meaningful at all.
 */
export function collectDifficulties(practices) {
  const counts = { Easy: 0, Medium: 0, Hard: 0 };
  let unspecified = 0;
  for (const p of practices) {
    const bucket = getDifficultyBucket(p);
    if (bucket) counts[bucket] += 1; else unspecified += 1;
  }
  const buckets = DIFFICULTY_BUCKETS.map((label) => ({ label, display: DIFFICULTY_LABELS[label], count: counts[label] }));
  return { buckets, unspecified, anySpecified: unspecified < practices.length };
}
