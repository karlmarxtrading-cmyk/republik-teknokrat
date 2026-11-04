// search-index.js
// ------------------------------------------------------------
// Full-content search for one package. DOM-free.
//
//   - Indexes title, question, answer and explanation, section by
//     section (plain text from the Markdown token stream, so "**" or
//     "|" never match), keeping each hit's location, e.g.
//     "Pembahasan → 5. Evaluasi Kekuatan dan Kelemahan Premis".
//   - Matching is case- and diacritic-insensitive; every query term
//     must occur somewhere in the unit (AND), hits list the sections
//     where any term occurs.
//   - Snippets are returned as { before, match, after } strings; the
//     UI builds <mark> with DOM APIs (no HTML string injection).
// ------------------------------------------------------------

import { outlineOf, titleText } from './content-document.js';

export const FIELD_LABELS = Object.freeze({ title: 'Judul', question: 'Pertanyaan', answer: 'Jawaban model', explanation: 'Pembahasan' });

/** Lowercase + strip combining marks, with a map back to source offsets. */
export function normalizeWithMap(text) {
  let norm = '';
  const map = [];
  const src = String(text);
  for (let i = 0; i < src.length; i++) {
    const out = src[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const ch of out) { norm += ch; map.push(i); }
  }
  return { norm, map };
}

export function normalizeQuery(q) {
  return String(q || '').replace(/\s+/g, ' ').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function buildSearchIndex(practices) {
  const entries = [];
  for (const p of practices) {
    const push = (field, sectionTitle, slug, text) => {
      if (!text) return;
      const norm = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      entries.push({ unitId: p.id, field, fieldLabel: FIELD_LABELS[field], sectionTitle, slug, text, norm });
    };
    push('title', null, null, p.displayTitle ?? titleText(p.title));
    for (const field of ['question', 'answer', 'explanation']) {
      for (const s of outlineOf(p[field] || '')) {
        // Heading text is searchable too (it is not in plainText's body).
        const text = (s.title ? s.title + '\n' : '') + s.plainText;
        push(field, s.title, s.slug, text);
      }
    }
  }
  return entries;
}

function snippet(entry, at, length, radius = 70) {
  // Compute offsets only for this matched fragment, never retain a character map.
  let start = at, end = at + length;
  if (/[^\x00-\x7f]/.test(entry.text)) {
    let normalizedOffset = 0, sourceOffset = 0;
    for (const character of entry.text) {
      const size = character.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().length;
      if (normalizedOffset <= at && at < normalizedOffset + size) start = sourceOffset;
      if (normalizedOffset < at + length) end = sourceOffset + character.length;
      else break;
      normalizedOffset += size; sourceOffset += character.length;
    }
  }
  let from = Math.max(0, start - radius);
  let to = Math.min(entry.text.length, end + radius);
  // Prefer word boundaries.
  if (from > 0) { const sp = entry.text.indexOf(' ', from); if (sp > -1 && sp < start) from = sp + 1; }
  if (to < entry.text.length) { const sp = entry.text.lastIndexOf(' ', to); if (sp > end) to = sp; }
  const clean = (s) => s.replace(/\s+/g, ' ');
  return {
    before: (from > 0 ? '… ' : '') + clean(entry.text.slice(from, start)),
    match: clean(entry.text.slice(start, end)),
    after: clean(entry.text.slice(end, to)) + (to < entry.text.length ? ' …' : ''),
  };
}

/**
 * @returns {Map<string, {hits: Array, score: number}>} by unit id; empty
 *   query returns null (meaning "no text filter").
 */
export function searchIndex(index, query) {
  const q = normalizeQuery(query);
  if (!q) return null;
  const terms = [...new Set(q.split(' ').filter(Boolean))].slice(0, 12);
  const byUnit = new Map();
  for (const entry of index) {
    let found = null;
    let score = 0;
    for (const term of terms) {
      const at = entry.norm.indexOf(term);
      if (at < 0) continue;
      score += entry.field === 'title' ? 5 : entry.field === 'question' ? 3 : 1;
      if (!found) found = { at, len: term.length, term };
    }
    if (!found) continue;
    if (!byUnit.has(entry.unitId)) byUnit.set(entry.unitId, { hits: [], score: 0, termsSeen: new Set() });
    const bucket = byUnit.get(entry.unitId);
    terms.forEach((t) => { if (entry.norm.includes(t)) bucket.termsSeen.add(t); });
    bucket.score += score;
    bucket.hits.push({
      field: entry.field,
      fieldLabel: entry.fieldLabel,
      sectionTitle: entry.sectionTitle,
      slug: entry.slug,
      location: entry.sectionTitle ? `${entry.fieldLabel} → ${entry.sectionTitle}` : entry.fieldLabel,
      snippet: snippet(entry, found.at, found.len),
    });
  }
  for (const [id, bucket] of byUnit) {
    if (bucket.termsSeen.size < terms.length) byUnit.delete(id);
    else delete bucket.termsSeen;
  }
  return byUnit;
}

// Yield between independent units. No worker copy of the corpus, and no
// synchronous full-bank parse hidden inside requestIdleCallback.
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
export async function buildSearchIndexAsync(practices, onProgress = () => {}) {
  const entries = [];
  for (let i = 0; i < practices.length; i++) {
    entries.push(...buildSearchIndex([practices[i]]));
    onProgress(i + 1, practices.length);
    await yieldTask();
  }
  return entries;
}
export async function searchIndexAsync(index, query) {
  if (!normalizeQuery(query)) return null;
  const result = new Map();
  let start = 0;
  while (start < index.length) {
    let end = start + 1;
    while (end < index.length && index[end].unitId === index[start].unitId) end++;
    for (const [id, hit] of searchIndex(index.slice(start, end), query)) result.set(id, hit);
    start = end;
    await yieldTask();
  }
  return result;
}
