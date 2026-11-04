// matrix.js — exact matrix algebra over Fraction (js/fraction.js).
// Every operation returns new matrices; inputs are never mutated.
import { Fraction, F } from './fraction.js';

export const MAX_DIM = 6;
export function toMatrix(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_DIM) throw new Error(`Matriks harus memiliki 1–${MAX_DIM} baris.`);
  const width = Array.isArray(rows[0]) ? rows[0].length : 0;
  if (!width || width > MAX_DIM) throw new Error(`Matriks harus memiliki 1–${MAX_DIM} kolom.`);
  return rows.map((r, i) => {
    if (!Array.isArray(r) || r.length !== width) throw new Error(`Baris ${i + 1} harus berisi ${width} entri.`);
    return r.map((v) => F(v));
  });
}
const clone = (m) => m.map((r) => r.slice());
export const dims = (m) => [m.length, m[0].length];
export function transpose(m) { return m[0].map((_, j) => m.map((r) => r[j])); }
export function multiply(a, b) {
  if (a[0].length !== b.length) throw new Error('Ukuran tidak cocok untuk perkalian.');
  return a.map((r) => b[0].map((_, j) => r.reduce((s, v, k) => s.add(v.mul(b[k][j])), F(0))));
}
export function identity(n) { return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => F(i === j ? 1 : 0))); }

const rowLabel = (i) => `R${i + 1}`;
/** Reduced row echelon form with a human-readable list of row operations. */
export function rref(m) {
  const a = clone(m);
  const [rows, cols] = dims(a);
  const steps = [];
  let lead = 0;
  const pivots = [];
  for (let r = 0; r < rows && lead < cols; r++) {
    let i = r;
    while (i < rows && a[i][lead].isZero()) i++;
    if (i === rows) { lead++; r--; continue; }
    if (i !== r) { [a[i], a[r]] = [a[r], a[i]]; steps.push({ op: 'swap', text: `${rowLabel(r)} ↔ ${rowLabel(i)}`, matrix: clone(a) }); }
    const pv = a[r][lead];
    if (!pv.equals(1)) { a[r] = a[r].map((v) => v.div(pv)); steps.push({ op: 'scale', text: `${rowLabel(r)} → (1 / ${pv}) · ${rowLabel(r)}`, matrix: clone(a) }); }
    for (let k = 0; k < rows; k++) {
      if (k === r || a[k][lead].isZero()) continue;
      const f = a[k][lead];
      a[k] = a[k].map((v, j) => v.sub(f.mul(a[r][j])));
      steps.push({ op: 'eliminate', text: `${rowLabel(k)} → ${rowLabel(k)} − (${f}) · ${rowLabel(r)}`, matrix: clone(a) });
    }
    pivots.push(lead);
    lead++;
  }
  return { matrix: a, steps, pivots, rank: pivots.length };
}
export function rank(m) { return rref(m).rank; }
export function determinant(m) {
  const [n, c] = dims(m);
  if (n !== c) throw new Error('Determinan hanya untuk matriks persegi.');
  const a = clone(m);
  let det = F(1);
  for (let col = 0; col < n; col++) {
    let p = col;
    while (p < n && a[p][col].isZero()) p++;
    if (p === n) return F(0);
    if (p !== col) { [a[p], a[col]] = [a[col], a[p]]; det = det.neg(); }
    det = det.mul(a[col][col]);
    for (let r = col + 1; r < n; r++) {
      const f = a[r][col].div(a[col][col]);
      a[r] = a[r].map((v, j) => v.sub(f.mul(a[col][j])));
    }
  }
  return det;
}
export function inverse(m) {
  const [n, c] = dims(m);
  if (n !== c) throw new Error('Invers hanya untuk matriks persegi.');
  if (determinant(m).isZero()) throw new Error('Matriks singular (determinan 0) — tidak memiliki invers.');
  const aug = m.map((r, i) => [...r, ...identity(n)[i]]);
  const { matrix } = rref(aug);
  return matrix.map((r) => r.slice(n));
}
export function matrixToTex(m) {
  return '\\begin{pmatrix}' + m.map((r) => r.map((v) => v.toTex()).join(' & ')).join(' \\\\ ') + '\\end{pmatrix}';
}

// ---- vectors ----
export function toVector(values) {
  if (!Array.isArray(values) || values.length < 2 || values.length > MAX_DIM) throw new Error(`Vektor harus memiliki 2–${MAX_DIM} komponen.`);
  return values.map((v) => F(v));
}
export function dot(u, v) { if (u.length !== v.length) throw new Error('Dimensi vektor berbeda.'); return u.reduce((s, x, i) => s.add(x.mul(v[i])), F(0)); }
export function cross(u, v) {
  if (u.length !== 3 || v.length !== 3) throw new Error('Hasil kali silang hanya untuk vektor 3 dimensi.');
  return [u[1].mul(v[2]).sub(u[2].mul(v[1])), u[2].mul(v[0]).sub(u[0].mul(v[2])), u[0].mul(v[1]).sub(u[1].mul(v[0]))];
}
/** |u|² is exact; |u| is reported exactly when |u|² is a perfect rational square. */
export function norm(u) {
  const sq = dot(u, u);
  const root = (x) => { if (x < 0n) return null; const r = BigInt(Math.round(Math.sqrt(Number(x)))); for (const c of [r - 1n, r, r + 1n]) if (c >= 0n && c * c === x) return c; return null; };
  const rn = root(sq.n); const rd = root(sq.d);
  return { squared: sq, exact: rn !== null && rd !== null ? new Fraction(rn, rd) : null, approx: Math.sqrt(sq.toNumber()) };
}
export function projection(u, v) {
  const vv = dot(v, v);
  if (vv.isZero()) throw new Error('Tidak dapat memproyeksikan ke vektor nol.');
  const k = dot(u, v).div(vv);
  return { scalar: k, vector: v.map((x) => x.mul(k)) };
}
export function angleDegrees(u, v) {
  const nu = norm(u).approx; const nv = norm(v).approx;
  if (!nu || !nv) throw new Error('Sudut tidak terdefinisi untuk vektor nol.');
  const c = Math.max(-1, Math.min(1, dot(u, v).toNumber() / (nu * nv)));
  return (Math.acos(c) * 180) / Math.PI;
}
