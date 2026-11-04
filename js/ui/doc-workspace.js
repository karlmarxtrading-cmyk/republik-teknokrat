// ui/doc-workspace.js
// ------------------------------------------------------------
// One readable document (question, model answer or explanation):
//   - semantic Markdown via js/content-renderer.js,
//   - per-section tools: copy that section's readable Markdown, bookmark,
//   - active-section tracking (IntersectionObserver) and a reading
//     progress value for the table of contents,
//   - MathJax typesetting once the DOM is connected.
// ------------------------------------------------------------

import { h } from './dom.js';
import { renderDocument } from '../content-renderer.js';
import { copyWithFeedback } from './clipboard.js';
import { typesetMath } from '../math-typesetter.js';

export function createDocWorkspace({ unitId, field, source, roles = false, headingBase = 3, seenVisualIds, sectionTools = true, bookmarks }) {
  const { root, sections } = renderDocument(source, { idPrefix: `${unitId}-${field}`, roles, headingBase, seenVisualIds });
  root.classList.add('doc-' + field);
  const listeners = new Set();
  let active = null;

  if (sectionTools) {
    for (const s of sections) {
      if (!s.headingEl) continue;
      const copyBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-small', 'aria-label': `Salin bagian: ${s.title}` }, 'Salin bagian');
      copyBtn.addEventListener('click', () => copyWithFeedback(s.source, copyBtn, 'bagian ini'));
      const markBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-small bookmark-btn', 'aria-pressed': 'false', 'aria-label': `Tandai bagian: ${s.title}` });
      const paint = () => {
        const on = bookmarks?.has(field, s.slug);
        markBtn.setAttribute('aria-pressed', String(Boolean(on)));
        markBtn.textContent = on ? '★ Ditandai' : '☆ Tandai';
      };
      paint();
      markBtn.addEventListener('click', () => { bookmarks?.toggle(field, s.slug, s.title); paint(); });
      s.repaintBookmark = paint;
      s.headingEl.after(h('div', { class: 'section-tools', dataset: { copyHost: '' } }, copyBtn, markBtn));
    }
  }

  let observer = null;
  let destroyed = false;
  function observe() {
    if (destroyed || observer || typeof IntersectionObserver === 'undefined') return;
    const visible = new Map();
    observer = new IntersectionObserver((entries) => {
      if (destroyed) return;
      for (const e of entries) visible.set(e.target, e.isIntersecting ? e.boundingClientRect.top : null);
      const candidates = sections.filter((s) => visible.get(s.element) != null);
      const next = candidates.length ? candidates[0] : null;
      if (next && next !== active) {
        active = next;
        listeners.forEach((fn) => fn(active));
      }
    }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });
    sections.forEach((s) => observer.observe(s.element));
  }

  return {
    field,
    element: root,
    sections,
    onActiveChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get active() { return active; },
    /** 0..1: how far the reader has scrolled through this document. */
    progress() {
      const rect = root.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      if (!root.isConnected || rect.height === 0) return 0;
      const read = Math.min(rect.height, Math.max(0, vh * 0.6 - rect.top));
      return Math.max(0, Math.min(1, read / rect.height));
    },
    mount() { observe(); return typesetMath(root); },
    repaintBookmarks() { sections.forEach((s) => s.repaintBookmark?.()); },
    destroy() { destroyed = true; observer?.disconnect(); observer = null; listeners.clear(); window.MathJax?.typesetClear?.([root]); },
  };
}
