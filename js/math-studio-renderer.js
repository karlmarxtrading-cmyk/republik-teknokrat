// math-studio-renderer.js
// ------------------------------------------------------------
// ```math-studio blocks: small, exact, interactive mathematics tools.
// All arithmetic is exact (js/fraction.js + js/matrix.js, BigInt
// rationals); decimals are shown only when labelled as approximations.
// No eval/new Function; every input is parsed by Fraction.parse.
//
//   MATRIX_STUDIO  { matrix: [["2","1"],["1","3"]] }
//                  editable cells, resize 1–6, transpose, determinant,
//                  inverse, rank, RREF with every row operation listed.
//   VECTOR_STUDIO  { u: [..], v: [..] }  length, dot, cross (3D), angle,
//                  projection of u onto v.
//   FRACTION       { values: ["6/8", "2 1/3", "-1.25"] }  exact simplified
//                  form, mixed number, TeX, labelled decimal approximation.
//
// Results appear as TeX (typeset by MathJax) AND as plain text, so they
// stay readable and checkable if MathJax is unavailable.
// ------------------------------------------------------------

import { registerFenceRenderer, sourceDisclosure } from './content-renderer.js';
import { createMathVisualError } from './math-visual-renderer.js';
import { Fraction } from './fraction.js';
import * as M from './matrix.js';
import { typesetMath } from './math-typesetter.js';

const TYPES = ['MATRIX_STUDIO', 'VECTOR_STUDIO', 'FRACTION'];
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function btn(label, onClick, cls = 'btn btn-secondary btn-small') { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; }
const matText = (m) => '[' + m.map((r) => '[' + r.map(String).join(', ') + ']').join(', ') + ']';

export function validateStudio(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Deklarasi math-studio harus berupa objek JSON.';
  if (typeof value.id !== 'string' || !ID_RE.test(value.id)) return 'id math-studio tidak valid.';
  if (!TYPES.includes(value.type)) return `type harus salah satu dari ${TYPES.join(', ')}.`;
  if (typeof value.alt !== 'string' || !value.alt.trim()) return 'alt wajib diisi.';
  try {
    if (value.type === 'MATRIX_STUDIO') M.toMatrix(value.matrix);
    if (value.type === 'VECTOR_STUDIO') { const u = M.toVector(value.u); const v = M.toVector(value.v); if (u.length !== v.length) return 'u dan v harus berdimensi sama.'; }
    if (value.type === 'FRACTION') { if (!Array.isArray(value.values) || !value.values.length || value.values.length > 30) return 'values harus berisi 1–30 bilangan.'; value.values.forEach((x) => Fraction.parse(x)); }
  } catch (error) { return error.message; }
  return null;
}

function outputBox() {
  const out = el('div', 'studio-output');
  out.setAttribute('role', 'status');
  out.setAttribute('aria-live', 'polite');
  return out;
}
function show(out, { title, tex, text, extra = [] , error }) {
  out.replaceChildren();
  if (error) { out.appendChild(el('p', 'studio-error', error)); return; }
  out.appendChild(el('p', 'studio-out-title', title));
  if (tex) { const d = el('div', 'math-display'); d.appendChild(el('span', 'math-tex math-tex-display', '\\[' + tex + '\\]')); out.appendChild(d); }
  if (text) out.appendChild(el('p', 'studio-out-text', 'Teks: ' + text));
  extra.forEach((n) => out.appendChild(n));
  typesetMath(out);
}

function matrixStudio(spec, ctx) {
  const wrap = el('div', 'studio studio-matrix');
  let rows = spec.matrix.map((r) => r.map(String));
  const original = rows.map((r) => r.slice());
  const grid = el('div', 'studio-grid');
  const out = outputBox();
  const sizeNote = el('p', 'muted');
  function paintGrid() {
    grid.replaceChildren();
    grid.style.gridTemplateColumns = `repeat(${rows[0].length}, minmax(64px, 1fr))`;
    rows.forEach((r, i) => r.forEach((v, j) => {
      const input = el('input', 'studio-cell');
      input.type = 'text'; input.inputMode = 'decimal'; input.value = v; input.spellcheck = false;
      input.setAttribute('aria-label', `Baris ${i + 1}, kolom ${j + 1}`);
      input.addEventListener('input', () => { rows[i][j] = input.value; input.removeAttribute('aria-invalid'); });
      grid.appendChild(input);
    }));
    sizeNote.textContent = `Ukuran ${rows.length} × ${rows[0].length}. Entri boleh bilangan bulat, pecahan (3/4), desimal (1.25), atau campuran (2 1/3).`;
  }
  function read() {
    let bad = null;
    grid.querySelectorAll('input').forEach((inp, k) => {
      try { Fraction.parse(inp.value); } catch { inp.setAttribute('aria-invalid', 'true'); if (bad === null) bad = k; }
    });
    if (bad !== null) { grid.querySelectorAll('input')[bad].focus(); throw new Error('Periksa entri yang ditandai: harus berupa bilangan rasional.'); }
    return M.toMatrix(rows);
  }
  const run = (fn) => () => { try { fn(read()); } catch (error) { show(out, { error: error.message }); } };
  const resize = (dr, dc) => () => {
    const r = Math.min(M.MAX_DIM, Math.max(1, rows.length + dr));
    const c = Math.min(M.MAX_DIM, Math.max(1, rows[0].length + dc));
    rows = Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => rows[i]?.[j] ?? '0'));
    paintGrid();
  };
  const ops = el('div', 'studio-ops');
  ops.append(
    btn('Transpose', run((m) => { const t = M.transpose(m); show(out, { title: 'Transpose Aᵀ', tex: 'A^{\\mathsf T} = ' + M.matrixToTex(t), text: matText(t) }); })),
    btn('Determinan', run((m) => { const d = M.determinant(m); show(out, { title: 'Determinan', tex: '\\det A = ' + d.toTex(), text: d.toString() }); })),
    btn('Invers', run((m) => { const inv = M.inverse(m); show(out, { title: 'Invers A⁻¹ (eksak)', tex: 'A^{-1} = ' + M.matrixToTex(inv), text: matText(inv) }); })),
    btn('Rank', run((m) => { const r = M.rank(m); show(out, { title: 'Rank', tex: '\\operatorname{rank} A = ' + r, text: String(r) }); })),
    btn('RREF + langkah', run((m) => {
      const res = M.rref(m);
      const ol = el('ol', 'studio-steps');
      if (!res.steps.length) ol.appendChild(el('li', null, 'Matriks sudah dalam bentuk eselon baris tereduksi.'));
      res.steps.forEach((s) => { const li = el('li'); li.append(el('strong', null, s.text), el('span', 'studio-step-matrix', ' ⇒ ' + matText(s.matrix))); ol.appendChild(li); });
      show(out, { title: `Bentuk eselon baris tereduksi (rank ${res.rank})`, tex: M.matrixToTex(res.matrix), text: matText(res.matrix), extra: [el('p', 'studio-out-title', 'Operasi baris:'), ol] });
    })));
  const sizer = el('div', 'studio-ops studio-sizer');
  sizer.append(btn('+ baris', resize(1, 0), 'btn btn-ghost btn-small'), btn('− baris', resize(-1, 0), 'btn btn-ghost btn-small'), btn('+ kolom', resize(0, 1), 'btn btn-ghost btn-small'), btn('− kolom', resize(0, -1), 'btn btn-ghost btn-small'),
    btn('Kembalikan matriks awal', () => { rows = original.map((r) => r.slice()); paintGrid(); out.replaceChildren(); }, 'btn btn-ghost btn-small'));
  const label = el('p', 'studio-label', 'Matriks A');
  label.id = `${ctx.idPrefix}-ms-${spec.id}-label`;
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-labelledby', label.id);
  paintGrid();
  wrap.append(label, grid, sizeNote, sizer, ops, out);
  return wrap;
}

function vectorStudio(spec) {
  const wrap = el('div', 'studio studio-vector');
  const state = { u: spec.u.map(String), v: spec.v.map(String) };
  const out = outputBox();
  const fields = el('div', 'studio-vectors');
  for (const key of ['u', 'v']) {
    const f = el('div', 'studio-vector-row');
    const id = `vs-${spec.id}-${key}`;
    const lab = el('label', 'studio-label', `Vektor ${key} (komponen dipisah koma)`);
    lab.htmlFor = id;
    const inp = el('input', 'studio-cell studio-vector-input');
    inp.id = id; inp.type = 'text'; inp.value = state[key].join(', '); inp.spellcheck = false;
    inp.addEventListener('input', () => { state[key] = inp.value.split(',').map((s) => s.trim()); inp.removeAttribute('aria-invalid'); });
    f.append(lab, inp);
    fields.appendChild(f);
  }
  const vecTex = (v) => '\\begin{pmatrix}' + v.map((x) => x.toTex()).join('\\\\') + '\\end{pmatrix}';
  const read = () => {
    const u = M.toVector(state.u); const v = M.toVector(state.v);
    if (u.length !== v.length) throw new Error('u dan v harus berdimensi sama.');
    return [u, v];
  };
  const run = (fn) => () => { try { fn(...read()); } catch (error) { show(out, { error: error.message }); } };
  const normText = (n) => (n.exact ? n.exact.toString() : `√(${n.squared}) ≈ ${n.approx.toFixed(4)}`);
  const normTex = (n) => (n.exact ? n.exact.toTex() : `\\sqrt{${n.squared.toTex()}} \\approx ${n.approx.toFixed(4)}`);
  const ops = el('div', 'studio-ops');
  ops.append(
    btn('Panjang |u|, |v|', run((u, v) => { const a = M.norm(u); const b = M.norm(v); show(out, { title: 'Panjang (norma Euklides)', tex: `\\lVert u\\rVert = ${normTex(a)},\\quad \\lVert v\\rVert = ${normTex(b)}`, text: `|u| = ${normText(a)}; |v| = ${normText(b)}` }); })),
    btn('Hasil kali titik u·v', run((u, v) => { const d = M.dot(u, v); show(out, { title: 'Hasil kali titik', tex: 'u\\cdot v = ' + d.toTex(), text: d.toString() }); })),
    btn('Hasil kali silang u×v', run((u, v) => { const c = M.cross(u, v); show(out, { title: 'Hasil kali silang (3D)', tex: 'u\\times v = ' + vecTex(c), text: '(' + c.join(', ') + ')' }); })),
    btn('Sudut antara u dan v', run((u, v) => { const a = M.angleDegrees(u, v); show(out, { title: 'Sudut (pendekatan desimal)', tex: `\\theta \\approx ${a.toFixed(4)}^{\\circ}`, text: `≈ ${a.toFixed(4)}°` }); })),
    btn('Proyeksi u pada v', run((u, v) => { const p = M.projection(u, v); show(out, { title: 'Proyeksi ortogonal (eksak)', tex: `\\operatorname{proj}_v u = ${p.scalar.toTex()}\\,v = ${vecTex(p.vector)}`, text: `skalar ${p.scalar}; vektor (${p.vector.join(', ')})` }); })));
  wrap.append(fields, ops, out);
  return wrap;
}

function fractionView(spec) {
  const rows = spec.values.map((raw) => {
    const f = Fraction.parse(raw);
    return { raw: String(raw), f };
  });
  const wrap = el('div', 'table-scroll');
  wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', `Tabel pecahan eksak: ${spec.alt} (dapat digulir)`);
  const t = el('table', 'md-table studio-fractions');
  t.appendChild(el('caption', 'md-caption', 'Bentuk eksak; desimal hanya pendekatan'));
  const thead = el('thead'); const trh = el('tr');
  ['Masukan', 'Bentuk paling sederhana', 'Bilangan campuran', 'Notasi', 'Desimal (≈)'].forEach((h) => { const th = el('th', null, h); th.scope = 'col'; trh.appendChild(th); });
  thead.appendChild(trh); t.appendChild(thead);
  const tbody = el('tbody');
  rows.forEach(({ raw, f }) => {
    const tr = el('tr');
    const th = el('th', null, raw); th.scope = 'row'; tr.appendChild(th);
    tr.appendChild(el('td', null, f.toString()));
    tr.appendChild(el('td', null, f.toMixed()));
    const td = el('td'); td.appendChild(el('span', 'math-tex', '\\(' + f.toTex() + '\\)')); tr.appendChild(td);
    tr.appendChild(el('td', null, '≈ ' + f.toNumber().toPrecision(6).replace(/\.?0+$/, '')));
    tbody.appendChild(tr);
  });
  t.appendChild(tbody); wrap.appendChild(t);
  return wrap;
}

export function renderMathStudioSource(source, ctx = { idPrefix: 'ms' }) {
  let spec;
  try { spec = JSON.parse(source); } catch (error) {
    const box = createMathVisualError('JSON math-studio tidak valid: ' + error.message);
    box.appendChild(sourceDisclosure(source));
    return box;
  }
  const error = source.length > 20000 ? 'Deklarasi math-studio terlalu besar.' : validateStudio(spec);
  if (error) {
    const box = createMathVisualError('math-studio: ' + error);
    box.appendChild(sourceDisclosure(source));
    return box;
  }
  const figure = el('figure', 'studio-figure');
  figure.dataset.visualType = spec.type;
  figure.dataset.visualId = spec.id;
  const bar = el('div', 'math-visual-toolbar');
  bar.appendChild(el('span', 'math-visual-type', { MATRIX_STUDIO: 'Matrix Studio', VECTOR_STUDIO: 'Vector Studio', FRACTION: 'Pecahan eksak' }[spec.type]));
  figure.appendChild(bar);
  figure.appendChild(spec.type === 'MATRIX_STUDIO' ? matrixStudio(spec, ctx) : spec.type === 'VECTOR_STUDIO' ? vectorStudio(spec) : fractionView(spec));
  figure.appendChild(el('figcaption', 'math-visual-caption', spec.alt));
  return figure;
}

registerFenceRenderer('math-studio', renderMathStudioSource);
