// philosophy-visual-renderer.js
// ------------------------------------------------------------
// DOM renderers for ```philosophy-visual blocks (validated by
// js/philosophy-visual-parser.js). Registered with the content pipeline
// on import.
//
// Every figure has:
//   - a visible caption (the declaration's `alt`),
//   - an equivalent text alternative (outline / table) that is always in
//     the DOM — collapsed in a <details>, never color-only,
//   - for graph maps: zoom −/100%/+, Expand dialog, keyboard navigation
//     between nodes (arrow keys), Enter/Space to jump to the linked text
//     section (`section` slug), and node highlighting when that section is
//     in view (handled by focus-view via [data-section-link]).
// ------------------------------------------------------------

import { parsePhilosophyVisual, ARGUMENT_NODE_KINDS, ARGUMENT_RELATIONS, CONCEPT_RELATIONS, FLOW_STAGES, PREMISE_TYPES } from './philosophy-visual-parser.js';
import { wrapText, layeredLayout } from './graph-layout.js';
import { truthTable } from './logic.js';
import { registerFenceRenderer, sourceDisclosure } from './content-renderer.js';
import { createMathVisualError } from './math-visual-renderer.js';

const SVG = 'http://www.w3.org/2000/svg';
const TYPE_LABELS = {
  ARGUMENT_MAP: 'Peta argumen', DIALECTICAL_FLOW: 'Alur dialektis', CONCEPT_MAP: 'Peta konsep', PREMISE_MATRIX: 'Matriks premis–bukti',
  COMPARISON_MATRIX: 'Matriks perbandingan', TIMELINE: 'Linimasa pemikiran', TRUTH_TABLE: 'Tabel kebenaran',
};

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function svg(tag, attrs = {}) { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; }

function table(headers, rows, { caption, rowHeader = true } = {}) {
  const wrap = el('div', 'table-scroll');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', (caption || 'Tabel') + ' (dapat digulir)');
  const t = el('table', 'md-table');
  if (caption) t.appendChild(el('caption', 'md-caption', caption));
  const thead = el('thead'); const tr = el('tr');
  headers.forEach((hd) => { const th = el('th', null, hd); th.scope = 'col'; tr.appendChild(th); });
  thead.appendChild(tr); t.appendChild(thead);
  const tbody = el('tbody');
  rows.forEach((r) => {
    const row = el('tr');
    r.forEach((cell, i) => {
      const c = el(i === 0 && rowHeader ? 'th' : 'td');
      if (i === 0 && rowHeader) c.scope = 'row';
      if (cell instanceof Node) c.appendChild(cell); else c.textContent = cell ?? '—';
      row.appendChild(c);
    });
    tbody.appendChild(row);
  });
  t.appendChild(tbody);
  wrap.appendChild(t);
  return wrap;
}

function textAlternative(title, content, open = false) {
  const d = el('details', 'visual-alt');
  if (open) d.open = true;
  d.appendChild(el('summary', null, title));
  d.appendChild(content);
  return d;
}

// ---------------- graph maps ----------------
function renderGraph(visual, ctx, { kinds, relations, direction }) {
  const { nodes, edges } = visual.data;
  const prefix = `${ctx.idPrefix}-pv-${visual.id}`;
  const laid = layeredLayout(nodes.map((n) => ({ id: n.id, lines: wrapText(n.text ?? n.label, 27, 6) })), edges, { direction });
  const root = svg('svg', { viewBox: `0 0 ${laid.width} ${laid.height}`, class: 'pv-graph', role: 'group', 'aria-label': visual.alt, width: laid.width, height: laid.height });
  const defs = svg('defs');
  const marker = svg('marker', { id: prefix + '-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
  marker.appendChild(svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'pv-arrowhead' }));
  defs.appendChild(marker);
  root.appendChild(defs);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edgeLayer = svg('g', { class: 'pv-edges', 'aria-hidden': 'true' });
  for (const e of edges) {
    const a = laid.nodes.get(e.from); const b = laid.nodes.get(e.to);
    // Edge leaves the source towards the target's side.
    const up = b.y < a.y;
    const x1 = a.x + a.w / 2; const y1 = up ? a.y : a.y + a.h;
    const x2 = b.x + b.w / 2; const y2 = up ? b.y + b.h : b.y;
    const sameRow = a.row === b.row;
    const dPath = sameRow
      ? `M${a.x + (b.x > a.x ? a.w : 0)},${a.y + a.h / 2} C${(a.x + b.x + a.w) / 2},${a.y - 30} ${(a.x + b.x + a.w) / 2},${b.y - 30} ${b.x + (b.x > a.x ? 0 : b.w)},${b.y + b.h / 2}`
      : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
    const path = svg('path', { d: dPath, class: `pv-edge pv-rel-${e.relation}`, 'marker-end': `url(#${prefix}-arrow)` });
    edgeLayer.appendChild(path);
    const label = e.label || relations[e.relation];
    const mx = sameRow ? (a.x + b.x + a.w) / 2 : (x1 + x2) / 2;
    const my = sameRow ? Math.min(a.y, b.y) - 18 : (y1 + y2) / 2;
    const t = svg('text', { x: mx, y: my, class: 'pv-edge-label', 'text-anchor': 'middle' });
    t.textContent = label;
    const bg = svg('rect', { x: mx - label.length * 3.3 - 6, y: my - 12, width: label.length * 6.6 + 12, height: 17, rx: 4, class: 'pv-edge-label-bg' });
    edgeLayer.append(bg, t);
  }
  root.appendChild(edgeLayer);

  const nodeLayer = svg('g', { class: 'pv-nodes' });
  const nodeEls = new Map();
  for (const n of nodes) {
    const p = laid.nodes.get(n.id);
    const kindLabel = kinds[n.kind] || null;
    const outgoing = edges.filter((e) => e.from === n.id).map((e) => `${relations[e.relation]} “${(byId.get(e.to).text ?? byId.get(e.to).label)}”`);
    const g = svg('g', { class: `pv-node${n.kind ? ' pv-kind-' + n.kind : ''}`, tabindex: 0, role: 'button', 'data-node-id': n.id,
      'aria-label': `${kindLabel ? kindLabel + ': ' : ''}${n.text ?? n.label}.${outgoing.length ? ' Relasi: ' + outgoing.join('; ') + '.' : ''}${n.section ? ' Tekan Enter untuk membuka bagian terkait.' : ''}` });
    if (n.section) g.setAttribute('data-section-link', n.section);
    g.appendChild(svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 10, class: 'pv-node-box' }));
    let ty = p.y + 18;
    if (kindLabel) { const k = svg('text', { x: p.x + 12, y: ty, class: 'pv-node-kind' }); k.textContent = kindLabel.toUpperCase(); g.appendChild(k); ty += 18; }
    for (const line of wrapText(n.text ?? n.label, 27, 6)) { const t = svg('text', { x: p.x + 12, y: ty, class: 'pv-node-text' }); t.textContent = line; g.appendChild(t); ty += 17; }
    nodeLayer.appendChild(g);
    nodeEls.set(n.id, g);
  }
  root.appendChild(nodeLayer);

  // Keyboard: arrows move between nodes using the layout grid.
  root.addEventListener('keydown', (ev) => {
    const g = ev.target.closest?.('.pv-node');
    if (!g) return;
    const id = g.getAttribute('data-node-id');
    const me = laid.nodes.get(id);
    let target = null;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      const row = laid.rows[laid.rows.findIndex((r) => r.includes(id))];
      target = row[row.indexOf(id) + (ev.key === 'ArrowRight' ? 1 : -1)];
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const r = me.row + (ev.key === 'ArrowDown' ? 1 : -1);
      const row = laid.rows[r];
      if (row) target = row.reduce((best, x) => (Math.abs(laid.nodes.get(x).x - me.x) < Math.abs(laid.nodes.get(best).x - me.x) ? x : best), row[0]);
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      activate(g);
      return;
    } else return;
    if (target) { ev.preventDefault(); nodeEls.get(target).focus(); }
  });
  root.addEventListener('click', (ev) => { const g = ev.target.closest?.('.pv-node'); if (g) activate(g); });
  function activate(g) {
    nodeEls.forEach((x) => x.classList.toggle('is-selected', x === g));
    const slug = g.getAttribute('data-section-link');
    if (!slug) return;
    const scope = g.closest('.focus-main, .doc-content, body');
    const section = scope.querySelector(`section.doc-section[id$="-${CSS.escape(slug)}"]`);
    const heading = section?.querySelector('.md-heading') || scope.querySelector(`.md-heading[data-slug="${CSS.escape(slug)}"]`);
    if (heading && !heading.hasAttribute('tabindex')) heading.tabIndex = -1;
    if (heading) { heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); heading.focus({ preventScroll: true }); }
  }

  // Equivalent outline.
  const list = el('ul', 'pv-outline');
  for (const n of nodes) {
    const li = el('li');
    li.appendChild(el('strong', null, (kinds[n.kind] ? kinds[n.kind] + ': ' : '') + (n.text ?? n.label)));
    if (n.note) li.appendChild(el('span', 'muted', ' — ' + n.note));
    const rels = edges.filter((e) => e.from === n.id);
    if (rels.length) {
      const sub = el('ul');
      rels.forEach((e) => sub.appendChild(el('li', null, `${e.label || relations[e.relation]} → ${byId.get(e.to).text ?? byId.get(e.to).label}`)));
      li.appendChild(sub);
    }
    list.appendChild(li);
  }
  const legend = el('ul', 'pv-legend');
  [...new Set(edges.map((e) => e.relation))].forEach((r) => {
    const li = el('li', `pv-legend-item pv-rel-${r}`);
    const sample = svg('svg', { width: 34, height: 10, 'aria-hidden': 'true' });
    sample.appendChild(svg('line', { x1: 1, y1: 5, x2: 33, y2: 5, class: `pv-edge pv-rel-${r}` }));
    li.append(sample, el('span', null, relations[r]));
    legend.appendChild(li);
  });
  return { node: root, width: laid.width, after: [legend, textAlternative('Versi teks: simpul dan relasi', list)], zoomable: true, hint: 'Gunakan Tab untuk masuk ke simpul, panah untuk berpindah, Enter untuk membuka bagian terkait.' };
}

// ---------------- other types ----------------
function renderFlow(visual) {
  const ol = el('ol', 'pv-flow');
  visual.data.steps.forEach((s, i) => {
    const li = el('li', `pv-flow-step pv-stage-${s.stage}`);
    li.append(el('span', 'pv-flow-num', String(i + 1)), el('span', 'pv-flow-stage', FLOW_STAGES[s.stage]), el('span', 'pv-flow-text', s.text));
    if (s.section) li.dataset.sectionLink = s.section;
    ol.appendChild(li);
  });
  return { node: ol, after: [] };
}

function renderPremiseMatrix(visual) {
  const headers = ['Premis', 'Tipe', 'Bukti', 'Sumber', 'Asumsi tersembunyi', 'Kelemahan', 'Pertanyaan lanjutan'];
  const rows = visual.data.rows.map((r) => [r.premise, r.type ? PREMISE_TYPES[r.type] : '—', r.evidence || '—', r.source || '—', r.hiddenAssumption || '—', r.weakness || '—', r.followUp || '—']);
  return { node: table(headers, rows, { caption: visual.title || visual.alt }), after: [] };
}

function renderComparison(visual) {
  const { approaches, criteria } = visual.data;
  return { node: table(['Kriteria', ...approaches], criteria.map((c) => [c.label, ...c.values]), { caption: visual.title || visual.alt }), after: [] };
}

function renderTimeline(visual) {
  const ol = el('ol', 'pv-timeline');
  visual.data.events.forEach((e) => {
    const li = el('li', 'pv-timeline-item');
    li.append(el('span', 'pv-timeline-period', e.period), el('strong', 'pv-timeline-label', e.label));
    if (e.detail) li.appendChild(el('p', null, e.detail));
    li.appendChild(el('p', 'pv-timeline-source', 'Sumber: ' + e.source));
    ol.appendChild(li);
  });
  return { node: ol, after: [] };
}

function renderTruthTable(visual) {
  const d = visual.data;
  const tt = truthTable({ premises: d.premises || [], conclusion: d.conclusion || null, expressions: d.expressions || [] });
  const tv = (b) => { const s = el('span', b ? 'tv tv-true' : 'tv tv-false', b ? 'B' : 'S'); s.title = b ? 'Benar' : 'Salah'; s.appendChild(el('span', 'sr-only', b ? ' (benar)' : ' (salah)')); return s; };
  const headers = [...tt.vars, ...tt.items.map((it) => `${it.label}: ${it.display}`)];
  const wrap = el('div', 'table-scroll');
  wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', `Tabel kebenaran: ${visual.title || visual.alt} (dapat digulir)`);
  const t = el('table', 'md-table pv-truth');
  t.appendChild(el('caption', 'md-caption', (visual.title || 'Tabel kebenaran') + ' — B = benar, S = salah'));
  const thead = el('thead'); const trh = el('tr');
  headers.forEach((hd) => { const th = el('th', null, hd); th.scope = 'col'; trh.appendChild(th); });
  if (tt.valid !== null) { const th = el('th', null, 'Semua premis benar?'); th.scope = 'col'; trh.appendChild(th); }
  thead.appendChild(trh); t.appendChild(thead);
  const tbody = el('tbody');
  tt.rows.forEach((r) => {
    const tr = el('tr', r.counterexample ? 'is-counterexample' : r.allPremises && tt.valid !== null ? 'is-premises-true' : null);
    tt.vars.forEach((v) => { const td = el('td'); td.appendChild(tv(r.env[v])); tr.appendChild(td); });
    r.values.forEach((v) => { const td = el('td'); td.appendChild(tv(v)); tr.appendChild(td); });
    if (tt.valid !== null) { const td = el('td', null, r.allPremises ? (r.counterexample ? 'ya — kesimpulan salah (kontra-contoh)' : 'ya') : 'tidak'); tr.appendChild(td); }
    tbody.appendChild(tr);
  });
  t.appendChild(tbody); wrap.appendChild(t);
  const after = [];
  if (d.legend) {
    const dl = el('dl', 'pv-legend-dl');
    Object.entries(d.legend).forEach(([k, v]) => { dl.append(el('dt', null, k), el('dd', null, v)); });
    after.push(dl);
  }
  if (tt.valid !== null) {
    const ce = tt.rows.filter((r) => r.counterexample).length;
    after.push(el('p', `pv-verdict ${tt.valid ? 'is-valid' : 'is-invalid'}`, tt.valid
      ? 'Valid: tidak ada satu baris pun di mana semua premis benar sementara kesimpulan salah.'
      : `Tidak valid: ada ${ce} baris (kontra-contoh) di mana semua premis benar tetapi kesimpulan salah.`));
    after.push(el('p', 'muted', 'Validitas hanya menyangkut bentuk argumen. Argumen valid dengan premis yang keliru tetap tidak menjamin kesimpulan yang benar.'));
  }
  return { node: wrap, after };
}

const RENDERERS = {
  ARGUMENT_MAP: (v, c) => renderGraph(v, c, { kinds: ARGUMENT_NODE_KINDS, relations: ARGUMENT_RELATIONS, direction: 'up' }),
  CONCEPT_MAP: (v, c) => renderGraph(v, c, { kinds: {}, relations: CONCEPT_RELATIONS, direction: 'down' }),
  DIALECTICAL_FLOW: renderFlow,
  PREMISE_MATRIX: renderPremiseMatrix,
  COMPARISON_MATRIX: renderComparison,
  TIMELINE: renderTimeline,
  TRUTH_TABLE: renderTruthTable,
};

export function renderPhilosophyVisual(visual, ctx = { idPrefix: 'pv' }) {
  const figure = el('figure', `pv-figure pv-${visual.type.toLowerCase().replace(/_/g, '-')}`);
  figure.dataset.visualId = visual.id;
  figure.dataset.visualType = visual.type;
  const toolbar = el('div', 'math-visual-toolbar');
  toolbar.appendChild(el('span', 'math-visual-type', TYPE_LABELS[visual.type]));
  const result = RENDERERS[visual.type](visual, ctx);
  if (visual.title && !['PREMISE_MATRIX', 'COMPARISON_MATRIX', 'TRUTH_TABLE'].includes(visual.type)) figure.appendChild(el('p', 'pv-title', visual.title));
  figure.appendChild(toolbar);

  if (result.zoomable) {
    const scroll = el('div', 'math-visual-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', `${TYPE_LABELS[visual.type]}: ${visual.title || visual.alt} (dapat digulir)`);
    const target = el('div', 'math-visual-zoom-target');
    target.appendChild(result.node);
    scroll.appendChild(target);
    let scale = 1;
    const controls = el('div', 'math-visual-zoom-controls');
    const mk = (label, aria) => { const b = el('button', 'btn btn-ghost btn-small', label); b.type = 'button'; b.setAttribute('aria-label', aria); return b; };
    const out = mk('−', 'Perkecil diagram'); const reset = mk('100%', 'Kembalikan ukuran diagram'); const inn = mk('+', 'Perbesar diagram');
    const apply = () => {
      // 100% = fit the container (never narrower than 70% of natural size,
      // so labels stay legible; below that the area scrolls). Zoom scales
      // from the natural size.
      target.style.width = scale === 1 ? `max(min(100%, ${result.width}px), ${Math.round(result.width * 0.7)}px)` : Math.round(result.width * scale) + 'px';
      reset.textContent = Math.round(scale * 100) + '%';
      out.disabled = scale <= 0.5; inn.disabled = scale >= 2;
    };
    out.addEventListener('click', () => { scale = Math.max(0.5, Math.round((scale - 0.25) * 100) / 100); apply(); });
    inn.addEventListener('click', () => { scale = Math.min(2, Math.round((scale + 0.25) * 100) / 100); apply(); });
    reset.addEventListener('click', () => { scale = 1; apply(); });
    const expand = mk('Perluas', 'Perluas diagram');
    expand.setAttribute('aria-expanded', 'false');
    expand.addEventListener('click', () => {
      const dialog = el('dialog', 'math-visual-dialog');
      dialog.setAttribute('aria-label', 'Diagram diperluas: ' + visual.alt);
      if (typeof dialog.showModal !== 'function') return;
      const close = el('button', 'btn btn-secondary btn-small math-visual-dialog-close', 'Tutup diagram');
      close.type = 'button';
      const holder = document.createComment('posisi diagram');
      figure.before(holder);
      dialog.append(close, figure);
      document.body.appendChild(dialog);
      expand.hidden = true; expand.setAttribute('aria-expanded', 'true');
      dialog.addEventListener('close', () => { holder.replaceWith(figure); expand.hidden = false; expand.setAttribute('aria-expanded', 'false'); dialog.remove(); expand.focus({ preventScroll: true }); }, { once: true });
      close.addEventListener('click', () => dialog.close());
      dialog.showModal();
      close.focus();
    });
    controls.append(out, reset, inn);
    const actions = el('div', 'math-visual-actions');
    actions.append(controls, expand);
    toolbar.appendChild(actions);
    if (result.hint) figure.appendChild(el('p', 'math-visual-scroll-hint pv-hint', result.hint));
    figure.appendChild(scroll);
    apply();
  } else {
    figure.appendChild(result.node);
  }
  result.after.forEach((n) => figure.appendChild(n));
  figure.appendChild(el('figcaption', 'math-visual-caption', visual.alt));
  return figure;
}

export function renderPhilosophyVisualSource(source, ctx) {
  const parsed = parsePhilosophyVisual(source);
  if (parsed.error) {
    const box = createMathVisualError(parsed.error);
    box.classList.add('pv-error');
    box.appendChild(sourceDisclosure(source));
    return box;
  }
  try {
    return renderPhilosophyVisual(parsed.visual, ctx);
  } catch (error) {
    const box = createMathVisualError('Visual filsafat gagal dirender: ' + (error?.message || error));
    box.appendChild(sourceDisclosure(source));
    return box;
  }
}

registerFenceRenderer('philosophy-visual', renderPhilosophyVisualSource);
