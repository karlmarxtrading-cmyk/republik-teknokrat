// math-content-parser.js
// ------------------------------------------------------------
// Pure, DOM-free parser and validator for fenced mathematical JSON
// declarations embedded in any content field (question, answer,
// explanation). js/content-document.js runs this FIRST, replaces each
// visual with a placeholder, and only then hands the prose to the
// Markdown parser — so declarations are never mangled by Markdown.
// ------------------------------------------------------------

export const SUPPORTED_VISUAL_TYPES = Object.freeze([
  'VENN',
  'MAPPING',
  'FUNCTION_GRAPH',
  'GEOMETRY_2D',
  'PLOT_3D',
  'VECTOR_FIELD',
  'DATA_CHART',
  'TABLE',
  'IMAGE',
]);

const TYPE_SET = new Set(SUPPORTED_VISUAL_TYPES);
const MAX_VISUAL_JSON_LENGTH = 50000;
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const TICK = String.fromCharCode(96);
const RAW_FENCE = TICK.repeat(3);
const ESCAPED_FENCE = ('\\' + TICK).repeat(3);
// Scan every code fence, including ordinary code, so a declaration inside an
// unrelated code block is never accidentally interpreted as a visual.
const FENCE_OPEN_RE = /(`{3,}|(?:\\`){3,})([^\r\n]*)\r?\n/g;

export function normalizeMathVisualFences(source) {
  const text = typeof source === 'string' ? source : String(source ?? '');
  return text.split(ESCAPED_FENCE).join(RAW_FENCE);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasArray(value, key) {
  return Array.isArray(value?.[key]) && value[key].length > 0;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateRegionCounts(data) {
  if (!Array.isArray(data.sets) || data.sets.length !== 2) {
    return 'Count-based VENN requires exactly two sets.';
  }
  if (data.sets.some((set) => !isPlainObject(set)
    || typeof set.id !== 'string' || !ID_RE.test(set.id)
    || typeof set.label !== 'string' || !set.label.trim() || set.label.length > 160)) {
    return 'Each count-based VENN set requires a valid id and a non-empty label (maximum 160 characters).';
  }
  if (data.sets[0].id === data.sets[1].id) return 'Count-based VENN set ids must be distinct.';
  if (data.sets.some((set) => hasArray(set, 'elements'))) {
    return 'Use either VENN region counts or individual elements, not both.';
  }
  const counts = data.regionCounts;
  const keys = ['leftOnly', 'rightOnly', 'intersection', 'outside'];
  if (!isPlainObject(counts) || keys.some((key) => !hasOwn(counts, key) || !isCount(counts[key]))) {
    return 'Every VENN region requires a non-negative safe integer count, including zero counts.';
  }
  if (!isCount(data.universeTotal)) return 'Count-based VENN requires a non-negative safe integer universe total.';
  const total = keys.reduce((sum, key) => sum + counts[key], 0);
  if (!Number.isSafeInteger(total) || total !== data.universeTotal) {
    return 'VENN region counts must sum exactly to the universe total.';
  }
  return null;
}

/**
 * Additive input adapter. Canonical legacy data is left untouched. No input
 * object is mutated, no code is evaluated, and aliases cannot bypass limits.
 */
export function normalizeVisualDeclaration(value) {
  if (!isPlainObject(value) || !isPlainObject(value.data) || typeof value.type !== 'string') return value;
  const type = value.type.toUpperCase();
  const data = value.data;
  if (type === 'TABLE' && hasOwn(data, 'columns')) {
    if (!Array.isArray(data.columns) || !data.columns.length || data.columns.length > 80
      || data.columns.some(c => typeof c !== 'string' || !c.trim() || c.length > 160)) {
      throw new Error('TABLE columns requires 1 to 80 non-empty text headers of at most 160 characters.');
    }
    if (data.headers !== undefined && JSON.stringify(data.headers) !== JSON.stringify(data.columns)) {
      throw new Error('TABLE headers conflict with columns.');
    }
    return { ...value, data: { ...data, headers: data.columns } };
  }
  if (type === 'DATA_CHART' && (data.chart === undefined || !hasArray(data, 'values'))
    && (hasOwn(data, 'kind') || hasOwn(data, 'bars'))
    && !hasArray(data, 'series') && !hasArray(data, 'points')) {
    const kind = data.chart ?? data.kind;
    if (typeof kind !== 'string' || kind.toLowerCase() !== 'bar'
      || (data.kind !== undefined && (typeof data.kind !== 'string' || data.kind.toLowerCase() !== 'bar'))) {
      throw new Error('DATA_CHART shorthand requires kind: "bar" and a bars array.');
    }
    if (!Array.isArray(data.bars) || !data.bars.length || data.bars.length > 1000) {
      throw new Error('DATA_CHART bars requires between 1 and 1,000 label/value objects.');
    }
    if (data.bars.some((bar) => !isPlainObject(bar)
      || typeof bar.label !== 'string' || !bar.label.trim() || bar.label.length > 160
      || typeof bar.value !== 'number' || !Number.isFinite(bar.value) || Math.abs(bar.value) > 1000000)) {
      throw new Error('Each bar requires a non-empty label (maximum 160 characters) and a finite numeric value between -1,000,000 and 1,000,000.');
    }
    if (data.axes !== undefined && !isPlainObject(data.axes)) {
      throw new Error('DATA_CHART axes must be an object.');
    }
    for (const key of ['xLabel', 'yLabel']) {
      if (data[key] !== undefined && (typeof data[key] !== 'string' || data[key].length > 160)) {
        throw new Error('DATA_CHART ' + key + ' must be a string of at most 160 characters.');
      }
    }
    const labels = data.bars.map((bar) => bar.label);
    if (data.labels !== undefined && JSON.stringify(data.labels) !== JSON.stringify(labels)) {
      throw new Error('DATA_CHART labels conflict with bars; use a single consistent representation.');
    }
    return { ...value, data: {
      ...data,
      chart: 'bar',
      labels,
      values: data.bars.map((bar) => bar.value),
      axes: { ...data.axes, xLabel: data.axes?.xLabel ?? data.xLabel, yLabel: data.axes?.yLabel ?? data.yLabel },
      dataLabels: data.dataLabels ?? true,
      legend: data.legend ?? Boolean(data.label),
    } };
  }
  if (type === 'VENN' && isPlainObject(data.regions)) {
    if (!Array.isArray(data.sets) || data.sets.length !== 2) {
      throw new Error('Count-based VENN requires exactly two sets.');
    }
    const [left, right] = data.sets;
    const keys = [String(left?.id) + '_only', String(right?.id) + '_only', 'intersection', 'outside'];
    if (Object.keys(data.regions).length !== 4 || keys.some((key) => !hasOwn(data.regions, key))) {
      throw new Error('VENN regions requires <first set id>_only, <second set id>_only, intersection, and outside.');
    }
    const universe = isPlainObject(data.universe) ? data.universe.label : data.universe;
    const total = isPlainObject(data.universe) ? data.universe.total : data.universeTotal;
    if (typeof universe !== 'string' || !universe.trim() || universe.length > 160) {
      throw new Error('Count-based VENN requires a non-empty universe label (maximum 160 characters).');
    }
    const normalized = {
      ...data,
      universe,
      universeTotal: total,
      regionCounts: {
        leftOnly: data.regions[keys[0]],
        rightOnly: data.regions[keys[1]],
        intersection: data.regions.intersection,
        outside: data.regions.outside,
      },
    };
    const error = validateRegionCounts(normalized);
    if (error) throw new Error(error);
    return { ...value, data: normalized };
  }
  return value;
}

function validateTypeData(type, data) {
  switch (type) {
    case 'VENN': {
      if (hasOwn(data, 'regionCounts')) return validateRegionCounts(data);
      if (!Array.isArray(data.sets) || data.sets.length < 2) {
        return 'VENN requires data.sets with at least two sets.';
      }
      if (data.sets.length > 6) return 'VENN supports at most six sets per visual.';
      if (data.sets.some((set) => !isPlainObject(set) || !Array.isArray(set.elements))) {
        return 'Each VENN set requires an elements array.';
      }
      if (data.sets.some((set) => (set?.elements?.length || 0) > 100)) {
        return 'VENN supports at most 100 elements per set.';
      }
      return null;
    }
    case 'MAPPING': {
      const valid = isPlainObject(data.left)
        && isPlainObject(data.right)
        && Array.isArray(data.left.elements)
        && Array.isArray(data.right.elements)
        && Array.isArray(data.arrows);
      if (!valid) return 'MAPPING requires left.elements, right.elements, and arrows arrays.';
      if (data.left.elements.length > 30 || data.right.elements.length > 30 || data.arrows.length > 80) {
        return 'MAPPING supports at most 30 elements per set and 80 arrows.';
      }
      return null;
    }
    case 'FUNCTION_GRAPH': {
      if (!hasArray(data, 'curves') && !hasArray(data, 'points')) {
        return 'FUNCTION_GRAPH requires a non-empty curves or points array.';
      }
      if ((data.curves?.length || 0) > 16 || (data.points?.length || 0) > 100) {
        return 'FUNCTION_GRAPH supports at most 16 curves and 100 labeled points.';
      }
      const collectionLimits = {
        shadedAreas: 12,
        intervals: 20,
        asymptotes: 20,
        lines: 30,
      };
      for (const [key, limit] of Object.entries(collectionLimits)) {
        if (Array.isArray(data[key]) && data[key].length > limit) {
          return 'FUNCTION_GRAPH ' + key + ' supports at most ' + limit + ' entries.';
        }
      }
      const curves = Array.isArray(data.curves) ? data.curves : [];
      if (curves.some((curve) => Array.isArray(curve?.points) && curve.points.length > 1200)) {
        return 'A FUNCTION_GRAPH curve supports at most 1,200 explicit points.';
      }
      return null;
    }
    case 'GEOMETRY_2D': {
      const requiredKeys = ['objects', 'points', 'segments', 'rays', 'lines', 'polygons', 'circles', 'arcs', 'angles'];
      const allKeys = [...requiredKeys, 'measurements', 'transformations', 'markers'];
      if (!requiredKeys.some((key) => hasArray(data, key))) {
        return 'GEOMETRY_2D requires at least one supported geometry collection.';
      }
      if (allKeys.some((key) => Array.isArray(data[key]) && data[key].length > 200)) {
        return 'A GEOMETRY_2D collection supports at most 200 objects.';
      }
      return null;
    }
    case 'PLOT_3D': {
      const keys = ['surfaces', 'curves', 'planes', 'points'];
      if (!keys.some((key) => hasArray(data, key))) {
        return 'PLOT_3D requires surfaces, curves, planes, or points.';
      }
      if ((data.surfaces?.length || 0) + (data.planes?.length || 0) > 8
        || (data.curves?.length || 0) > 20
        || (data.points?.length || 0) > 150) {
        return 'PLOT_3D supports at most eight surfaces/planes, 20 curves, and 150 points.';
      }
      if ((Array.isArray(data.curves) ? data.curves : []).some(
        (curve) => Array.isArray(curve?.points) && curve.points.length > 1200
      )) {
        return 'A PLOT_3D curve supports at most 1,200 explicit points.';
      }
      return null;
    }
    case 'VECTOR_FIELD': {
      if (!hasArray(data, 'vectors') && !isPlainObject(data.field)) {
        return 'VECTOR_FIELD requires data.vectors or data.field.';
      }
      return (data.vectors?.length || 0) <= 500
        ? null
        : 'VECTOR_FIELD supports at most 500 explicit vectors.';
    }
    case 'DATA_CHART': {
      const hasData = hasArray(data, 'values')
        || hasArray(data, 'points')
        || hasArray(data, 'series')
        || typeof data.expression === 'string';
      if (typeof data.chart !== 'string' || !hasData) {
        return 'DATA_CHART requires chart plus values, points, series, or an expression.';
      }
      const series = Array.isArray(data.series) ? data.series : [];
      if ((data.values?.length || 0) > 10000
        || (data.points?.length || 0) > 1200
        || (data.labels?.length || 0) > 1000
        || series.length > 12
        || series.some((item) => (item?.points?.length || 0) > 1200 || (item?.values?.length || 0) > 1000)) {
        return 'DATA_CHART exceeds the supported series or point limit.';
      }
      return null;
    }
    case 'TABLE': {
      if (!Array.isArray(data.rows)) return 'TABLE requires a rows array.';
      if ((data.headers?.length || 0) > 80
        || data.rows.length > 500
        || data.rows.some((row) => (
          (Array.isArray(row) && row.length > 80)
          || (isPlainObject(row) && Object.keys(row).length > 80)
        ))) {
        return 'TABLE supports at most 500 rows and 80 cells per row.';
      }
      return null;
    }
    case 'IMAGE':
      return typeof data.assetId === 'string' && data.assetId.trim()
        ? null
        : 'IMAGE requires a safe data.assetId registered in data/math-assets.js.';
    default:
      return 'Unsupported visual type.';
  }
}

function validateCanonicalDeclaration(value) {
  if (!isPlainObject(value)) return 'Visual declaration must be a JSON object.';
  if (typeof value.id !== 'string' || !ID_RE.test(value.id)) {
    return 'Visual id must start with a letter and contain only letters, numbers, underscores, or hyphens (maximum 80 characters).';
  }
  if (typeof value.type !== 'string') return 'Visual type is required.';
  const type = value.type.toUpperCase();
  if (!TYPE_SET.has(type)) {
    return 'Unsupported visual type "' + value.type + '".';
  }
  if (!isPlainObject(value.data)) return type + ' requires a data object.';
  if (typeof value.alt !== 'string' || !value.alt.trim()) {
    return type + ' requires meaningful alt text.';
  }
  if (value.alt.length > 1000) return 'Visual alt text is too long.';
  return validateTypeData(type, value.data);
}

export function validateVisualDeclaration(value) {
  try {
    return validateCanonicalDeclaration(normalizeVisualDeclaration(value));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function parseDeclaration(jsonText) {
  if (jsonText.length > MAX_VISUAL_JSON_LENGTH) {
    return { error: 'Visual declaration exceeds the 50,000-character safety limit.' };
  }
  let value;
  try {
    value = JSON.parse(jsonText);
  } catch (error) {
    return { error: 'Invalid math-visual JSON: ' + error.message };
  }
  try {
    value = normalizeVisualDeclaration(value);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const error = validateCanonicalDeclaration(value);
  if (error) return { error };
  return {
    visual: {
      id: value.id,
      type: value.type.toUpperCase(),
      data: value.data,
      alt: value.alt.trim(),
    },
  };
}

// Unknown JSON, code in a named fence (e.g. javascript/json), and ordinary
// prose are not declarations. A recognisable but invalid declaration receives
// an explicit error; arbitrary malformed code remains ordinary text.
function isVisualCandidate(body) {
  const source = body.trim();
  if (!source.startsWith('{')) return false;
  if (source.length <= MAX_VISUAL_JSON_LENGTH) {
    try {
      const value = JSON.parse(source);
      return isPlainObject(value) && typeof value.type === 'string'
        && TYPE_SET.has(value.type.toUpperCase()) && hasOwn(value, 'data');
    } catch {
      // Conservative detection of a broken declaration, not a JS evaluator.
    }
  }
  const prefix = source.slice(0, MAX_VISUAL_JSON_LENGTH);
  const type = prefix.match(/"type"\s*:\s*"([A-Za-z_]+)"/);
  return Boolean(type && TYPE_SET.has(type[1].toUpperCase())
    && /"id"\s*:/.test(prefix) && /"data"\s*:/.test(prefix) && /"alt"\s*:/.test(prefix));
}

/**
 * Splits a field into safe text and typed visual segments. Ordinary code
 * fences are opaque. Both raw and String.raw-escaped backticks are accepted.
 * Every non-visual character is preserved, including text after a visual.
 */
export function parseMathContent(source) {
  const text = typeof source === 'string' ? source : String(source ?? '');
  const segments = [];
  const issues = [];
  let cursor = 0;
  let opening;

  function appendIssue(code, message, start, end) {
    if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) });
    const issue = { code, message, source: text.slice(start, end) };
    segments.push({ kind: 'error', ...issue });
    issues.push(issue);
    cursor = end;
  }

  FENCE_OPEN_RE.lastIndex = 0;
  while ((opening = FENCE_OPEN_RE.exec(text)) !== null) {
    const marker = opening[1];
    const length = marker.replace(/\\/g, '').length;
    const language = opening[2].trim();
    const explicit = length === 3 && language === 'math-visual';
    const unlabelled = length === 3 && language === '';
    const lineStart = text.lastIndexOf('\n', opening.index - 1) + 1;
    if (!explicit && !/^[ \t]*$/.test(text.slice(lineStart, opening.index))) continue;

    // A four-or-more-backtick outer fence remains opaque, including any
    // triple-backtick visual examples it contains. Legacy explicit closers
    // can still be followed by prose on the same line.
    const closing = new RegExp(
      '(?:^|\\n)[ \\t]*(?:`{' + length + ',}|(?:\\\\`){' + length + ',})'
        + (explicit ? '(?!`)' : '(?=[ \\t]*(?:\\r?\\n|$))'),
      'g'
    );
    closing.lastIndex = Math.max(0, FENCE_OPEN_RE.lastIndex - 1);
    const end = closing.exec(text);
    const body = text.slice(FENCE_OPEN_RE.lastIndex, end ? end.index : text.length);
    if (!end) {
      if (explicit || (unlabelled && isVisualCandidate(body))) {
        appendIssue('UNCLOSED_VISUAL', 'Unclosed math-visual block.', opening.index, text.length);
      }
      break;
    }
    FENCE_OPEN_RE.lastIndex = closing.lastIndex;
    if (!explicit && !(unlabelled && isVisualCandidate(body))) continue;

    const parsed = parseDeclaration(body.trim());
    if (parsed.error) {
      appendIssue('INVALID_VISUAL', parsed.error, opening.index, closing.lastIndex);
    } else {
      if (opening.index > cursor) segments.push({ kind: 'text', text: text.slice(cursor, opening.index) });
      // `source` is additive: the exact declaration text, so the
      // Markdown pipeline can restore it for copy/export and debugging.
      segments.push({ kind: 'visual', visual: parsed.visual, source: text.slice(opening.index, closing.lastIndex) });
      cursor = closing.lastIndex;
    }
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  if (!segments.length) segments.push({ kind: 'text', text });
  return { segments, issues };
}

export function collectVisualDeclarations(source) {
  const parsed = parseMathContent(source);
  return {
    visuals: parsed.segments
      .filter((segment) => segment.kind === 'visual')
      .map((segment) => segment.visual),
    issues: parsed.issues,
  };
}
