// logic.js
// ------------------------------------------------------------
// Propositional logic for the TRUTH_TABLE philosophy visual. Pure, DOM-free,
// no eval/new Function: a tokenizer + recursive-descent parser builds an AST
// that is evaluated against every assignment of at most 6 variables.
//
//   Grammar (lowest to highest precedence):
//     iff     := imp ( ('<->' | '↔' | 'iff') imp )*
//     imp     := or  ( ('->' | '→' | 'implies') imp )?      (right-assoc)
//     or      := and ( ('|' | '∨' | 'or' | 'v') and )*
//     and     := not ( ('&' | '∧' | 'and' | '^') not )*
//     not     := ('!' | '~' | '¬' | 'not') not | atom
//     atom    := VAR | 'T' | 'F' | '(' iff ')'
//   VAR: a letter followed by up to 7 letters/digits/_ (not a keyword).
// ------------------------------------------------------------

const KEYWORDS = new Map([['iff', 'IFF'], ['implies', 'IMP'], ['or', 'OR'], ['and', 'AND'], ['not', 'NOT']]);
export const MAX_VARIABLES = 6;
const MAX_LENGTH = 300;

export function tokenizeLogic(src) {
  if (typeof src !== 'string' || !src.trim()) throw new Error('Ekspresi logika kosong.');
  if (src.length > MAX_LENGTH) throw new Error('Ekspresi logika terlalu panjang.');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const two = src.slice(i, i + 3);
    if (two === '<->') { out.push({ t: 'IFF' }); i += 3; continue; }
    if (src.slice(i, i + 2) === '->') { out.push({ t: 'IMP' }); i += 2; continue; }
    const sym = { '↔': 'IFF', '→': 'IMP', '|': 'OR', '∨': 'OR', '&': 'AND', '∧': 'AND', '^': 'AND', '!': 'NOT', '~': 'NOT', '¬': 'NOT', '(': '(', ')': ')' }[c];
    if (sym) { out.push({ t: sym }); i++; continue; }
    const m = src.slice(i).match(/^[A-Za-z][A-Za-z0-9_]{0,7}/);
    if (m) {
      const word = m[0];
      const lower = word.toLowerCase();
      if (KEYWORDS.has(lower)) out.push({ t: KEYWORDS.get(lower) });
      else if (word === 'v') out.push({ t: 'OR' });
      else if (word === 'T' || word === 'F') out.push({ t: 'CONST', v: word === 'T' });
      else out.push({ t: 'VAR', v: word });
      i += word.length;
      continue;
    }
    throw new Error(`Simbol tidak dikenal "${c}" pada posisi ${i + 1}.`);
  }
  out.push({ t: 'EOF' });
  return out;
}

export function parseLogic(src) {
  const tokens = tokenizeLogic(src);
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => { if (tokens[p].t !== t) throw new Error(`Diharapkan ${t}, ditemukan ${tokens[p].t}.`); return tokens[p++]; };
  let depth = 0;
  function iff() { let n = imp(); while (peek().t === 'IFF') { p++; n = { op: 'iff', a: n, b: imp() }; } return n; }
  function imp() { const n = or(); if (peek().t === 'IMP') { p++; return { op: 'imp', a: n, b: imp() }; } return n; }
  function or() { let n = and(); while (peek().t === 'OR') { p++; n = { op: 'or', a: n, b: and() }; } return n; }
  function and() { let n = not(); while (peek().t === 'AND') { p++; n = { op: 'and', a: n, b: not() }; } return n; }
  function not() { if (peek().t === 'NOT') { p++; return { op: 'not', a: not() }; } return atom(); }
  function atom() {
    const t = peek();
    if (t.t === 'VAR') { p++; return { op: 'var', name: t.v }; }
    if (t.t === 'CONST') { p++; return { op: 'const', v: t.v }; }
    if (t.t === '(') {
      if (++depth > 40) throw new Error('Tanda kurung terlalu dalam.');
      p++; const n = iff(); eat(')'); depth--; return n;
    }
    throw new Error('Ekspresi logika tidak lengkap.');
  }
  const ast = iff();
  if (peek().t !== 'EOF') throw new Error('Ada simbol berlebih di akhir ekspresi.');
  return ast;
}

export function variablesOf(ast, set = new Set()) {
  if (ast.op === 'var') set.add(ast.name);
  if (ast.a) variablesOf(ast.a, set);
  if (ast.b) variablesOf(ast.b, set);
  return set;
}

export function evaluateLogic(ast, env) {
  switch (ast.op) {
    case 'var': return env[ast.name] === true;
    case 'const': return ast.v;
    case 'not': return !evaluateLogic(ast.a, env);
    case 'and': return evaluateLogic(ast.a, env) && evaluateLogic(ast.b, env);
    case 'or': return evaluateLogic(ast.a, env) || evaluateLogic(ast.b, env);
    case 'imp': return !evaluateLogic(ast.a, env) || evaluateLogic(ast.b, env);
    case 'iff': return evaluateLogic(ast.a, env) === evaluateLogic(ast.b, env);
    default: throw new Error('AST tidak valid.');
  }
}

export function formatLogic(ast) {
  const sym = { and: '∧', or: '∨', imp: '→', iff: '↔' };
  const wrap = (n) => (n.op === 'var' || n.op === 'const' || n.op === 'not' ? formatLogic(n) : '(' + formatLogic(n) + ')');
  if (ast.op === 'var') return ast.name;
  if (ast.op === 'const') return ast.v ? 'T' : 'F';
  if (ast.op === 'not') return '¬' + wrap(ast.a);
  return wrap(ast.a) + ' ' + sym[ast.op] + ' ' + wrap(ast.b);
}

/**
 * Builds a full truth table. With premises + conclusion it also decides
 * validity and returns every counterexample row.
 */
export function truthTable({ premises = [], conclusion = null, expressions = [] }) {
  const items = [
    ...premises.map((src, i) => ({ role: 'premise', label: `P${i + 1}`, src })),
    ...expressions.map((src, i) => ({ role: 'expression', label: `E${i + 1}`, src })),
    ...(conclusion ? [{ role: 'conclusion', label: 'K', src: conclusion }] : []),
  ];
  if (!items.length) throw new Error('Tidak ada ekspresi untuk dihitung.');
  for (const it of items) { it.ast = parseLogic(it.src); it.display = formatLogic(it.ast); }
  const vars = [...items.reduce((s, it) => variablesOf(it.ast, s), new Set())].sort();
  if (vars.length > MAX_VARIABLES) throw new Error(`Paling banyak ${MAX_VARIABLES} variabel proposisi.`);
  const rows = [];
  const n = vars.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    const env = {};
    // Conventional order: first row all true.
    vars.forEach((v, i) => { env[v] = ((mask >> (n - 1 - i)) & 1) === 0; });
    const values = items.map((it) => evaluateLogic(it.ast, env));
    const premiseValues = values.filter((_, i) => items[i].role === 'premise');
    const allPremises = premiseValues.every(Boolean);
    const conclusionValue = conclusion ? values[values.length - 1] : null;
    rows.push({ env, values, allPremises, counterexample: Boolean(conclusion && premises.length && allPremises && !conclusionValue) });
  }
  const valid = conclusion && premises.length ? rows.every((r) => !r.counterexample) : null;
  return { vars, items: items.map(({ role, label, src, display }) => ({ role, label, src, display })), rows, valid };
}
