// graph-layout.js — deterministic layered layout for argument/concept maps.
// Pure (no DOM). Text wrapping uses a conservative average glyph width so
// layout is stable in tests; the SVG then uses the same line breaks.

export function wrapText(text, maxChars = 26, maxLines = 6) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
    else { lines.push(line); line = w; }
    while (line.length > maxChars) { lines.push(line.slice(0, maxChars - 1) + '-'); line = line.slice(maxChars - 1); }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { const kept = lines.slice(0, maxLines); kept[maxLines - 1] = kept[maxLines - 1].replace(/.{0,2}$/, '…'); return kept; }
  return lines;
}

/**
 * @param nodes [{id, lines: string[]}]
 * @param edges [{from, to}]
 * @param opts  direction 'up' (edge targets above sources, argument maps)
 *              or 'down' (sources above targets, concept maps)
 */
export function layeredLayout(nodes, edges, { direction = 'up', nodeWidth = 210, lineHeight = 17, padY = 30, gapX = 28, gapY = 64, maxPerRow = 4 } = {}) {
  const ids = nodes.map((n) => n.id);
  const out = new Map(ids.map((id) => [id, []]));
  const inc = new Map(ids.map((id) => [id, []]));
  for (const e of edges) { out.get(e.from)?.push(e.to); inc.get(e.to)?.push(e.from); }
  const next = direction === 'up' ? out : inc;
  const depth = new Map();
  const visiting = new Set();
  function d(id) {
    if (depth.has(id)) return depth.get(id);
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const targets = next.get(id) || [];
    const v = targets.length ? 1 + Math.max(...targets.map(d)) : 0;
    visiting.delete(id);
    depth.set(id, v);
    return v;
  }
  ids.forEach(d);
  // Layer 0 is drawn on top.
  const layers = [];
  for (const n of nodes) {
    const k = depth.get(n.id);
    (layers[k] = layers[k] || []).push(n);
  }
  // Split very wide layers into several rows so labels stay readable.
  const rows = [];
  for (const layer of layers.filter(Boolean)) for (let i = 0; i < layer.length; i += maxPerRow) rows.push(layer.slice(i, i + maxPerRow));
  // Barycentric ordering against the previous row (one pass is enough here).
  const pos = new Map();
  rows.forEach((row, r) => {
    if (r > 0) {
      const bary = (n) => { const ns = [...(out.get(n.id) || []), ...(inc.get(n.id) || [])].filter((x) => pos.has(x)); return ns.length ? ns.reduce((s, x) => s + pos.get(x).order, 0) / ns.length : Infinity; };
      row.sort((a, b) => bary(a) - bary(b));
    }
    row.forEach((n, i) => pos.set(n.id, { row: r, order: i }));
  });
  const widest = Math.max(1, ...rows.map((r) => r.length));
  const width = widest * nodeWidth + (widest - 1) * gapX + 40;
  const placed = new Map();
  let y = 20;
  for (const row of rows) {
    const h = Math.max(...row.map((n) => n.lines.length)) * lineHeight + padY + 16;
    const rowWidth = row.length * nodeWidth + (row.length - 1) * gapX;
    let x = (width - rowWidth) / 2;
    for (const n of row) { placed.set(n.id, { x, y, w: nodeWidth, h, row: pos.get(n.id).row, order: pos.get(n.id).order }); x += nodeWidth + gapX; }
    y += h + gapY;
  }
  return { width, height: y - gapY + 20, nodes: placed, rows: rows.map((r) => r.map((n) => n.id)) };
}
