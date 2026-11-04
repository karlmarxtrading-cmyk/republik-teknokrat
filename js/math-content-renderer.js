// math-content-renderer.js
// ------------------------------------------------------------
// Backwards-compatible entry point. Earlier versions put every text
// segment into a <div class="math-text"> via textContent, so Markdown
// appeared as literal "###", "**" and "|" characters (audit P0).
//
// renderMathContent() keeps its signature and its guarantees — safe
// DOM, typed math-visual figures, per-question visual-id uniqueness,
// MathJax-ready TeX — but now delegates to the semantic Markdown
// pipeline in js/content-renderer.js.
// ------------------------------------------------------------

import { renderDocument } from './content-renderer.js';

export function renderMathContent(source, options = {}) {
  const { root } = renderDocument(source, {
    idPrefix: options.idPrefix || 'math-content',
    seenVisualIds: options.seenVisualIds || new Set(),
    headingBase: options.headingBase || 3,
    roles: Boolean(options.roles),
  });
  return root;
}
