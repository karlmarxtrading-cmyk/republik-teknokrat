import { questionTargets } from './question-index.js';
// content-renderer.js
// ------------------------------------------------------------
// DOM stage of the content pipeline: markdown-it TOKENS -> safe DOM.
//
// Security model (docs/ARCHITECTURE.md §Security):
//   - Raw HTML is disabled in the parser; any html_* token that could
//     still appear is rendered as inert text.
//   - Every node is created with createElement/createTextNode. No
//     innerHTML, no insertAdjacentHTML, no eval/new Function.
//   - Only an allowlist of tags is produced. Attributes are never copied
//     from tokens wholesale: alignment becomes a class, links go through
//     js/url-safety.js, images must be reviewed local assets.
//   - Fenced `math-visual` JSON is rendered by the existing typed math
//     renderer; `philosophy-visual` and `math-studio` fences by their own
//     validated renderers (registered via options.fenceHandlers).
// ------------------------------------------------------------

import { parseDocument, PLACEHOLDER_RE, roleInfo, slugify } from './content-document.js';
import { checkHref, checkLocalImage } from './url-safety.js';
import { createMathVisualError, renderMathVisual } from './math-visual-renderer.js';

const BLOCK_TAGS = new Set(['p', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const INLINE_TAGS = { strong_open: 'strong', em_open: 'em', s_open: 's' };
const CAPTION_RE = /^(?:tabel|table)\s*[\w.-]*\s*[:.—–-]\s*/i;

const fenceRegistry = new Map();
/** Lets other modules (philosophy visuals, math studio) own a fence language. */
export function registerFenceRenderer(language, render) {
  fenceRegistry.set(language, render);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function srOnly(text) {
  return el('span', 'sr-only', text);
}

function renderLink(token, stackTop) {
  const check = checkHref(token.attrGet('href'));
  if (!check.ok) {
    const span = el('span', 'md-link-blocked');
    span.title = 'Tautan diblokir demi keamanan (' + check.reason + ')';
    span.dataset.blockedReason = check.reason;
    stackTop.appendChild(span);
    return span;
  }
  const a = el('a', 'md-link');
  a.href = check.href;
  const title = token.attrGet('title');
  if (title) a.title = title;
  if (check.external) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.classList.add('md-link-external');
    a.dataset.external = 'true';
  }
  stackTop.appendChild(a);
  return a;
}

function finishLink(a) {
  if (a && a.dataset && a.dataset.external === 'true') {
    const icon = el('span', 'md-link-icon', '↗');
    icon.setAttribute('aria-hidden', 'true');
    a.append(icon, srOnly(' (membuka tab baru)'));
  }
}

function renderInline(children, parent) {
  const stack = [parent];
  const top = () => stack[stack.length - 1];
  for (const t of children || []) {
    switch (t.type) {
      case 'text': top().appendChild(document.createTextNode(t.content)); break;
      case 'softbreak': top().appendChild(document.createTextNode('\n')); break;
      case 'hardbreak': top().appendChild(document.createElement('br')); break;
      case 'code_inline': top().appendChild(el('code', 'md-code', t.content)); break;
      case 'math_inline': {
        const display = t.markup === 'display';
        const span = el('span', display ? 'math-tex math-tex-display' : 'math-tex', display ? '\\[' + t.content + '\\]' : '\\(' + t.content + '\\)');
        span.dataset.tex = t.content;
        top().appendChild(span);
        break;
      }
      case 'link_open': stack.push(renderLink(t, top())); break;
      case 'link_close': { const a = stack.pop(); finishLink(a); break; }
      case 'image': {
        const check = checkLocalImage(t.attrGet('src'));
        const alt = t.children ? t.children.map((c) => c.content).join('') : t.content;
        if (check.ok) {
          const img = el('img', 'md-image');
          img.src = check.src;
          img.alt = alt || '';
          img.loading = 'lazy';
          img.decoding = 'async';
          top().appendChild(img);
        } else {
          top().appendChild(el('span', 'md-image-blocked', alt ? '[Gambar: ' + alt + ']' : '[Gambar tidak tersedia]'));
        }
        break;
      }
      case 'html_inline': top().appendChild(document.createTextNode(t.content)); break;
      default: {
        if (INLINE_TAGS[t.type]) { const n = el(INLINE_TAGS[t.type]); top().appendChild(n); stack.push(n); break; }
        if (/_close$/.test(t.type) && stack.length > 1) { stack.pop(); break; }
        if (t.content) top().appendChild(document.createTextNode(t.content));
      }
    }
  }
}

function renderFence(token, ctx) {
  const info = (token.info || '').trim();
  const language = info.split(/\s+/)[0];
  const handler = fenceRegistry.get(language);
  if (handler) {
    try {
      return handler(token.content, { idPrefix: ctx.idPrefix, index: ctx.fenceCount++ });
    } catch (error) {
      return createMathVisualError((error && error.message) || String(error));
    }
  }
  const pre = el('pre', 'md-pre');
  const code = el('code', language && /^[a-z0-9+#-]{1,24}$/i.test(language) ? 'language-' + language.toLowerCase() : null, token.content.replace(/\n$/, ''));
  pre.tabIndex = 0;
  pre.setAttribute('aria-label', language ? 'Blok kode ' + language : 'Blok kode');
  pre.appendChild(code);
  return pre;
}

function renderSpecial(segment, ctx) {
  if (segment.kind === 'error') {
    const box = createMathVisualError(segment.message);
    box.appendChild(sourceDisclosure(segment.source));
    return box;
  }
  const visual = segment.visual;
  if (ctx.seenVisualIds.has(visual.id)) {
    return createMathVisualError('Duplicate visual id "' + visual.id + '" in this question. Every visual id must be unique.');
  }
  ctx.seenVisualIds.add(visual.id);
  const figure = renderMathVisual(visual, { idPrefix: ctx.idPrefix });
  // A declaration can pass validation yet fail while drawing (e.g. an
  // expression the safe parser rejects): offer its source for debugging.
  if (figure.classList.contains('math-visual-has-error')) figure.appendChild(sourceDisclosure(segment.source));
  return figure;
}

/** "Lihat deklarasi sumber" disclosure for failed visuals (author debugging). */
export function sourceDisclosure(source) {
  const details = el('details', 'visual-source');
  details.append(el('summary', null, 'Lihat deklarasi sumber'));
  const pre = el('pre', 'md-pre');
  pre.appendChild(el('code', null, source || ''));
  details.appendChild(pre);
  return details;
}

function tableCaption(table, ctx, prev) {
  const caption = el('caption');
  if (prev && prev.tagName === 'P' && CAPTION_RE.test(prev.textContent)) {
    while (prev.firstChild) caption.appendChild(prev.firstChild);
    prev.remove();
    caption.className = 'md-caption';
  } else {
    caption.className = 'sr-only';
    caption.textContent = ctx.sectionTitle ? 'Tabel dalam bagian “' + ctx.sectionTitle + '”' : 'Tabel ' + ctx.idPrefix;
  }
  table.prepend(caption);
  return caption.textContent;
}

function renderTokens(tokens, start, end, parent, ctx) {
  const stack = [parent];
  const top = () => stack[stack.length - 1];
  for (let i = start; i < end; i++) {
    const t = tokens[i];
    if (t.type === 'paragraph_open') {
      const inline = tokens[i + 1];
      const m = inline && inline.type === 'inline' ? inline.content.trim().match(PLACEHOLDER_RE) : null;
      if (m) {
        top().appendChild(renderSpecial(ctx.specials[Number(m[1])], ctx));
        i += 2; // skip inline + paragraph_close
        continue;
      }
      // A paragraph that is exactly one display formula becomes a block.
      if (inline && inline.children && inline.children.length === 1 && inline.children[0].type === 'math_inline' && inline.children[0].markup === 'display') {
        const div = el('div', 'math-display');
        renderInline(inline.children, div);
        top().appendChild(div);
        i += 2;
        continue;
      }
    }
    switch (t.type) {
      case 'heading_open': {
        const level = Math.min(6, Math.max(ctx.headingBase, Number(t.tag.slice(1)) - ctx.minLevel + ctx.headingBase));
        const h = el('h' + level, 'md-heading md-h' + level);
        applyQTarget(h, ctx.questionTargets.get(i), ctx);
        top().appendChild(h);
        stack.push(h);
        break;
      }
      case 'inline': renderInline(t.children, top()); break;
      case 'fence': top().appendChild(renderFence(t, ctx)); break;
      case 'code_block': {
        const pre = el('pre', 'md-pre');
        pre.tabIndex = 0;
        pre.appendChild(el('code', null, t.content.replace(/\n$/, '')));
        top().appendChild(pre);
        break;
      }
      case 'math_block': {
        const div = el('div', 'math-display');
        const span = el('span', 'math-tex math-tex-display', '\\[' + t.content + '\\]');
        span.dataset.tex = t.content;
        div.appendChild(span);
        top().appendChild(div);
        break;
      }
      case 'hr': top().appendChild(el('hr', 'md-hr')); break;
      case 'html_block': top().appendChild(el('p', 'md-raw-html', t.content)); break;
      case 'table_open': {
        const wrap = el('div', 'table-scroll');
        const table = el('table', 'md-table');
        let label = tableCaption(table, ctx, top().lastElementChild);
        // Region (landmark) names must be unique on the page.
        const n = (ctx.regionNames.get(label) || 0) + 1;
        ctx.regionNames.set(label, n);
        if (n > 1) label += ` (${n})`;
        wrap.tabIndex = 0;
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('aria-label', label + ' (dapat digulir)');
        wrap.appendChild(table);
        top().appendChild(wrap);
        stack.push(table);
        break;
      }
      case 'table_close': stack.pop(); break;
      default: {
        if (t.nesting === 1) {
          const tag = BLOCK_TAGS.has(t.tag) ? t.tag : 'div';
          const node = el(tag, tag === 'blockquote' ? 'md-blockquote' : null);
          applyQTarget(node, ctx.questionTargets.get(i), ctx);
          if (tag === 'ol') { const s = Number(t.attrGet('start')); if (Number.isInteger(s) && s !== 1) node.start = s; }
          if (tag === 'th' || tag === 'td') {
            const style = t.attrGet('style') || '';
            const align = style.match(/text-align:(left|right|center)/);
            if (align) node.classList.add('align-' + align[1]);
            if (tag === 'th') node.scope = ctx.inTbody ? 'row' : 'col';
          }
          if (tag === 'tbody') ctx.inTbody = true;
          if (tag === 'thead') ctx.inTbody = false;
          top().appendChild(node);
          stack.push(node);
        } else if (t.nesting === -1) {
          if (stack.length > 1) stack.pop();
        }
      }
    }
  }
}

/**
 * Renders a content field into semantic DOM, grouped into <section>s.
 *
 * @param {string} source  canonical field text
 * @param {object} options
 *   idPrefix     DOM-id namespace (unit + field), required for uniqueness
 *   headingBase  level the field's top heading maps to (default 3)
 *   roles        decorate the eight argumentative roles (model answer)
 *   seenVisualIds  Set shared across fields of one unit (id uniqueness)
 * @returns {{ root: HTMLElement, sections: Array, doc: object }}
 */
export function renderDocument(source, options = {}) {
  const doc = parseDocument(source);
  const idPrefix = String(options.idPrefix || 'doc').replace(/[^A-Za-z0-9_-]/g, '-');
  const root = el('div', 'doc-content math-content');
  const ctx = {
    idPrefix,
    questionTargets: new Map(questionTargets(source).filter(t=>!t.ambiguous).map(t=>[t.tokenIndex,t])),
    headingBase: options.headingBase || 3,
    minLevel: doc.minLevel,
    specials: doc.specials,
    seenVisualIds: options.seenVisualIds || new Set(),
    fenceCount: 0,
    sectionTitle: null,
    inTbody: false,
    regionNames: new Map(),
  };
  const used = new Set();
  const sections = doc.sections.map((meta) => {
    const section = el('section', 'doc-section');
    let id = `${idPrefix}-${meta.slug}`;
    for (let n = 2; used.has(id); n++) id = `${idPrefix}-${meta.slug}-${n}`;
    used.add(id);
    section.id = id;
    section.dataset.sectionIndex = String(meta.index);
    ctx.sectionTitle = meta.title;
    if (options.roles && meta.role) {
      const info = roleInfo(meta.role);
      section.dataset.role = meta.role;
      section.classList.add('role-section', 'role-' + meta.role);
      const chip = el('p', 'role-chip', info.label);
      chip.setAttribute('aria-hidden', 'true');
      section.appendChild(chip);
    }
    renderTokens(doc.tokens, meta.startToken, meta.endToken, section, ctx);
    // Every heading gets a slug so typed visuals can link to sub-headings too.
    section.querySelectorAll('.md-heading').forEach((hd) => { hd.dataset.slug = slugify(hd.textContent); });
    const heading = section.querySelector(':scope > .md-heading');
    if (heading) {
      heading.id = id + '-h';
      heading.tabIndex = -1;
      section.setAttribute('aria-labelledby', heading.id);
    }
    root.appendChild(section);
    return { ...meta, id, element: section, headingEl: heading };
  });
  return { root, sections, doc };
}

function applyQTarget(node, target, ctx) {
  if (!target) return;
  node.dataset.qNumber = String(target.number);
  node.id = `${ctx.idPrefix}-question-${target.number}`;
  node.tabIndex = -1;
}
