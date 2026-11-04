// math-visual-renderer.js
// ------------------------------------------------------------
// Safe, dependency-free renderers for every typed visual family
// in the mathematics authoring contract. All SVG/HTML is created
// with DOM APIs; corpus text is never inserted as HTML.
// ------------------------------------------------------------

import { compileExpression } from './math-expression.js';
import { prepareVisualLayout, appendVisualDetails } from './math-visual-layout.js';
import { MATH_ASSETS } from '../data/math-assets.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_POINTS = 1200;
const PALETTE = Array.from({length: 6}, (_, i) => `var(--plot-${i + 1})`);
const SAFE_NAMED_COLORS = new Set([
  'black', 'white', 'gray', 'grey', 'red', 'blue', 'green', 'orange',
  'purple', 'teal', 'brown', 'navy', 'maroon', 'transparent',
]);

function svgElement(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  });
  return node;
}

function appendSvgText(parent, text, x, y, className = 'math-svg-label', anchor = 'middle') {
  const node = svgElement('text', { x, y, class: className, 'text-anchor': anchor });
  node.textContent = String(text);
  parent.appendChild(node);
  return node;
}

function finite(value, fallback = 0, min = -1000000, max = 1000000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/i.test(normalized) || SAFE_NAMED_COLORS.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function safeLabel(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value);
  return text;
}

function uniqueDomId(prefix, suffix) {
  return (String(prefix) + '-' + String(suffix)).replace(/[^A-Za-z0-9_-]/g, '-');
}

function createSvg(width, height, alt) {
  const svg = svgElement('svg', {
    viewBox: '0 0 ' + width + ' ' + height,
    width,
    height,
    role: 'img',
    'aria-label': alt,
    class: 'math-visual-svg',
    preserveAspectRatio: 'xMidYMid meet',
  });
  const title = svgElement('title');
  title.textContent = alt;
  svg.appendChild(title);
  return svg;
}

function createMarker(defs, id, color = 'currentColor') {
  const marker = svgElement('marker', {
    id,
    viewBox: '0 0 10 10',
    refX: 9,
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: 'auto-start-reverse',
  });
  marker.appendChild(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }));
  defs.appendChild(marker);
}

function createVisualError(message) {
  const error = document.createElement('div');
  error.className = 'math-visual-error';
  error.setAttribute('role', 'alert');
  const strong = document.createElement('strong');
  strong.textContent = 'Visual tidak dapat ditampilkan';
  const detail = document.createElement('span');
  detail.textContent = message;
  error.append(strong, detail);
  return error;
}

function normalizePoint(value) {
  if (Array.isArray(value) && value.length >= 2) {
    return { x: finite(value[0]), y: finite(value[1]), z: finite(value[2]) };
  }
  if (value && typeof value === 'object') {
    return {
      x: finite(value.x),
      y: finite(value.y),
      z: finite(value.z),
      label: safeLabel(value.label ?? value.id),
      id: value.id === undefined ? null : String(value.id),
    };
  }
  return { x: 0, y: 0, z: 0 };
}

function getBounds(axes = {}, defaults = {}) {
  let xMin = finite(axes.xMin, defaults.xMin ?? -5);
  let xMax = finite(axes.xMax, defaults.xMax ?? 5);
  let yMin = finite(axes.yMin, defaults.yMin ?? -5);
  let yMax = finite(axes.yMax, defaults.yMax ?? 5);
  if (xMin >= xMax) [xMin, xMax] = [defaults.xMin ?? -5, defaults.xMax ?? 5];
  if (yMin >= yMax) [yMin, yMax] = [defaults.yMin ?? -5, defaults.yMax ?? 5];
  return { xMin, xMax, yMin, yMax };
}

function niceStep(range) {
  const rough = Math.abs(range) / 8 || 1;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const fraction = rough / power;
  const nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  return nice * power;
}

function addCartesianFrame(svg, bounds, options = {}) {
  const width = finite(options.width, 720);
  const height = finite(options.height, 420);
  let margin = finite(options.margin, 76);
  // Reserve real text width for signed/decimal tick values before mapping data.
  if (typeof window !== 'undefined' && window.CanvasRenderingContext2D) {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '14px sans-serif';
    const tickWidth = Math.max(...[bounds.yMin,bounds.yMax].map(v => ctx.measureText(String(Number(v.toFixed(8)))).width));
    margin = Math.max(margin, Math.min(width / 3, tickWidth + 28));
  }
  const innerWidth = width - margin * 2;
  const innerHeight = height - margin * 2;
  const toX = (x) => margin + ((x - bounds.xMin) / (bounds.xMax - bounds.xMin)) * innerWidth;
  const toY = (y) => height - margin - ((y - bounds.yMin) / (bounds.yMax - bounds.yMin)) * innerHeight;

  const grid = svgElement('g', { class: 'math-plot-grid' });
  const axes = svgElement('g', { class: 'math-plot-axes' });
  const labels = svgElement('g', { class: 'math-plot-ticks' });
  const xStep = niceStep(bounds.xMax - bounds.xMin);
  const yStep = niceStep(bounds.yMax - bounds.yMin);

  const xStart = Math.ceil(bounds.xMin / xStep) * xStep;
  for (let x = xStart, count = 0; x <= bounds.xMax + xStep * 0.001 && count < 30; x += xStep, count += 1) {
    const px = toX(x);
    if (options.xGrid !== false) grid.appendChild(svgElement('line', { x1: px, y1: margin, x2: px, y2: height - margin }));
    if (options.xTicks !== false) appendSvgText(labels, Number(x.toFixed(8)), px, height - margin + 20, 'math-svg-tick');
  }

  const yStart = Math.ceil(bounds.yMin / yStep) * yStep;
  for (let y = yStart, count = 0; y <= bounds.yMax + yStep * 0.001 && count < 30; y += yStep, count += 1) {
    const py = toY(y);
    grid.appendChild(svgElement('line', { x1: margin, y1: py, x2: width - margin, y2: py }));
    appendSvgText(labels, Number(y.toFixed(8)), margin - 10, py + 4, 'math-svg-tick', 'end');
  }

  const xAxisY = toY(clamp(0, bounds.yMin, bounds.yMax));
  const yAxisX = toX(clamp(0, bounds.xMin, bounds.xMax));
  axes.append(
    svgElement('line', { x1: margin, y1: xAxisY, x2: width - margin, y2: xAxisY }),
    svgElement('line', { x1: yAxisX, y1: margin, x2: yAxisX, y2: height - margin })
  );
  svg.append(grid, axes, labels);

  svg._axisEntries = [
    ...(options.xLabel ? [{label: 'Horizontal axis', text: String(options.xLabel)}] : []),
    ...(options.yLabel ? [{label: 'Vertical axis', text: String(options.yLabel)}] : []),
  ];

  return { toX, toY, width, height, margin, innerWidth, innerHeight };
}

function addLegend(svg, entries) {
  svg._legendEntries = entries.map((entry, index) => ({label: 'Series ' + (index + 1), text: String(entry.label), color: entry.color}));
}

function renderVenn(visual, context) {
  const width = 720;
  const height = 430;
  const svg = createSvg(width, height, visual.alt);
  const data = visual.data;
  const sets = data.sets.slice(0, 6);
  const defs = svgElement('defs');
  svg.appendChild(defs);

  svg.appendChild(svgElement('rect', {
    x: 24, y: 24, width: width - 48, height: height - 48,
    rx: 12, class: 'math-venn-universe',
  }));
  svg._universe = safeLabel(data.universe, 'U');
  svg._setEntries = sets.map((set, index) => ({label: String.fromCharCode(65 + index), text: safeLabel(set.label, String(set.id ?? index))}));

  let centers;
  let rx = 125;
  let ry = 112;
  if (sets.length === 2) {
    centers = [{ x: 294, y: 220 }, { x: 426, y: 220 }];
  } else if (sets.length === 3) {
    centers = [{ x: 300, y: 185 }, { x: 420, y: 185 }, { x: 360, y: 282 }];
    rx = 112;
    ry = 102;
  } else {
    rx = 88;
    ry = 76;
    centers = sets.map((_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / sets.length;
      return { x: 360 + Math.cos(angle) * 126, y: 224 + Math.sin(angle) * 108 };
    });
  }

  const shadeText = typeof data.shade === 'string' ? data.shade.toLowerCase() : '';
  const shadeObject = data.shade && typeof data.shade === 'object' ? data.shade : null;
  const shadeOp = shadeObject ? String(shadeObject.op || '').toLowerCase() : shadeText;
  const shadeIds = shadeObject && Array.isArray(shadeObject.sets)
    ? shadeObject.sets.map(String)
    : [];
  const selectedIndices = shadeIds.length
    ? sets
      .map((set, index) => shadeIds.includes(String(set.id ?? index)) ? index : -1)
      .filter((index) => index >= 0)
    : sets.map((_, index) => index);

  if (shadeOp === 'complement') {
    const maskId = uniqueDomId(context.domId, 'venn-complement-mask');
    const mask = svgElement('mask', { id: maskId });
    mask.appendChild(svgElement('rect', {
      x: 24, y: 24, width: width - 48, height: height - 48,
      rx: 12, fill: 'white',
    }));
    selectedIndices.forEach((index) => {
      mask.appendChild(svgElement('ellipse', {
        cx: centers[index].x,
        cy: centers[index].y,
        rx,
        ry,
        fill: 'black',
      }));
    });
    defs.appendChild(mask);
    svg.appendChild(svgElement('rect', {
      x: 25, y: 25, width: width - 50, height: height - 50,
      rx: 11,
      class: 'math-venn-shade',
      mask: 'url(#' + maskId + ')',
    }));
  }

  sets.forEach((set, index) => {
    const center = centers[index];
    const setId = String(set.id ?? index);
    const color = safeColor(set.color, PALETTE[index % PALETTE.length]);
    const shouldFill = (shadeOp === 'union' && (!shadeIds.length || shadeIds.includes(setId)))
      || shadeOp === setId.toLowerCase();
    const ellipse = svgElement('ellipse', {
      cx: center.x, cy: center.y, rx, ry,
      stroke: color,
      fill: color,
      'fill-opacity': shouldFill ? 0.24 : 0.08,
      'stroke-width': 3,
      class: 'math-venn-set',
      'stroke-dasharray': index % 2 ? '10 5' : undefined,
      'data-set-index': index,
    });
    svg.appendChild(ellipse);
    appendSvgText(
      svg,
      String.fromCharCode(65 + index),
      center.x,
      center.y - ry + 24,
      'math-svg-set-label'
    );

    const clipId = uniqueDomId(context.domId, 'venn-clip-' + index);
    const clip = svgElement('clipPath', { id: clipId });
    clip.appendChild(svgElement('ellipse', { cx: center.x, cy: center.y, rx, ry }));
    defs.appendChild(clip);
  });

  if (shadeOp === 'intersection' && selectedIndices.length >= 2) {
    let parent = svg;
    const wrapper = svgElement('g', { class: 'math-venn-intersection' });
    svg.appendChild(wrapper);
    parent = wrapper;
    for (let position = 0; position < selectedIndices.length - 1; position += 1) {
      const index = selectedIndices[position];
      const nested = svgElement('g', {
        'clip-path': 'url(#' + uniqueDomId(context.domId, 'venn-clip-' + index) + ')',
      });
      parent.appendChild(nested);
      parent = nested;
    }
    const last = centers[selectedIndices[selectedIndices.length - 1]];
    parent.appendChild(svgElement('ellipse', {
      cx: last.x, cy: last.y, rx, ry,
      fill: PALETTE[0], 'fill-opacity': 0.42,
    }));
  }

  if (data.regionCounts) {
    svg.classList.add('math-venn-cardinality');
    const counts = data.regionCounts;
    const positions = [
      { key: 'leftOnly', x: 235, y: 235 },
      { key: 'intersection', x: 360, y: 235 },
      { key: 'rightOnly', x: 485, y: 235 },
      { key: 'outside', x: 620, y: 370 },
    ];
    positions.forEach(({ key, x, y }) => {
      const number = appendSvgText(svg, counts[key], x, y, 'math-svg-element math-venn-count');
      number.setAttribute('data-region', key);
    });
    svg._total = data.universeTotal;
    return { node: svg, width };
  }

  const membership = new Map();
  sets.forEach((set, setIndex) => {
    (Array.isArray(set.elements) ? set.elements : []).forEach((element) => {
      const key = typeof element === 'object'
        ? String(element.id ?? element.label ?? JSON.stringify(element))
        : String(element);
      if (!membership.has(key)) membership.set(key, { label: safeLabel(element?.label ?? element), sets: [] });
      membership.get(key).sets.push(setIndex);
    });
  });

  svg._membership = [...membership.values()].map(entry => ({text: entry.label, sets: entry.sets}));
  svg._shade = data.shade;
  // Elements are shown in an exact, readable membership table below the schematic.
  // No approximate ellipse placement is presented as an exact membership region.

  return { node: svg, width };
}

function normalizeMappingElement(value) {
  if (value && typeof value === 'object') {
    return {
      key: String(value.id ?? value.value ?? value.label),
      label: safeLabel(value.label ?? value.value ?? value.id),
    };
  }
  return { key: String(value), label: safeLabel(value) };
}

function renderMapping(visual, context) {
  const data = visual.data;
  const leftItems = data.left.elements.slice(0, 30).map(normalizeMappingElement);
  const rightItems = data.right.elements.slice(0, 30).map(normalizeMappingElement);
  const count = Math.max(leftItems.length, rightItems.length, 2);
  const width = 720;
  const height = Math.max(390, 120 + count * 42);
  const svg = createSvg(width, height, visual.alt);
  const defs = svgElement('defs');
  const markerId = uniqueDomId(context.domId, 'mapping-arrow');
  createMarker(defs, markerId, 'var(--text-soft)');
  svg.appendChild(defs);

  const leftX = 225;
  const rightX = 495;
  const top = 96;
  const step = (height - 150) / Math.max(count - 1, 1);
  const ellipseHeight = height - 80;
  svg.append(
    svgElement('ellipse', { cx: leftX, cy: height / 2, rx: 120, ry: ellipseHeight / 2, class: 'math-mapping-set' }),
    svgElement('ellipse', { cx: rightX, cy: height / 2, rx: 120, ry: ellipseHeight / 2, class: 'math-mapping-set' })
  );
  appendSvgText(svg, 'A', leftX, 55, 'math-svg-heading');
  appendSvgText(svg, 'B', rightX, 55, 'math-svg-heading');
  svg._mappingEntries = [{label:'A — Domain',text:safeLabel(data.left.label,'Domain')},{label:'B — Codomain',text:safeLabel(data.right.label,'Codomain')}];

  const leftPositions = new Map();
  const rightPositions = new Map();
  leftItems.forEach((item, index) => leftPositions.set(item.key, { x: leftX, y: top + index * step }));
  rightItems.forEach((item, index) => rightPositions.set(item.key, { x: rightX, y: top + index * step }));

  const arrows = svgElement('g', { class: 'math-mapping-arrows' });
  data.arrows.slice(0, 80).forEach((arrow) => {
    const from = Array.isArray(arrow) ? arrow[0] : arrow.from;
    const to = Array.isArray(arrow) ? arrow[1] : arrow.to;
    const start = leftPositions.get(String(from));
    const end = rightPositions.get(String(to));
    if (!start || !end) return;
    const path = svgElement('path', {
      d: 'M ' + (start.x + 20) + ' ' + start.y
        + ' C ' + (start.x + 105) + ' ' + start.y
        + ', ' + (end.x - 105) + ' ' + end.y
        + ', ' + (end.x - 20) + ' ' + end.y,
      'marker-end': 'url(#' + markerId + ')',
    });
    arrows.appendChild(path);
    if (!Array.isArray(arrow) && arrow.label) {
      appendSvgText(
        arrows,
        safeLabel(arrow.label),
        (start.x + end.x) / 2,
        (start.y + end.y) / 2 - 7,
        'math-svg-arrow-label'
      );
    }
  });
  svg.appendChild(arrows);

  leftItems.forEach((item) => {
    const position = leftPositions.get(item.key);
    svg.appendChild(svgElement('circle', { cx: position.x, cy: position.y, r: 18, class: 'math-mapping-node' }));
    appendSvgText(svg, item.label, position.x, position.y + 5, 'math-svg-element');
  });
  rightItems.forEach((item) => {
    const position = rightPositions.get(item.key);
    svg.appendChild(svgElement('circle', { cx: position.x, cy: position.y, r: 18, class: 'math-mapping-node' }));
    appendSvgText(svg, item.label, position.x, position.y + 5, 'math-svg-element');
  });

  return { node: svg, width };
}

function normalizeCurvePoints(curve, bounds, sampleCount = 280) {
  if (Array.isArray(curve.points)) {
    return curve.points.slice(0, MAX_POINTS).map(normalizePoint);
  }
  if (typeof curve.expression !== 'string') return [];
  const fn = compileExpression(curve.expression);
  const domain = Array.isArray(curve.domain) && curve.domain.length >= 2
    ? [finite(curve.domain[0], bounds.xMin), finite(curve.domain[1], bounds.xMax)]
    : [bounds.xMin, bounds.xMax];
  const start = clamp(Math.min(domain[0], domain[1]), bounds.xMin, bounds.xMax);
  const end = clamp(Math.max(domain[0], domain[1]), bounds.xMin, bounds.xMax);
  const count = clamp(Math.floor(finite(curve.samples, sampleCount)), 24, 700);
  const points = [];
  for (let index = 0; index <= count; index += 1) {
    const x = start + ((end - start) * index) / count;
    let y;
    try {
      y = fn({ x });
    } catch {
      y = NaN;
    }
    points.push({ x, y: Number(y) });
  }
  return points;
}

function pointsToPath(points, frame, bounds) {
  let path = '';
  let active = false;
  let previousY = null;
  for (const point of points) {
    const valid = Number.isFinite(point.x)
      && Number.isFinite(point.y)
      && point.x >= bounds.xMin
      && point.x <= bounds.xMax
      && point.y >= bounds.yMin - (bounds.yMax - bounds.yMin) * 4
      && point.y <= bounds.yMax + (bounds.yMax - bounds.yMin) * 4;
    if (!valid) {
      active = false;
      previousY = null;
      continue;
    }
    const x = frame.toX(point.x);
    const y = frame.toY(point.y);
    const discontinuity = previousY !== null && Math.abs(y - previousY) > frame.innerHeight * 1.4;
    path += (!active || discontinuity ? 'M ' : ' L ') + x.toFixed(2) + ' ' + y.toFixed(2);
    active = true;
    previousY = y;
  }
  return path;
}

function renderFunctionGraph(visual, context) {
  const width = 720;
  const height = 440;
  const data = visual.data;
  const bounds = getBounds(data.axes);
  const svg = createSvg(width, height, visual.alt);
  const frame = addCartesianFrame(svg, bounds, {
    width,
    height,
    xLabel: data.axes?.xLabel || 'x',
    yLabel: data.axes?.yLabel || 'y',
  });

  const clipId = uniqueDomId(context.domId, 'plot-clip');
  const defs = svgElement('defs');
  const clip = svgElement('clipPath', { id: clipId });
  clip.appendChild(svgElement('rect', {
    x: frame.margin,
    y: frame.margin,
    width: frame.innerWidth,
    height: frame.innerHeight,
  }));
  defs.appendChild(clip);
  svg.appendChild(defs);
  const plot = svgElement('g', { 'clip-path': 'url(#' + clipId + ')' });
  svg.appendChild(plot);

  (Array.isArray(data.shadedAreas) ? data.shadedAreas : []).slice(0, 12).forEach((area, index) => {
    if (typeof area.expression !== 'string') return;
    const curve = {
      expression: area.expression,
      domain: [area.from ?? bounds.xMin, area.to ?? bounds.xMax],
      samples: 180,
    };
    const points = normalizeCurvePoints(curve, bounds, 180).filter((point) => Number.isFinite(point.y));
    if (points.length < 2) return;
    const baseline = finite(area.baseline, 0);
    let d = 'M ' + frame.toX(points[0].x) + ' ' + frame.toY(baseline);
    points.forEach((point) => {
      d += ' L ' + frame.toX(point.x) + ' ' + frame.toY(point.y);
    });
    d += ' L ' + frame.toX(points[points.length - 1].x) + ' ' + frame.toY(baseline) + ' Z';
    plot.appendChild(svgElement('path', {
      d,
      fill: safeColor(area.color, PALETTE[index % PALETTE.length]),
      'fill-opacity': 0.2,
      stroke: 'none',
    }));
  });

  (Array.isArray(data.intervals) ? data.intervals : []).slice(0, 20).forEach((interval, index) => {
    const from = finite(interval.from, bounds.xMin);
    const to = finite(interval.to, bounds.xMax);
    const y = frame.toY(clamp(finite(interval.y, 0), bounds.yMin, bounds.yMax));
    plot.appendChild(svgElement('line', {
      x1: frame.toX(from), x2: frame.toX(to), y1: y, y2: y,
      stroke: safeColor(interval.color, PALETTE[index % PALETTE.length]),
      'stroke-width': 7,
      'stroke-linecap': 'round',
      opacity: 0.7,
    }));
  });

  (Array.isArray(data.asymptotes) ? data.asymptotes : []).slice(0, 20).forEach((asymptote) => {
    if (Number.isFinite(Number(asymptote.x))) {
      const x = frame.toX(Number(asymptote.x));
      plot.appendChild(svgElement('line', {
        x1: x, x2: x, y1: frame.margin, y2: height - frame.margin,
        class: 'math-plot-asymptote',
      }));
    }
    if (Number.isFinite(Number(asymptote.y))) {
      const y = frame.toY(Number(asymptote.y));
      plot.appendChild(svgElement('line', {
        x1: frame.margin, x2: width - frame.margin, y1: y, y2: y,
        class: 'math-plot-asymptote',
      }));
    }
  });

  const legend = [];
  (Array.isArray(data.curves) ? data.curves : []).slice(0, 16).forEach((curve, index) => {
    const color = safeColor(curve.color, PALETTE[index % PALETTE.length]);
    const points = normalizeCurvePoints(curve, bounds);
    const d = pointsToPath(points, frame, bounds);
    if (!d) return;
    plot.appendChild(svgElement('path', {
      d,
      fill: 'none',
      stroke: color,
      'stroke-width': clamp(finite(curve.strokeWidth, 3), 1, 8),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: 'math-plot-curve',
      'stroke-dasharray': index % 2 ? '8 5' : undefined,
    }));
    legend.push({ color, label: safeLabel(curve.label, curve.expression || 'Curve ' + (index + 1)) });
  });

  (Array.isArray(data.lines) ? data.lines : []).slice(0, 30).forEach((line, index) => {
    const start = normalizePoint(line.from);
    const end = normalizePoint(line.to);
    plot.appendChild(svgElement('line', {
      x1: frame.toX(start.x), y1: frame.toY(start.y),
      x2: frame.toX(end.x), y2: frame.toY(end.y),
      stroke: safeColor(line.color, PALETTE[(index + 2) % PALETTE.length]),
      'stroke-width': clamp(finite(line.strokeWidth, 2), 1, 8),
      'stroke-dasharray': line.style === 'dashed' ? '8 6' : undefined,
    }));
  });

  (Array.isArray(data.points) ? data.points : []).slice(0, 100).forEach((rawPoint) => {
    const point = normalizePoint(rawPoint);
    const x = frame.toX(point.x);
    const y = frame.toY(point.y);
    plot.appendChild(svgElement('circle', { cx: x, cy: y, r: 5, class: 'math-plot-point' }));
    if (point.label) {
      const nearRight = x > width - frame.margin - Math.min(180, point.label.length * 8 + 12);
      const labelX = nearRight ? x - 9 : x + 9;
      const labelY = clamp(y - 10, frame.margin + 18, height - frame.margin - 8);
      const label = appendSvgText(svg, point.label, labelX, labelY, 'math-svg-point-label', nearRight ? 'end' : 'start');
      label.dataset.anchorX = x; label.dataset.anchorY = y;
    }
  });

  addLegend(svg, legend, width, { below: true });
  return { node: svg, width };
}

function geometryCollections(data) {
  const result = {
    points: Array.isArray(data.points) ? [...data.points] : [],
    segments: Array.isArray(data.segments) ? [...data.segments] : [],
    rays: Array.isArray(data.rays) ? [...data.rays] : [],
    lines: Array.isArray(data.lines) ? [...data.lines] : [],
    polygons: Array.isArray(data.polygons) ? [...data.polygons] : [],
    circles: Array.isArray(data.circles) ? [...data.circles] : [],
    arcs: Array.isArray(data.arcs) ? [...data.arcs] : [],
    angles: Array.isArray(data.angles) ? [...data.angles] : [],
    measurements: Array.isArray(data.measurements) ? [...data.measurements] : [],
    transformations: Array.isArray(data.transformations) ? [...data.transformations] : [],
    markers: Array.isArray(data.markers) ? [...data.markers] : [],
  };

  (Array.isArray(data.objects) ? data.objects : []).forEach((object) => {
    if (!object || typeof object.type !== 'string') return;
    const key = object.type.toLowerCase().replace(/-/g, '_');
    const map = {
      point: 'points', segment: 'segments', ray: 'rays', line: 'lines',
      polygon: 'polygons', triangle: 'polygons', circle: 'circles',
      arc: 'arcs', angle: 'angles', measurement: 'measurements',
      transformation: 'transformations', marker: 'markers',
    };
    if (map[key]) result[map[key]].push(object);
  });
  return result;
}

function renderGeometry2D(visual, context) {
  const width = 720;
  const height = 470;
  const data = visual.data;
  const collections = geometryCollections(data);
  const points = new Map();
  collections.points.slice(0, 200).forEach((rawPoint, index) => {
    const point = normalizePoint(rawPoint);
    const id = String(rawPoint.id ?? rawPoint.label ?? index);
    point.id = id;
    point.label = safeLabel(rawPoint.label, id);
    points.set(id, point);
  });

  function resolvePoint(value) {
    if (typeof value === 'string' || typeof value === 'number') {
      return points.get(String(value)) || null;
    }
    return normalizePoint(value);
  }

  const rawViewport = data.viewport || data.axes;
  let bounds;
  if (rawViewport) {
    bounds = getBounds(rawViewport);
  } else {
    const all = [...points.values()];
    const xValues = all.map((point) => point.x);
    const yValues = all.map((point) => point.y);
    const xMin = xValues.length ? Math.min(...xValues) : -5;
    const xMax = xValues.length ? Math.max(...xValues) : 5;
    const yMin = yValues.length ? Math.min(...yValues) : -5;
    const yMax = yValues.length ? Math.max(...yValues) : 5;
    const xPad = Math.max(1, (xMax - xMin) * 0.18);
    const yPad = Math.max(1, (yMax - yMin) * 0.18);
    bounds = getBounds({ xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad });
  }

  const svg = createSvg(width, height, visual.alt);
  const defs = svgElement('defs');
  const arrowId = uniqueDomId(context.domId, 'geometry-arrow');
  createMarker(defs, arrowId, 'var(--text)');
  svg.appendChild(defs);

  const frame = addCartesianFrame(svg, bounds, {
    width,
    height,
    xLabel: rawViewport?.xLabel || '',
    yLabel: rawViewport?.yLabel || '',
  });
  const layer = svgElement('g', { class: 'math-geometry-layer' });
  svg.appendChild(layer);

  function endpoints(object) {
    if (Array.isArray(object)) return [resolvePoint(object[0]), resolvePoint(object[1])];
    return [
      resolvePoint(object.from ?? object.a ?? object.start),
      resolvePoint(object.to ?? object.b ?? object.end),
    ];
  }

  collections.polygons.slice(0, 200).forEach((polygon, index) => {
    const vertices = (Array.isArray(polygon) ? polygon : polygon.points || polygon.vertices || [])
      .map(resolvePoint)
      .filter(Boolean);
    if (vertices.length < 3) return;
    layer.appendChild(svgElement('polygon', {
      points: vertices.map((point) => frame.toX(point.x) + ',' + frame.toY(point.y)).join(' '),
      fill: safeColor(polygon.fill, PALETTE[index % PALETTE.length]),
      'fill-opacity': finite(polygon.fillOpacity, 0.1, 0, 0.8),
      stroke: safeColor(polygon.color, PALETTE[index % PALETTE.length]),
      'stroke-width': 2.5,
    }));
  });

  collections.circles.slice(0, 200).forEach((circle, index) => {
    const center = resolvePoint(circle.center ?? circle.c ?? [circle.x, circle.y]);
    if (!center) return;
    const radius = Math.abs(finite(circle.radius ?? circle.r, 1));
    layer.appendChild(svgElement('ellipse', {
      cx: frame.toX(center.x),
      cy: frame.toY(center.y),
      rx: Math.abs(frame.toX(center.x + radius) - frame.toX(center.x)),
      ry: Math.abs(frame.toY(center.y + radius) - frame.toY(center.y)),
      fill: safeColor(circle.fill, 'transparent'),
      'fill-opacity': finite(circle.fillOpacity, 0.12, 0, 0.8),
      stroke: safeColor(circle.color, PALETTE[index % PALETTE.length]),
      'stroke-width': 2.5,
    }));
    if (circle.label) {
      appendSvgText(layer, safeLabel(circle.label), frame.toX(center.x + radius), frame.toY(center.y) - 8, 'math-svg-point-label', 'start');
    }
  });

  const lineGroups = [
    [collections.lines, 'line'],
    [collections.rays, 'ray'],
    [collections.segments, 'segment'],
  ];
  lineGroups.forEach(([items, kind], groupIndex) => {
    items.slice(0, 200).forEach((object, index) => {
      let [start, end] = endpoints(object);
      if (!start || !end) return;
      const color = safeColor(object.color, PALETTE[(index + groupIndex) % PALETTE.length]);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      if (kind !== 'segment') {
        const extension = Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin) * 3;
        const length = Math.hypot(dx, dy) || 1;
        if (kind === 'line') {
          start = { x: start.x - (dx / length) * extension, y: start.y - (dy / length) * extension };
        }
        end = { x: end.x + (dx / length) * extension, y: end.y + (dy / length) * extension };
      }
      layer.appendChild(svgElement('line', {
        x1: frame.toX(start.x), y1: frame.toY(start.y),
        x2: frame.toX(end.x), y2: frame.toY(end.y),
        stroke: color,
        'stroke-width': clamp(finite(object.strokeWidth, 2.5), 1, 8),
        'stroke-dasharray': object.style === 'dashed' ? '8 6' : undefined,
        'marker-end': kind === 'ray' ? 'url(#' + arrowId + ')' : undefined,
      }));
    });
  });

  collections.arcs.slice(0, 200).forEach((arc, index) => {
    const center = resolvePoint(arc.center ?? [arc.x, arc.y]);
    if (!center) return;
    const radius = Math.abs(finite(arc.radius, 1));
    const startAngle = finite(arc.startAngle, 0) * Math.PI / 180;
    const endAngle = finite(arc.endAngle, 90) * Math.PI / 180;
    const start = { x: center.x + radius * Math.cos(startAngle), y: center.y + radius * Math.sin(startAngle) };
    const end = { x: center.x + radius * Math.cos(endAngle), y: center.y + radius * Math.sin(endAngle) };
    const rx = Math.abs(frame.toX(center.x + radius) - frame.toX(center.x));
    const ry = Math.abs(frame.toY(center.y + radius) - frame.toY(center.y));
    const large = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
    const sweep = endAngle > startAngle ? 0 : 1;
    layer.appendChild(svgElement('path', {
      d: 'M ' + frame.toX(start.x) + ' ' + frame.toY(start.y)
        + ' A ' + rx + ' ' + ry + ' 0 ' + large + ' ' + sweep
        + ' ' + frame.toX(end.x) + ' ' + frame.toY(end.y),
      fill: 'none',
      stroke: safeColor(arc.color, PALETTE[index % PALETTE.length]),
      'stroke-width': 2.5,
    }));
  });

  collections.angles.slice(0, 200).forEach((angle, index) => {
    const vertex = resolvePoint(angle.vertex);
    const from = resolvePoint(angle.from);
    const to = resolvePoint(angle.to);
    if (!vertex || !from || !to) return;
    const a1 = Math.atan2(from.y - vertex.y, from.x - vertex.x);
    let a2 = Math.atan2(to.y - vertex.y, to.x - vertex.x);
    while (a2 < a1) a2 += Math.PI * 2;
    if (a2 - a1 > Math.PI) [a2] = [a2 - Math.PI * 2];
    const radius = finite(angle.radius, 0.55, 0.1, 10);
    const start = { x: vertex.x + Math.cos(a1) * radius, y: vertex.y + Math.sin(a1) * radius };
    const end = { x: vertex.x + Math.cos(a2) * radius, y: vertex.y + Math.sin(a2) * radius };
    const rx = Math.abs(frame.toX(vertex.x + radius) - frame.toX(vertex.x));
    const ry = Math.abs(frame.toY(vertex.y + radius) - frame.toY(vertex.y));
    layer.appendChild(svgElement('path', {
      d: 'M ' + frame.toX(start.x) + ' ' + frame.toY(start.y)
        + ' A ' + rx + ' ' + ry + ' 0 0 0 ' + frame.toX(end.x) + ' ' + frame.toY(end.y),
      fill: 'none',
      stroke: safeColor(angle.color, PALETTE[index % PALETTE.length]),
      'stroke-width': 2,
    }));
    if (angle.label) {
      const mid = (a1 + a2) / 2;
      appendSvgText(
        layer,
        safeLabel(angle.label),
        frame.toX(vertex.x + Math.cos(mid) * radius * 1.45),
        frame.toY(vertex.y + Math.sin(mid) * radius * 1.45),
        'math-svg-point-label'
      );
    }
  });

  collections.measurements.slice(0, 200).forEach((measurement) => {
    const [start, end] = endpoints(measurement);
    if (!start || !end) return;
    const x = frame.toX((start.x + end.x) / 2);
    const y = frame.toY((start.y + end.y) / 2);
    appendSvgText(layer, safeLabel(measurement.label ?? measurement.value), x, y - 8, 'math-svg-measurement');
  });

  collections.transformations.slice(0, 200).forEach((transformation) => {
    const [start, end] = endpoints(transformation);
    if (!start || !end) return;
    layer.appendChild(svgElement('line', {
      x1: frame.toX(start.x), y1: frame.toY(start.y),
      x2: frame.toX(end.x), y2: frame.toY(end.y),
      class: 'math-geometry-transformation',
      'marker-end': 'url(#' + arrowId + ')',
    }));
    if (transformation.label) {
      appendSvgText(
        layer,
        safeLabel(transformation.label),
        frame.toX((start.x + end.x) / 2),
        frame.toY((start.y + end.y) / 2) - 8,
        'math-svg-point-label'
      );
    }
  });

  collections.markers.slice(0, 200).forEach((marker) => {
    const at = resolvePoint(marker.at);
    if (!at) return;
    const x = frame.toX(at.x);
    const y = frame.toY(at.y);
    if (marker.kind === 'perpendicular' || marker.type === 'perpendicular') {
      layer.appendChild(svgElement('path', {
        d: 'M ' + x + ' ' + (y - 12) + ' h 12 v 12',
        class: 'math-geometry-marker',
      }));
    } else {
      layer.appendChild(svgElement('path', {
        d: 'M ' + (x - 7) + ' ' + (y - 7) + ' l 14 14 M ' + (x - 7) + ' ' + (y + 7) + ' l 14 -14',
        class: 'math-geometry-marker',
      }));
    }
  });

  points.forEach((point) => {
    const x = frame.toX(point.x);
    const y = frame.toY(point.y);
    layer.appendChild(svgElement('circle', { cx: x, cy: y, r: 4.5, class: 'math-geometry-point' }));
    if (point.label) {
      const names = {five_eighths: '5/8', three_fourths: '3/4', one: '1'};
      const label = appendSvgText(layer, names[point.label] ?? point.label, x + 8, y - 9, 'math-svg-point-label', 'start');
      label.dataset.anchorX = x; label.dataset.anchorY = y;
    }
  });

  if (data.notToScale) {
    appendSvgText(svg, 'Illustration not to scale', width - 54, height - 18, 'math-svg-note', 'end');
  }
  return { node: svg, width };
}

function get3DBounds(axes = {}) {
  const xy = getBounds(axes, { xMin: -3, xMax: 3, yMin: -3, yMax: 3 });
  let zMin = finite(axes.zMin, -3);
  let zMax = finite(axes.zMax, 3);
  if (zMin >= zMax) [zMin, zMax] = [-3, 3];
  return { ...xy, zMin, zMax };
}

function createProjector(bounds, width, height, state) {
  const xMid = (bounds.xMin + bounds.xMax) / 2;
  const yMid = (bounds.yMin + bounds.yMax) / 2;
  const zMid = (bounds.zMin + bounds.zMax) / 2;
  const xSpan = bounds.xMax - bounds.xMin;
  const ySpan = bounds.yMax - bounds.yMin;
  const zSpan = bounds.zMax - bounds.zMin;
  const scale = Math.min(width, height) * 0.42;

  return (rawPoint) => {
    const point = normalizePoint(rawPoint);
    const x = (point.x - xMid) / xSpan * 2;
    const y = (point.y - yMid) / ySpan * 2;
    const z = (point.z - zMid) / zSpan * 2;
    const cosYaw = Math.cos(state.yaw);
    const sinYaw = Math.sin(state.yaw);
    const x1 = x * cosYaw - y * sinYaw;
    const y1 = x * sinYaw + y * cosYaw;
    const cosPitch = Math.cos(state.pitch);
    const sinPitch = Math.sin(state.pitch);
    const y2 = y1 * cosPitch - z * sinPitch;
    const depth = y1 * sinPitch + z * cosPitch;
    const perspective = 1 / (1 + depth * 0.14);
    return {
      x: width / 2 + x1 * scale * perspective,
      y: height / 2 - y2 * scale * perspective,
      depth,
    };
  };
}

function evaluateSurface(surface, x, y) {
  if (typeof surface.expression === 'string' || typeof surface.z === 'string') {
    const fn = compileExpression(surface.expression || surface.z);
    return fn({ x, y });
  }
  return NaN;
}

function renderPlot3D(visual) {
  const width = 720;
  const height = 470;
  const data = visual.data;
  const bounds = get3DBounds(data.axes);
  const svg = createSvg(width, height, visual.alt);
  svg.classList.add('math-plot-3d');
  svg.tabIndex = 0;
  svg.setAttribute('aria-description', 'Drag to rotate. Use arrow keys to rotate from the keyboard.');
  const scene = svgElement('g', { class: 'math-3d-scene' });
  svg.appendChild(scene);

  const state = {
    yaw: finite(data.view?.yaw, -0.7),
    pitch: finite(data.view?.pitch, 0.62),
  };

  function makePolyline(rawPoints, attributes = {}) {
    const project = createProjector(bounds, width, height, state);
    const projected = rawPoints.map(project).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (projected.length < 2) return null;
    return svgElement('polyline', {
      points: projected.map((point) => point.x.toFixed(2) + ',' + point.y.toFixed(2)).join(' '),
      fill: 'none',
      ...attributes,
    });
  }

  function redraw() {
    scene.replaceChildren();
    const project = createProjector(bounds, width, height, state);
    const origin = { x: clamp(0, bounds.xMin, bounds.xMax), y: clamp(0, bounds.yMin, bounds.yMax), z: clamp(0, bounds.zMin, bounds.zMax) };
    const axisDefinitions = [
      [{ ...origin, x: bounds.xMin }, { ...origin, x: bounds.xMax }, 'x'],
      [{ ...origin, y: bounds.yMin }, { ...origin, y: bounds.yMax }, 'y'],
      [{ ...origin, z: bounds.zMin }, { ...origin, z: bounds.zMax }, 'z'],
    ];
    axisDefinitions.forEach(([start, end, label]) => {
      const line = makePolyline([start, end], { class: 'math-3d-axis', 'stroke-width': 2 });
      if (line) scene.appendChild(line);
      const endPoint = project(end);
      appendSvgText(scene, label, endPoint.x + 9, endPoint.y - 7, 'math-svg-axis-label', 'start');
    });

    const surfaces = [
      ...(Array.isArray(data.surfaces) ? data.surfaces : []),
      ...(Array.isArray(data.planes) ? data.planes : []).map((plane) => {
        if (typeof plane.expression === 'string' || typeof plane.z === 'string') return plane;
        const coefficients = plane.coefficients || plane;
        const a = finite(coefficients.a, 0);
        const b = finite(coefficients.b, 0);
        const c = finite(coefficients.c, 1);
        const d = finite(coefficients.d, 0);
        if (Math.abs(c) < 1e-9) return { ...plane, invalid: true };
        return { ...plane, expression: '(-(' + a + ')*x-(' + b + ')*y-(' + d + '))/(' + c + ')' };
      }),
    ].slice(0, 8);

    surfaces.forEach((surface, surfaceIndex) => {
      if (surface.invalid) return;
      const color = safeColor(surface.color, PALETTE[surfaceIndex % PALETTE.length]);
      const gridSize = clamp(Math.floor(finite(surface.gridSize, 13)), 5, 28);
      const xDomain = Array.isArray(surface.xDomain) ? surface.xDomain : [bounds.xMin, bounds.xMax];
      const yDomain = Array.isArray(surface.yDomain) ? surface.yDomain : [bounds.yMin, bounds.yMax];
      const matrix = [];
      for (let row = 0; row < gridSize; row += 1) {
        const y = finite(yDomain[0], bounds.yMin)
          + (finite(yDomain[1], bounds.yMax) - finite(yDomain[0], bounds.yMin)) * row / (gridSize - 1);
        const rowPoints = [];
        for (let column = 0; column < gridSize; column += 1) {
          const x = finite(xDomain[0], bounds.xMin)
            + (finite(xDomain[1], bounds.xMax) - finite(xDomain[0], bounds.xMin)) * column / (gridSize - 1);
          let z;
          try {
            z = evaluateSurface(surface, x, y);
          } catch {
            z = NaN;
          }
          rowPoints.push({ x, y, z: Number(z) });
        }
        matrix.push(rowPoints);
      }
      matrix.forEach((row) => {
        const valid = row.filter((point) => Number.isFinite(point.z) && point.z >= bounds.zMin && point.z <= bounds.zMax);
        const line = makePolyline(valid, {
          stroke: color,
          'stroke-width': 1.4,
          opacity: 0.78,
          class: 'math-3d-mesh-line',
        });
        if (line) scene.appendChild(line);
      });
      for (let column = 0; column < gridSize; column += 1) {
        const valid = matrix
          .map((row) => row[column])
          .filter((point) => Number.isFinite(point.z) && point.z >= bounds.zMin && point.z <= bounds.zMax);
        const line = makePolyline(valid, {
          stroke: color,
          'stroke-width': 1.1,
          opacity: 0.56,
          class: 'math-3d-mesh-line',
        });
        if (line) scene.appendChild(line);
      }
    });

    (Array.isArray(data.curves) ? data.curves : []).slice(0, 20).forEach((curve, index) => {
      let points = Array.isArray(curve.points) ? curve.points.map(normalizePoint) : [];
      if (!points.length && typeof curve.x === 'string' && typeof curve.y === 'string' && typeof curve.z === 'string') {
        const fx = compileExpression(curve.x);
        const fy = compileExpression(curve.y);
        const fz = compileExpression(curve.z);
        const domain = Array.isArray(curve.domain) ? curve.domain : [-3, 3];
        const samples = clamp(Math.floor(finite(curve.samples, 120)), 20, 500);
        points = [];
        for (let sample = 0; sample <= samples; sample += 1) {
          const t = finite(domain[0], -3) + (finite(domain[1], 3) - finite(domain[0], -3)) * sample / samples;
          points.push({ x: fx({ t }), y: fy({ t }), z: fz({ t }) });
        }
      }
      const line = makePolyline(points, {
        stroke: safeColor(curve.color, PALETTE[index % PALETTE.length]),
        'stroke-width': clamp(finite(curve.strokeWidth, 3), 1, 8),
        class: 'math-3d-curve',
      });
      if (line) scene.appendChild(line);
    });

    (Array.isArray(data.points) ? data.points : []).slice(0, 150).forEach((rawPoint) => {
      const point = normalizePoint(rawPoint);
      const projected = project(point);
      scene.appendChild(svgElement('circle', {
        cx: projected.x,
        cy: projected.y,
        r: 4.5,
        class: 'math-plot-point',
      }));
      if (point.label) appendSvgText(scene, point.label, projected.x + 8, projected.y - 8, 'math-svg-point-label', 'start');
    });
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  svg.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    svg.setPointerCapture?.(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    state.yaw += (event.clientX - lastX) * 0.01;
    state.pitch = clamp(state.pitch + (event.clientY - lastY) * 0.01, -1.45, 1.45);
    lastX = event.clientX;
    lastY = event.clientY;
    redraw();
  });
  const stopDragging = () => { dragging = false; };
  svg.addEventListener('pointerup', stopDragging);
  svg.addEventListener('pointercancel', stopDragging);
  svg.addEventListener('keydown', (event) => {
    const delta = event.shiftKey ? 0.22 : 0.1;
    if (event.key === 'ArrowLeft') state.yaw -= delta;
    else if (event.key === 'ArrowRight') state.yaw += delta;
    else if (event.key === 'ArrowUp') state.pitch = clamp(state.pitch - delta, -1.45, 1.45);
    else if (event.key === 'ArrowDown') state.pitch = clamp(state.pitch + delta, -1.45, 1.45);
    else return;
    event.preventDefault();
    redraw();
  });

  redraw();
  const legendEntries = [
    ...(Array.isArray(data.surfaces) ? data.surfaces : []),
    ...(Array.isArray(data.planes) ? data.planes : []),
    ...(Array.isArray(data.curves) ? data.curves : []),
  ]
    .filter((item) => item?.label)
    .slice(0, 8)
    .map((item, index) => ({
      label: safeLabel(item.label),
      color: safeColor(item.color, PALETTE[index % PALETTE.length]),
    }));
  addLegend(svg, legendEntries, width);
  return { node: svg, width };
}

function renderVectorField(visual, context) {
  const width = 720;
  const height = 450;
  const data = visual.data;
  const is3D = data.dimension === 3
    || (data.field && typeof data.field.w === 'string')
    || (Array.isArray(data.vectors) && data.vectors.some((vector) => vector.z !== undefined || vector.dz !== undefined));
  const svg = createSvg(width, height, visual.alt);
  const defs = svgElement('defs');
  const markerId = uniqueDomId(context.domId, 'vector-arrow');
  createMarker(defs, markerId, 'var(--accent-strong)');
  svg.appendChild(defs);

  if (is3D) {
    const bounds = get3DBounds(data.axes);
    const project = createProjector(bounds, width, height, { yaw: -0.65, pitch: 0.58 });
    const vectors = [];
    if (Array.isArray(data.vectors)) {
      data.vectors.slice(0, 500).forEach((vector) => {
        vectors.push({
          start: normalizePoint(vector),
          delta: {
            x: finite(vector.dx ?? vector.u),
            y: finite(vector.dy ?? vector.v),
            z: finite(vector.dz ?? vector.w),
          },
          label: safeLabel(vector.label),
        });
      });
    } else if (data.field) {
      const fu = compileExpression(data.field.u || '0');
      const fv = compileExpression(data.field.v || '0');
      const fw = compileExpression(data.field.w || '0');
      const grid = clamp(Math.floor(finite(data.gridSize, 4)), 2, 7);
      for (let ix = 0; ix < grid; ix += 1) {
        for (let iy = 0; iy < grid; iy += 1) {
          for (let iz = 0; iz < grid; iz += 1) {
            const x = bounds.xMin + (bounds.xMax - bounds.xMin) * ix / (grid - 1);
            const y = bounds.yMin + (bounds.yMax - bounds.yMin) * iy / (grid - 1);
            const z = bounds.zMin + (bounds.zMax - bounds.zMin) * iz / (grid - 1);
            vectors.push({
              start: { x, y, z },
              delta: { x: fu({ x, y, z }), y: fv({ x, y, z }), z: fw({ x, y, z }) },
            });
          }
        }
      }
    }
    vectors.forEach((vector) => {
      const magnitude = Math.hypot(vector.delta.x, vector.delta.y, vector.delta.z) || 1;
      const factor = Math.min(
        (bounds.xMax - bounds.xMin) / 8,
        (bounds.yMax - bounds.yMin) / 8,
        (bounds.zMax - bounds.zMin) / 8
      ) / magnitude;
      const end = {
        x: vector.start.x + vector.delta.x * factor,
        y: vector.start.y + vector.delta.y * factor,
        z: vector.start.z + vector.delta.z * factor,
      };
      const a = project(vector.start);
      const b = project(end);
      svg.appendChild(svgElement('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        class: 'math-vector-arrow',
        'marker-end': 'url(#' + markerId + ')',
      }));
      if (vector.label) appendSvgText(svg, vector.label, b.x + 6, b.y - 6, 'math-svg-point-label', 'start');
    });
    appendSvgText(svg, '3D projection', width - 28, height - 20, 'math-svg-note', 'end');
    return { node: svg, width };
  }

  const bounds = getBounds(data.axes);
  const frame = addCartesianFrame(svg, bounds, {
    width,
    height,
    xLabel: data.axes?.xLabel || 'x',
    yLabel: data.axes?.yLabel || 'y',
  });
  const vectors = [];
  if (Array.isArray(data.vectors)) {
    data.vectors.slice(0, 500).forEach((vector) => {
      vectors.push({
        x: finite(vector.x),
        y: finite(vector.y),
        dx: finite(vector.dx ?? vector.u),
        dy: finite(vector.dy ?? vector.v),
        label: safeLabel(vector.label),
      });
    });
  } else if (data.field) {
    const fu = compileExpression(data.field.u || '0');
    const fv = compileExpression(data.field.v || '0');
    const xCount = clamp(Math.floor(finite(data.grid?.xCount ?? data.gridSize, 11)), 3, 24);
    const yCount = clamp(Math.floor(finite(data.grid?.yCount ?? data.gridSize, 9)), 3, 20);
    for (let ix = 0; ix < xCount; ix += 1) {
      for (let iy = 0; iy < yCount; iy += 1) {
        const x = bounds.xMin + (bounds.xMax - bounds.xMin) * ix / (xCount - 1);
        const y = bounds.yMin + (bounds.yMax - bounds.yMin) * iy / (yCount - 1);
        vectors.push({ x, y, dx: fu({ x, y }), dy: fv({ x, y }) });
      }
    }
  }

  const maxPixelLength = Math.min(frame.innerWidth, frame.innerHeight) / 15;
  vectors.forEach((vector) => {
    const magnitude = Math.hypot(vector.dx, vector.dy);
    if (!Number.isFinite(magnitude) || magnitude < 1e-12) return;
    const startX = frame.toX(vector.x);
    const startY = frame.toY(vector.y);
    const factor = Math.min(1, maxPixelLength / magnitude) * 0.8;
    const rawEndX = frame.toX(vector.x + vector.dx * factor);
    const rawEndY = frame.toY(vector.y + vector.dy * factor);
    const pixelMagnitude = Math.hypot(rawEndX - startX, rawEndY - startY) || 1;
    const scale = Math.min(maxPixelLength, pixelMagnitude) / pixelMagnitude;
    const endX = startX + (rawEndX - startX) * scale;
    const endY = startY + (rawEndY - startY) * scale;
    svg.appendChild(svgElement('line', {
      x1: startX, y1: startY, x2: endX, y2: endY,
      class: 'math-vector-arrow',
      'marker-end': 'url(#' + markerId + ')',
    }));
    if (vector.label) appendSvgText(svg, vector.label, endX + 6, endY - 6, 'math-svg-point-label', 'start');
  });

  (Array.isArray(data.levelCurves) ? data.levelCurves : []).slice(0, 30).forEach((curve, index) => {
    if (!Array.isArray(curve.points)) return;
    const d = pointsToPath(curve.points.map(normalizePoint), frame, bounds);
    if (!d) return;
    svg.appendChild(svgElement('path', {
      d,
      fill: 'none',
      stroke: safeColor(curve.color, PALETTE[index % PALETTE.length]),
      'stroke-width': 1.5,
      'stroke-dasharray': '6 4',
      opacity: 0.75,
    }));
  });
  return { node: svg, width };
}

function histogramPoints(values, requestedBins) {
  const numbers = values.map(Number).filter(Number.isFinite).slice(0, 10000);
  if (!numbers.length) return [];
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const bins = clamp(
    Math.floor(finite(requestedBins, Math.ceil(Math.sqrt(numbers.length)))),
    1,
    80
  );
  const span = max - min || 1;
  const width = span / bins;
  const counts = new Array(bins).fill(0);
  numbers.forEach((value) => {
    const index = Math.min(bins - 1, Math.floor((value - min) / width));
    counts[index] += 1;
  });
  return counts.map((count, index) => ({
    x0: min + index * width,
    x1: min + (index + 1) * width,
    y: count,
    label: Number((min + (index + 0.5) * width).toFixed(3)),
  }));
}

function renderDataChart(visual) {
  const width = 720;
  const height = 440;
  const data = visual.data;
  const chart = String(data.chart || '').toLowerCase();
  const svg = createSvg(width, height, visual.alt);

  if (chart === 'bar') {
    const labels = Array.isArray(data.labels) ? data.labels.map(safeLabel) : [];
    const values = Array.isArray(data.values) ? data.values.map((value) => finite(value)) : [];
    const series = Array.isArray(data.series) && data.series.length
      ? data.series.slice(0, 8).map((item) => ({
        label: safeLabel(item.label, 'Series'),
        values: Array.isArray(item.values) ? item.values.map((value) => finite(value)) : [],
        color: item.color,
      }))
      : [{ label: safeLabel(data.label, 'Values'), values, color: data.color }];
    const categoryCount = Math.max(labels.length, ...series.map((item) => item.values.length), 1);
    while (labels.length < categoryCount) labels.push(String(labels.length + 1));
    const allValues = series.flatMap((item) => item.values);
    const maxValue = Math.max(0, ...allValues);
    const minValue = Math.min(0, ...allValues);
    const bounds = getBounds({
      xMin: 0,
      xMax: categoryCount,
      yMin: data.axes?.yMin ?? minValue * 1.15,
      yMax: data.axes?.yMax ?? (maxValue || 1) * 1.15,
    }, { xMin: 0, xMax: categoryCount, yMin: 0, yMax: 1 });
    const frame = addCartesianFrame(svg, bounds, {
      width,
      height,
      margin: 84,
      xTicks: false,
      xGrid: false,
      labelPlacement: 'outside',
      xLabel: data.axes?.xLabel || '',
      yLabel: data.axes?.yLabel || '',
    });
    const groupWidth = frame.innerWidth / categoryCount;
    const barWidth = Math.max(3, groupWidth * 0.72 / series.length);
    series.forEach((item, seriesIndex) => {
      const color = safeColor(item.color, PALETTE[seriesIndex % PALETTE.length]);
      item.values.forEach((value, index) => {
        const center = frame.toX(index + 0.5);
        const x = center - (barWidth * series.length) / 2 + barWidth * seriesIndex;
        const zeroY = frame.toY(0);
        const valueY = frame.toY(value);
        svg.appendChild(svgElement('rect', {
          x,
          y: Math.min(zeroY, valueY),
          width: Math.max(1, barWidth - 2),
          height: Math.abs(zeroY - valueY),
          fill: color,
          class: 'math-chart-bar',
          'data-value': value,
          'data-category': labels[index],
        }));
        if (data.dataLabels) {
          appendSvgText(svg, value, x + barWidth / 2, valueY + (value < 0 ? 20 : -9), 'math-svg-point-label');
        }
      });
    });
    labels.forEach((label, index) => {
      appendSvgText(svg, label, frame.toX(index + 0.5), height - frame.margin + 27, 'math-svg-category-label');
    });
    if (data.legend !== false) addLegend(svg, series.map((item, index) => ({
      label: item.label,
      color: safeColor(item.color, PALETTE[index % PALETTE.length]),
    })), width, { below: true });
    return { node: svg, width };
  }

  if (chart === 'histogram') {
    const bins = histogramPoints(data.values || [], data.bins);
    const xMin = bins.length ? bins[0].x0 : 0;
    const xMax = bins.length ? bins[bins.length - 1].x1 : 1;
    const yMax = Math.max(1, ...bins.map((bin) => bin.y)) * 1.15;
    const bounds = getBounds({
      xMin: data.axes?.xMin ?? xMin,
      xMax: data.axes?.xMax ?? xMax,
      yMin: data.axes?.yMin ?? 0,
      yMax: data.axes?.yMax ?? yMax,
    }, { xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
    const frame = addCartesianFrame(svg, bounds, {
      width,
      height,
      xLabel: data.axes?.xLabel || '',
      yLabel: data.axes?.yLabel || 'Frequency',
    });
    bins.forEach((bin, index) => {
      const x0 = frame.toX(bin.x0);
      const x1 = frame.toX(bin.x1);
      const y = frame.toY(bin.y);
      const zero = frame.toY(0);
      svg.appendChild(svgElement('rect', {
        x: x0,
        y,
        width: Math.max(1, x1 - x0 - 1),
        height: zero - y,
        fill: safeColor(data.color, PALETTE[index % PALETTE.length]),
        'fill-opacity': 0.72,
        class: 'math-chart-bar',
      }));
    });
    return { node: svg, width };
  }

  let series = Array.isArray(data.series) ? data.series.slice(0, 12) : [];
  if (!series.length && Array.isArray(data.points)) {
    series = [{ label: safeLabel(data.label, chart || 'Data'), points: data.points, color: data.color }];
  }
  if ((chart === 'distribution' || chart === 'probability') && typeof data.expression === 'string') {
    const domain = Array.isArray(data.domain) ? data.domain : [-4, 4];
    const fn = compileExpression(data.expression);
    const points = [];
    for (let index = 0; index <= 260; index += 1) {
      const x = finite(domain[0], -4) + (finite(domain[1], 4) - finite(domain[0], -4)) * index / 260;
      points.push({ x, y: fn({ x }) });
    }
    series.push({ label: safeLabel(data.label, 'Distribution'), points, color: data.color });
  }
  const normalized = series.map((item, index) => ({
    label: safeLabel(item.label, 'Series ' + (index + 1)),
    color: safeColor(item.color, PALETTE[index % PALETTE.length]),
    points: (Array.isArray(item.points) ? item.points : []).slice(0, MAX_POINTS).map((point, pointIndex) => {
      const normalizedPoint = normalizePoint(point);
      const raw = point && typeof point === 'object' && !Array.isArray(point) ? point : {};
      normalizedPoint.xError = Math.abs(finite(raw.xError ?? item.errorBars?.[pointIndex]?.x, 0));
      normalizedPoint.yError = Math.abs(finite(raw.yError ?? item.errorBars?.[pointIndex]?.y, 0));
      normalizedPoint.label = safeLabel(raw.label);
      return normalizedPoint;
    }),
  }));
  const allPoints = normalized.flatMap((item) => item.points).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const xValues = allPoints.map((point) => point.x);
  const yValues = allPoints.map((point) => point.y);
  const xMinRaw = xValues.length ? Math.min(...xValues) : 0;
  const xMaxRaw = xValues.length ? Math.max(...xValues) : 1;
  const yMinRaw = yValues.length ? Math.min(...yValues) : 0;
  const yMaxRaw = yValues.length ? Math.max(...yValues) : 1;
  const xPad = Math.max(0.1, (xMaxRaw - xMinRaw) * 0.1);
  const yPad = Math.max(0.1, (yMaxRaw - yMinRaw) * 0.12);
  const bounds = getBounds({
    xMin: data.axes?.xMin ?? xMinRaw - xPad,
    xMax: data.axes?.xMax ?? xMaxRaw + xPad,
    yMin: data.axes?.yMin ?? yMinRaw - yPad,
    yMax: data.axes?.yMax ?? yMaxRaw + yPad,
  }, { xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
  const frame = addCartesianFrame(svg, bounds, {
    width,
    height,
    xLabel: data.axes?.xLabel || 'x',
    yLabel: data.axes?.yLabel || 'y',
  });

  normalized.forEach((item, index) => {
    if (chart === 'line' || chart === 'distribution' || chart === 'probability') {
      const d = pointsToPath(item.points, frame, bounds);
      if (d) svg.appendChild(svgElement('path', {
        d,
        fill: 'none',
        stroke: item.color,
        'stroke-width': 2.5,
        class: 'math-chart-line',
        'stroke-dasharray': index % 2 ? '8 5' : undefined,
      }));
    }
    item.points.forEach((point) => {
      const x = frame.toX(point.x);
      const y = frame.toY(point.y);
      if (point.xError > 0) {
        const left = frame.toX(point.x - point.xError);
        const right = frame.toX(point.x + point.xError);
        svg.appendChild(svgElement('path', {
          d: 'M ' + left + ' ' + y + ' H ' + right
            + ' M ' + left + ' ' + (y - 5) + ' V ' + (y + 5)
            + ' M ' + right + ' ' + (y - 5) + ' V ' + (y + 5),
          class: 'math-chart-error-bar',
        }));
      }
      if (point.yError > 0) {
        const top = frame.toY(point.y + point.yError);
        const bottom = frame.toY(point.y - point.yError);
        svg.appendChild(svgElement('path', {
          d: 'M ' + x + ' ' + top + ' V ' + bottom
            + ' M ' + (x - 5) + ' ' + top + ' H ' + (x + 5)
            + ' M ' + (x - 5) + ' ' + bottom + ' H ' + (x + 5),
          class: 'math-chart-error-bar',
        }));
      }
      if (chart === 'scatter' || data.showPoints || point.xError || point.yError) {
        svg.appendChild(svgElement('circle', { cx: x, cy: y, r: 4.5, fill: item.color, class: 'math-chart-point' }));
      }
      if (point.label || data.dataLabels) {
        appendSvgText(svg, point.label || point.y, x + 7, y - 8, 'math-svg-point-label', 'start');
      }
    });
  });
  addLegend(svg, normalized, width);
  return { node: svg, width };
}

function renderTable(visual) {
  const data = visual.data;
  const wrap = document.createElement('div');
  wrap.className = 'math-table-wrap';
  wrap.tabIndex = 0;
  wrap.setAttribute('aria-label', 'Scrollable data table');
  const table = document.createElement('table');
  table.className = 'math-table';

  if (data.caption) {
    const caption = document.createElement('caption');
    caption.textContent = String(data.caption);
    table.appendChild(caption);
  }

  if (Array.isArray(data.headers) && data.headers.length) {
    const thead = document.createElement('thead');
    const row = document.createElement('tr');
    if (Array.isArray(data.rowHeaders)) {
      const corner = document.createElement('th');
      corner.scope = 'col';
      corner.textContent = data.rowHeaderLabel == null ? '' : String(data.rowHeaderLabel);
      row.appendChild(corner);
    }
    data.headers.slice(0, 80).forEach((header) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = header == null ? '' : String(header);
      row.appendChild(cell);
    });
    thead.appendChild(row);
    table.appendChild(thead);
  }

  const tbody = document.createElement('tbody');
  data.rows.slice(0, 500).forEach((rawRow, rowIndex) => {
    const row = document.createElement('tr');
    if (Array.isArray(data.rowHeaders)) {
      const header = document.createElement('th');
      header.scope = 'row';
      header.textContent = data.rowHeaders[rowIndex] == null ? '' : String(data.rowHeaders[rowIndex]);
      row.appendChild(header);
    }
    const values = Array.isArray(rawRow)
      ? rawRow
      : Object.values(rawRow && typeof rawRow === 'object' ? rawRow : { value: rawRow });
    values.slice(0, 80).forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value == null ? '' : String(value);
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return { node: wrap, width: 680 };
}

function renderImage(visual) {
  const assetId = String(visual.data.assetId);
  const asset = MATH_ASSETS[assetId];
  if (!asset) {
    throw new Error('Missing approved image asset "' + assetId + '" in data/math-assets.js.');
  }
  if (typeof asset.src !== 'string'
    || !asset.src.startsWith('./assets/')
    || asset.src.includes('..') || asset.src.includes('\\')
    || !/\.(?:png|webp|svg)$/i.test(asset.src)) {
    throw new Error('Asset "' + assetId + '" does not use an approved local image path.');
  }
  const img = document.createElement('img');
  img.className = 'math-visual-image';
  img.src = new URL('../' + asset.src, import.meta.url).href;
  img.alt = visual.alt || asset.alt || '';
  img.loading = 'lazy';
  img.decoding = 'async';
  if (Number.isFinite(Number(visual.data.width))) img.width = clamp(Number(visual.data.width), 1, 4000);
  if (Number.isFinite(Number(visual.data.height))) img.height = clamp(Number(visual.data.height), 1, 4000);
  return { node: img, width: clamp(finite(visual.data.displayWidth, 680), 240, 1200) };
}

const RENDERERS = Object.freeze({
  VENN: renderVenn,
  MAPPING: renderMapping,
  FUNCTION_GRAPH: renderFunctionGraph,
  GEOMETRY_2D: renderGeometry2D,
  PLOT_3D: renderPlot3D,
  VECTOR_FIELD: renderVectorField,
  DATA_CHART: renderDataChart,
  TABLE: renderTable,
  IMAGE: renderImage,
});

export function createMathVisualError(message) {
  return createVisualError(message);
}

/**
 * Creates one accessible visual figure with common zoom controls.
 * Each renderer receives only validated JSON data and a namespaced
 * DOM id; renderer failures become visible fallbacks.
 */
export function renderMathVisual(visual, options = {}) {
  const figure = document.createElement('figure');
  figure.className = 'math-visual math-visual-' + visual.type.toLowerCase().replace(/_/g, '-');
  figure.dataset.visualId = visual.id;
  figure.dataset.visualType = visual.type;

  const toolbar = document.createElement('div');
  toolbar.className = 'math-visual-toolbar';
  const typeLabel = document.createElement('span');
  typeLabel.className = 'math-visual-type';
  typeLabel.textContent = visual.type.replace(/_/g, ' ');
  const controls = document.createElement('div');
  controls.className = 'math-visual-zoom-controls';

  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.className = 'btn btn-ghost btn-small';
  zoomOut.textContent = '−';
  zoomOut.setAttribute('aria-label', 'Zoom out visual');
  const zoomReset = document.createElement('button');
  zoomReset.type = 'button';
  zoomReset.className = 'btn btn-ghost btn-small math-visual-zoom-reset';
  zoomReset.textContent = '100%';
  zoomReset.setAttribute('aria-label', 'Reset visual zoom');
  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.className = 'btn btn-ghost btn-small';
  zoomIn.textContent = '+';
  zoomIn.setAttribute('aria-label', 'Zoom in visual');
  controls.append(zoomOut, zoomReset, zoomIn);
  const actions = document.createElement('div');
  actions.className = 'math-visual-actions';
  actions.appendChild(controls);
  toolbar.append(typeLabel, actions);

  const scroll = document.createElement('div');
  scroll.className = 'math-visual-scroll';
  scroll.tabIndex = 0;
  scroll.setAttribute('aria-label', 'Mathematical visual; scroll horizontally if needed');
  const target = document.createElement('div');
  target.className = 'math-visual-zoom-target';
  scroll.appendChild(target);

  let baseWidth = 680;
  let renderedSvg = null;
  try {
    const renderer = RENDERERS[visual.type];
    if (!renderer) throw new Error('Unsupported visual type "' + visual.type + '".');
    const result = renderer(visual, {
      domId: uniqueDomId(options.idPrefix || 'math', visual.id),
    });
    target.appendChild(result.node);
    renderedSvg = result.node.tagName.toLowerCase() === 'svg' ? result.node : null;
    baseWidth = clamp(finite(result.width, 680), 240, 1600);
  } catch (error) {
    target.appendChild(createVisualError(error instanceof Error ? error.message : String(error)));
    figure.classList.add('math-visual-has-error');
  }

  let scale = 1;
  function applyZoom() {
    // Percentages follow the current container, including hidden answers when
    // revealed and expanded dialogs. No global resize listener is needed.
    const intrinsic = baseWidth;
    target.style.width = visual.type === 'VENN' ? `max(${(renderedSvg?._minWidth || 280) * scale}px, ${100 * scale}%)` : Math.round(intrinsic * scale) + 'px';
    target.style.maxWidth = visual.type === 'VENN' ? `${(renderedSvg?._minWidth || 280) / 280 * 480 * scale}px` : 'none';
    zoomReset.textContent = Math.round(scale * 100) + '%';
    zoomOut.disabled = scale <= 0.6;
    zoomIn.disabled = scale >= 2;
  }
  zoomOut.addEventListener('click', () => {
    scale = clamp(Math.round((scale - 0.2) * 10) / 10, 0.6, 2);
    applyZoom();
  });
  zoomIn.addEventListener('click', () => {
    scale = clamp(Math.round((scale + 0.2) * 10) / 10, 0.6, 2);
    applyZoom();
  });
  zoomReset.addEventListener('click', () => {
    scale = 1;
    applyZoom();
  });
  applyZoom();

  const caption = document.createElement('figcaption');
  caption.className = 'math-visual-caption';
  caption.textContent = visual.alt;
  if (renderedSvg || visual.type === 'IMAGE') caption.setAttribute('aria-hidden', 'true');
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'btn btn-ghost btn-small math-visual-expand';
  expand.textContent = 'Expand';
  expand.setAttribute('aria-label', 'Expand mathematical visual');
  expand.setAttribute('aria-expanded', 'false');
  actions.appendChild(expand);
  expand.addEventListener('click', () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'math-visual-dialog';
    dialog.setAttribute('aria-label', 'Expanded mathematical visual: ' + visual.alt);
    if (typeof dialog.showModal !== 'function') {
      // Older browsers retain the original inline zoom/scroll functionality.
      expand.title = 'Expanded view requires a browser with dialog support. Use the zoom controls instead.';
      return;
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-secondary btn-small math-visual-dialog-close';
    close.textContent = 'Close visual';
    const placeholder = document.createComment('mathematical visual position');
    const previousScale = scale;
    const previousScroll = { left: scroll.scrollLeft, top: scroll.scrollTop };
    figure.before(placeholder);
    dialog.append(close, figure);
    document.body.appendChild(dialog);
    expand.hidden = true;
    expand.setAttribute('aria-expanded', 'true');
    scale = 1;
    applyZoom();
    const restore = () => {
      if (placeholder.parentNode) placeholder.replaceWith(figure);
      scale = previousScale;
      applyZoom();
      scroll.scrollLeft = previousScroll.left;
      scroll.scrollTop = previousScroll.top;
      expand.hidden = false;
      expand.setAttribute('aria-expanded', 'false');
      dialog.remove();
      if (figure.isConnected) expand.focus({ preventScroll: true });
    };
    dialog.addEventListener('close', restore, { once: true });
    close.addEventListener('click', () => dialog.close());
    // Native dialog supplies keyboard focus containment and Escape-to-close.
    try {
      dialog.showModal();
      close.focus();
    } catch {
      restore();
    }
  });
  const hint = document.createElement('p');
  hint.className = 'math-visual-scroll-hint';
  hint.textContent = 'Scroll horizontally to explore the diagram. Use + or Expand for a closer view.';
  figure.append(toolbar);
  if (renderedSvg) appendVisualDetails(figure, renderedSvg, visual, 'before');
  figure.append(hint, scroll);
  if (renderedSvg) {
    appendVisualDetails(figure, renderedSvg, visual, 'after');
    prepareVisualLayout(figure, renderedSvg);
    applyZoom();
  }
  figure.append(caption);
  return figure;
}
