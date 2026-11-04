// content-document.js
// ------------------------------------------------------------
// DOM-FREE parse stage of the content pipeline (docs/ARCHITECTURE.md).
//
//   1. parseMathContent() finds fenced `math-visual` declarations
//      (the existing, unchanged parser). Each visual/error segment is
//      replaced by a private-use placeholder paragraph so Markdown can
//      never mangle its JSON.
//   2. markdown-it (vendored, CommonMark + GFM tables, raw HTML OFF,
//      linkify OFF, typographer OFF) parses the prose into tokens, with
//      js/markdown-math.js protecting \( \) and \[ \] TeX.
//   3. Top-level headings split the document into sections. For each
//      section we keep: title, level, argumentative role, the exact
//      display source slice (placeholders restored) for copy/export,
//      and plain text for search.
//   Serialized YAML/JSON envelopes are decoded in memory first. `source`
//   retains the exact input; `displaySource` is the readable Markdown.
//
// Results are cached per source string (bounded LRU) because the same
// field is parsed for search, rendering and export.
// ------------------------------------------------------------

import MarkdownIt from './vendor/markdown-it.mjs';
import { markdownMath } from './markdown-math.js';
import { parseMathContent } from './math-content-parser.js';
import { displayContent } from './text-utils.js';

export const PLACEHOLDER_RE = /^VIS(\d+)$/;
const placeholder = (k) => `VIS${k}`;

let md = null;
export function getMarkdown() {
  if (md) return md;
  md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
  md.use(markdownMath);
  return md;
}

// The eight argumentative functions of a model answer (CONTENT-SCHEMA §answer).
// Order matters: more specific patterns first ("Tanggapan terhadap Sanggahan"
// is a rebuttal, "Batas Kesimpulan" is a limitation, not a synthesis).
export const ROLES = Object.freeze([
  { role: 'position', label: 'Posisi awal', en: 'Initial Position', re: /initial position|posisi awal/i },
  { role: 'definition', label: 'Definisi konsep', en: 'Definition', re: /\bdefinition\b|definisi/i },
  { role: 'premises', label: 'Premis & asumsi', en: 'Premises', re: /\bpremis|premise|asumsi dasar/i },
  { role: 'rebuttal', label: 'Tanggapan', en: 'Rebuttal', re: /rebuttal|tanggapan terhadap/i },
  { role: 'counter', label: 'Sanggahan terkuat', en: 'Counterargument', re: /counter-?argument|sanggahan/i },
  { role: 'limitations', label: 'Batas kesimpulan', en: 'Limitations', re: /limitation|batas kesimpulan|keterbatasan/i },
  { role: 'synthesis', label: 'Sintesis', en: 'Synthesis', re: /synthesis|sintesis/i },
  { role: 'argumentation', label: 'Argumentasi', en: 'Argumentation', re: /argumentation|pembedahan argumen|argumentasi/i },
]);
export const ROLE_ORDER = ['position', 'definition', 'premises', 'argumentation', 'counter', 'rebuttal', 'synthesis', 'limitations'];

export function detectRole(title) {
  if (typeof title !== 'string') return null;
  const hit = ROLES.find((r) => r.re.test(title));
  return hit ? hit.role : null;
}
export function roleInfo(role) {
  return ROLES.find((r) => r.role === role) || null;
}

const cache = new Map();
const CACHE_LIMIT = 64;

function inlineText(token) {
  if (!token.children) return token.content || '';
  return token.children.map((c) => {
    if (c.type === 'softbreak' || c.type === 'hardbreak') return ' ';
    if (c.type === 'math_inline') return (c.markup === 'display' ? '\\[' : '\\(') + c.content + (c.markup === 'display' ? '\\]' : '\\)');
    if (c.type === 'image') return c.content || '';
    return c.content || '';
  }).join('');
}

// Titles may contain author-supplied inline Markdown; keep raw metadata intact.
export function titleText(text, { serialized = false } = {}) {
  const value = displayContent(String(text || ''), { quoted: serialized });
  return getMarkdown().parseInline(value, {}).map(inlineText).join('');
}

export function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'bagian';
}

/**
 * Parses one content field. Pure: no DOM, no globals besides the cache.
 * @returns {{ source, md, tokens, specials, sections, topLevel, minLevel }}
 */
export function parseDocument(source) {
  const raw = typeof source === 'string' ? source : '';
  if (cache.has(raw)) {
    const hit = cache.get(raw);
    cache.delete(raw); cache.set(raw, hit); // LRU touch
    return hit;
  }

  const text = displayContent(raw);

  const parsed = parseMathContent(text);
  const specials = [];
  let mdText = '';
  for (const segment of parsed.segments) {
    if (segment.kind === 'text') { mdText += segment.text; continue; }
    const k = specials.length;
    specials.push(segment);
    mdText += `\n\n${placeholder(k)}\n\n`;
  }

  const tokens = getMarkdown().parse(mdText, {});
  const lines = mdText.split('\n');

  // minLevel drives heading re-levelling (all headings); topLevel drives
  // sectioning and only counts headings at nesting depth 0, so a heading
  // inside a list/blockquote can never split a nested structure.
  let minLevel = 7;
  let top = 7;
  for (const t of tokens) {
    if (t.type !== 'heading_open') continue;
    const lv = Number(t.tag.slice(1));
    minLevel = Math.min(minLevel, lv);
    if (t.level === 0) top = Math.min(top, lv);
  }
  const topLevel = top === 7 ? null : top;

  // Section boundaries: every top-level heading starts a section; content
  // before the first one is an untitled "intro" section.
  const sections = [];
  let current = { index: 0, title: null, level: null, role: null, startLine: 0, startToken: 0, text: [], subheadings: [] };
  sections.push(current);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open') {
      const level = Number(t.tag.slice(1));
      const title = inlineText(tokens[i + 1]).trim();
      if (level === topLevel && t.level === 0) {
        current = { index: sections.length, title, level, role: detectRole(title), startLine: t.map ? t.map[0] : 0, startToken: i, text: [], subheadings: [] };
        sections.push(current);
        continue;
      }
      current.subheadings.push({ title, level });
    }
    if (t.type === 'inline') current.text.push(inlineText(t));
    else if (t.type === 'fence' || t.type === 'code_block' || t.type === 'math_block') current.text.push(t.content);
  }

  const restore = (slice) => slice.replace(/VIS(\d+)/g, (_, k) => (specials[Number(k)]?.source ?? '').trim());
  sections.forEach((s, i) => {
    const end = i + 1 < sections.length ? sections[i + 1].startLine : lines.length;
    s.endLine = end;
    s.endToken = i + 1 < sections.length ? sections[i + 1].startToken : tokens.length;
    s.source = restore(lines.slice(s.startLine, end).join('\n')).replace(/^\n+|\n+$/g, '');
    s.plainText = s.text.join('\n').replace(/VIS\d+/g, '').replace(/[ \t]+/g, ' ').trim();
    delete s.text;
  });
  // Drop an empty intro (the usual case when a field opens with a heading).
  if (sections.length > 1 && !sections[0].source.trim()) sections.shift();
  const usedSlugs = new Set();
  sections.forEach((s, i) => {
    s.index = i;
    const base = s.title ? slugify(s.title) : 'pendahuluan';
    s.slug = base;
    for (let n = 2; usedSlugs.has(s.slug); n++) s.slug = `${base}-${n}`;
    usedSlugs.add(s.slug);
  });

  const result = { source: raw, displaySource: text, md: mdText, tokens, specials, sections, topLevel, minLevel: minLevel === 7 ? 1 : minLevel, issues: parsed.issues };
  cache.set(raw, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return result;
}

/** Plain-text outline used by search and export. */
export function outlineOf(source) {
  return parseDocument(source).sections.map(({ index, title, level, role, slug, plainText, source: src, subheadings }) => ({ index, title, level, role, slug, plainText, source: src, subheadings }));
}
