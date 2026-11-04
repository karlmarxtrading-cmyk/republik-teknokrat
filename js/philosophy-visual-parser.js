// philosophy-visual-parser.js
// ------------------------------------------------------------
// Pure validator for ```philosophy-visual fenced JSON blocks
// (docs/CONTENT-SCHEMA.md §philosophy-visual). Semantically separate from
// math-visual: these describe arguments, concepts and traditions.
//
// Integrity rules (so a diagram can never assert more than the text):
//   - every node/edge must reference declared ids; no self-loops;
//   - relations come from a closed vocabulary with plain-language labels;
//   - TIMELINE events MUST carry a non-empty `source` — historical
//     relations are not drawn without one;
//   - payload size, counts, string lengths and nesting are bounded;
//   - "__proto__"/"constructor"/"prototype" keys are rejected.
// ------------------------------------------------------------

import { parseLogic, variablesOf, MAX_VARIABLES } from './logic.js';

export const PHILOSOPHY_VISUAL_TYPES = Object.freeze(['ARGUMENT_MAP', 'DIALECTICAL_FLOW', 'CONCEPT_MAP', 'PREMISE_MATRIX', 'COMPARISON_MATRIX', 'TIMELINE', 'TRUTH_TABLE']);

export const ARGUMENT_NODE_KINDS = Object.freeze({
  question: 'Pertanyaan', claim: 'Tesis / klaim', premise: 'Premis', reason: 'Alasan', evidence: 'Bukti / contoh',
  inference: 'Inferensi', conclusion: 'Kesimpulan', counter: 'Sanggahan', rebuttal: 'Tanggapan', limitation: 'Batas kesimpulan',
});
export const ARGUMENT_RELATIONS = Object.freeze({
  supports: 'mendukung', attacks: 'membantah', assumes: 'mengasumsikan', concludes: 'menyimpulkan', limits: 'membatasi', exemplifies: 'memberi contoh bagi', answers: 'menanggapi',
});
export const CONCEPT_RELATIONS = Object.freeze({
  broader: 'lebih luas dari', narrower: 'lebih sempit dari', opposite: 'berlawanan dengan', prerequisite: 'prasyarat bagi',
  example: 'contoh dari', counterexample: 'kontra-contoh bagi', implies: 'berimplikasi pada', related: 'berkaitan dengan',
});
export const FLOW_STAGES = Object.freeze({
  question: 'Pertanyaan', position: 'Posisi awal', definition: 'Pengujian definisi', premises: 'Pemeriksaan premis', counter: 'Sanggahan',
  rebuttal: 'Tanggapan', revision: 'Revisi posisi', synthesis: 'Sintesis', limits: 'Batas kesimpulan',
});
export const PREMISE_TYPES = Object.freeze({ empirical: 'empiris', conceptual: 'konseptual', moral: 'moral', legal: 'hukum', interpretive: 'interpretatif' });

const MAX_JSON = 60000;
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 400) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const optText = (v, max = 400) => v === undefined || (typeof v === 'string' && v.length <= max);

function checkDepth(value, depth = 0) {
  if (depth > 8) throw new Error('Struktur JSON terlalu dalam (maksimum 8 tingkat).');
  if (Array.isArray(value)) value.forEach((v) => checkDepth(v, depth + 1));
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) { if (BAD_KEYS.has(k)) throw new Error(`Kunci "${k}" tidak diizinkan.`); checkDepth(v, depth + 1); }
}

function graph(data, kinds, relations, { kindRequired }) {
  if (!Array.isArray(data.nodes) || data.nodes.length < 2 || data.nodes.length > 60) return 'nodes harus berisi 2–60 simpul.';
  const ids = new Set();
  for (const [i, n] of data.nodes.entries()) {
    if (!isObj(n) || typeof n.id !== 'string' || !ID_RE.test(n.id)) return `Simpul ${i + 1}: id tidak valid.`;
    if (ids.has(n.id)) return `Simpul "${n.id}" dideklarasikan dua kali.`;
    ids.add(n.id);
    if (!text(n.text ?? n.label, 300)) return `Simpul "${n.id}": teks wajib diisi (maksimum 300 karakter).`;
    if (kindRequired && !Object.hasOwn(kinds, n.kind)) return `Simpul "${n.id}": jenis "${n.kind}" tidak dikenal. Pilihan: ${Object.keys(kinds).join(', ')}.`;
    if (n.section !== undefined && !(typeof n.section === 'string' && /^[a-z0-9-]{1,64}$/.test(n.section))) return `Simpul "${n.id}": section harus berupa slug bagian (huruf kecil, angka, tanda hubung).`;
    if (!optText(n.note, 400)) return `Simpul "${n.id}": catatan terlalu panjang.`;
  }
  if (!Array.isArray(data.edges) || data.edges.length < 1 || data.edges.length > 120) return 'edges harus berisi 1–120 relasi.';
  const seen = new Set();
  for (const [i, e] of data.edges.entries()) {
    if (!isObj(e)) return `Relasi ${i + 1} tidak valid.`;
    if (!ids.has(e.from) || !ids.has(e.to)) return `Relasi ${i + 1}: from/to harus merujuk id simpul yang ada.`;
    if (e.from === e.to) return `Relasi ${i + 1}: simpul tidak boleh berelasi dengan dirinya sendiri.`;
    if (!Object.hasOwn(relations, e.relation)) return `Relasi ${i + 1}: jenis "${e.relation}" tidak dikenal. Pilihan: ${Object.keys(relations).join(', ')}.`;
    if (!optText(e.label, 120)) return `Relasi ${i + 1}: label terlalu panjang.`;
    const key = `${e.from}>${e.to}>${e.relation}`;
    if (seen.has(key)) return `Relasi ${i + 1} duplikat.`;
    seen.add(key);
  }
  return null;
}

function validateData(type, d) {
  switch (type) {
    case 'ARGUMENT_MAP': return graph(d, ARGUMENT_NODE_KINDS, ARGUMENT_RELATIONS, { kindRequired: true });
    case 'CONCEPT_MAP': return graph(d, {}, CONCEPT_RELATIONS, { kindRequired: false });
    case 'DIALECTICAL_FLOW': {
      if (!Array.isArray(d.steps) || d.steps.length < 2 || d.steps.length > 20) return 'steps harus berisi 2–20 tahap.';
      for (const [i, s] of d.steps.entries()) {
        if (!isObj(s) || !Object.hasOwn(FLOW_STAGES, s.stage)) return `Tahap ${i + 1}: stage tidak dikenal. Pilihan: ${Object.keys(FLOW_STAGES).join(', ')}.`;
        if (!text(s.text, 500)) return `Tahap ${i + 1}: teks wajib diisi (maksimum 500 karakter).`;
        if (s.section !== undefined && !/^[a-z0-9-]{1,64}$/.test(String(s.section))) return `Tahap ${i + 1}: section tidak valid.`;
      }
      return null;
    }
    case 'PREMISE_MATRIX': {
      if (!Array.isArray(d.rows) || !d.rows.length || d.rows.length > 40) return 'rows harus berisi 1–40 premis.';
      for (const [i, r] of d.rows.entries()) {
        if (!isObj(r) || !text(r.premise, 500)) return `Baris ${i + 1}: premise wajib diisi.`;
        if (r.type !== undefined && !Object.hasOwn(PREMISE_TYPES, r.type)) return `Baris ${i + 1}: type harus salah satu dari ${Object.keys(PREMISE_TYPES).join(', ')}.`;
        for (const k of ['evidence', 'source', 'hiddenAssumption', 'weakness', 'followUp']) if (!optText(r[k], 500)) return `Baris ${i + 1}: ${k} terlalu panjang.`;
      }
      return null;
    }
    case 'COMPARISON_MATRIX': {
      if (!Array.isArray(d.approaches) || d.approaches.length < 2 || d.approaches.length > 6 || !d.approaches.every((a) => text(a, 120))) return 'approaches harus berisi 2–6 nama pendekatan.';
      if (!Array.isArray(d.criteria) || !d.criteria.length || d.criteria.length > 20) return 'criteria harus berisi 1–20 kriteria.';
      for (const [i, c] of d.criteria.entries()) {
        if (!isObj(c) || !text(c.label, 160)) return `Kriteria ${i + 1}: label wajib diisi.`;
        if (!Array.isArray(c.values) || c.values.length !== d.approaches.length || !c.values.every((v) => typeof v === 'string' && v.length <= 600)) return `Kriteria "${c.label}": values harus berisi tepat ${d.approaches.length} teks.`;
      }
      return null;
    }
    case 'TIMELINE': {
      if (!Array.isArray(d.events) || d.events.length < 2 || d.events.length > 40) return 'events harus berisi 2–40 peristiwa.';
      for (const [i, e] of d.events.entries()) {
        if (!isObj(e) || !text(e.period, 80) || !text(e.label, 200)) return `Peristiwa ${i + 1}: period dan label wajib diisi.`;
        if (!text(e.source, 300)) return `Peristiwa ${i + 1}: source wajib diisi — linimasa tidak menampilkan klaim historis tanpa sumber.`;
        if (!optText(e.detail, 600)) return `Peristiwa ${i + 1}: detail terlalu panjang.`;
      }
      return null;
    }
    case 'TRUTH_TABLE': {
      const premises = d.premises ?? [];
      const exprs = d.expressions ?? [];
      if (!Array.isArray(premises) || !Array.isArray(exprs) || premises.length + exprs.length + (d.conclusion ? 1 : 0) === 0) return 'TRUTH_TABLE memerlukan premises/conclusion atau expressions.';
      if (premises.length > 8 || exprs.length > 8) return 'Paling banyak 8 premis dan 8 ekspresi.';
      if (premises.length && !d.conclusion) return 'Premis memerlukan conclusion untuk menilai validitas.';
      const vars = new Set();
      try {
        for (const s of [...premises, ...exprs, ...(d.conclusion ? [d.conclusion] : [])]) {
          if (typeof s !== 'string') return 'Setiap ekspresi harus berupa teks.';
          variablesOf(parseLogic(s), vars);
        }
      } catch (error) { return 'Ekspresi logika tidak valid: ' + error.message; }
      if (vars.size > MAX_VARIABLES) return `Paling banyak ${MAX_VARIABLES} variabel proposisi.`;
      if (d.legend !== undefined && (!isObj(d.legend) || !Object.entries(d.legend).every(([k, v]) => /^[A-Za-z][A-Za-z0-9_]{0,7}$/.test(k) && text(v, 200)))) return 'legend harus memetakan variabel ke teks proposisi.';
      return null;
    }
    default: return 'Jenis visual filsafat tidak didukung.';
  }
}

/** @returns {{ visual?: object, error?: string }} */
export function parsePhilosophyVisual(jsonText) {
  if (typeof jsonText !== 'string') return { error: 'Deklarasi harus berupa teks JSON.' };
  if (jsonText.length > MAX_JSON) return { error: 'Deklarasi visual filsafat melebihi batas 60.000 karakter.' };
  let value;
  try { value = JSON.parse(jsonText); } catch (e) { return { error: 'JSON visual filsafat tidak valid: ' + e.message }; }
  try { checkDepth(value); } catch (e) { return { error: e.message }; }
  if (!isObj(value)) return { error: 'Deklarasi harus berupa objek JSON.' };
  if (typeof value.id !== 'string' || !ID_RE.test(value.id)) return { error: 'id visual wajib: diawali huruf, berisi huruf/angka/_/- (maksimum 64).' };
  const type = typeof value.type === 'string' ? value.type.toUpperCase() : '';
  if (!PHILOSOPHY_VISUAL_TYPES.includes(type)) return { error: `Jenis "${value.type}" tidak dikenal. Pilihan: ${PHILOSOPHY_VISUAL_TYPES.join(', ')}.` };
  if (!text(value.alt, 1000)) return { error: 'alt wajib berisi ringkasan makna visual (maksimum 1.000 karakter).' };
  if (!optText(value.title, 200)) return { error: 'title terlalu panjang.' };
  if (!isObj(value.data)) return { error: 'data wajib berupa objek.' };
  const error = validateData(type, value.data);
  if (error) return { error: `${type}: ${error}` };
  return { visual: { id: value.id, type, title: value.title || null, alt: value.alt.trim(), data: value.data } };
}
