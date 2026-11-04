// id-utils.js
// ------------------------------------------------------------
// Deterministic, content-derived IDs for practice entries.
//
//   - practice-engine.js used to key each card off its position in
//     data/practices.js (`practice-${i}`). That breaks the moment
//     the array is reordered, or an entry is inserted/removed
//     anywhere before it — a later question silently inherits an
//     earlier one's saved "✓ Mastered" state.
//   - contentId() replaces that with an id derived only from the
//     entry's own (already dedented) question + answer text, using
//     a small non-cryptographic string hash (cyrb53). Same content
//     always hashes to the same id, regardless of where it sits in
//     the array — so reordering, inserting, or removing unrelated
//     entries never changes an existing entry's id.
//   - withOccurrenceSuffix() handles the case contentId() alone
//     can't: two entries with byte-identical content (a true
//     authored duplicate) hash to the same base id. Rather than
//     using that collision as a reason to drop the second entry
//     (the old behavior — see practice-legacy-ids.js's own history
//     of this), practice-engine.js keeps both and asks this module
//     to make their ids distinct, so each still gets its own DOM
//     node and its own independent mastery/localStorage key.
//   - This is NOT a cryptographic hash and collisions are only
//     "unlikely", not impossible — fine for a client-side dataset
//     of a few thousand entries keying a localStorage flag, not
//     appropriate for anything security-sensitive.
//   - Never authored by hand, never shown in the UI — purely an
//     internal DOM/localStorage key, same role the old positional
//     id played. See practice-legacy-ids.js for the one-time
//     migration off the old positional scheme.
// ------------------------------------------------------------

// A rare separator that won't plausibly appear inside authored
// question/answer text, so `question + answer` pairs that differ
// only in where one ends and the other begins can't collide.
const SEPARATOR = '\u241F';

/**
 * cyrb53 — small, fast, well-distributed 53-bit string hash.
 * Deterministic across runs/engines for the same input string.
 * (Public-domain algorithm by bryc; used here verbatim.)
 */
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Returns a stable, content-derived id for one practice entry.
 * `question`/`answer` should be the already-dedented strings (the
 * exact text that gets rendered and copied) so the id tracks what
 * the learner actually sees, not incidental source formatting.
 */
export function contentId(question, answer) {
  const raw = `${question}${SEPARATOR}${answer}`;
  return `p_${cyrb53(raw).toString(36)}`;
}

/**
 * Disambiguates a base id (either contentId()'s output or an
 * authored entry.id) for the 2nd, 3rd, ... occurrence of the same
 * base id in the dataset.
 *
 *   - `occurrence` is 1-based: the FIRST entry to produce a given
 *     base id always keeps that id unchanged (occurrence === 1),
 *     so nothing that already exists in a learner's localStorage
 *     (keyed off the old plain contentId — see
 *     js/practice-legacy-ids.js) ever stops resolving.
 *   - Every later entry with the same base id (occurrence > 1) —
 *     whether that's two authored ids colliding or two questions
 *     whose content hashes to the same contentId — gets a distinct
 *     suffixed id, so it renders as its own card with its own
 *     independent mastery state instead of being silently dropped
 *     (see js/practice-engine.js).
 *   - The separator is deliberately NOT part of the base id's own
 *     alphabet (`p_<base36>` or an authored string) closely enough
 *     to matter here: collisions between "id__dup2" as an *authored*
 *     id and this suffix scheme are exactly as (im)plausible as any
 *     other accidental authored-id collision, which is already an
 *     accepted, documented tradeoff of allowing free-text authored
 *     ids at all.
 */
export function withOccurrenceSuffix(baseId, occurrence) {
  return occurrence <= 1 ? baseId : `${baseId}__dup${occurrence}`;
}
