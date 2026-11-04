// markdown-math.js
// ------------------------------------------------------------
// markdown-it plugin that protects TeX from Markdown parsing.
//
//   Inline  \( ... \)  -> token "math_inline"  (markup "inline")
//   Inline  \[ ... \]  -> token "math_inline"  (markup "display")
//   Block   a line starting with \[ up to the line ending with \]
//           -> token "math_block"
//
// Without this, CommonMark would treat "\(" as an escaped "(" and
// silently delete the backslash, and "_" / "*" inside formulas would
// become emphasis. The TeX source is kept verbatim (including its
// delimiters) so MathJax can typeset it later and the raw formula
// remains visible/copyable if MathJax is unavailable.
// ------------------------------------------------------------

function mathInline(state, silent) {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== 0x5c /* \ */) return false;
  const open = src[pos + 1];
  if (open !== '(' && open !== '[') return false;
  const close = open === '(' ? '\\)' : '\\]';
  const end = src.indexOf(close, pos + 2);
  if (end < 0) return false;
  if (!silent) {
    const token = state.push('math_inline', 'span', 0);
    token.content = src.slice(pos + 2, end);
    token.markup = open === '(' ? 'inline' : 'display';
  }
  state.pos = end + 2;
  return true;
}

function mathBlock(state, startLine, endLine, silent) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false; // indented code
  if (state.src.slice(pos, pos + 2) !== '\\[') return false;
  let line = startLine;
  let content = '';
  let first = state.src.slice(pos + 2, max);
  let closed = false;
  const closeAt = first.indexOf('\\]');
  if (closeAt >= 0) {
    if (first.slice(closeAt + 2).trim()) return false; // prose after formula -> inline rule
    content = first.slice(0, closeAt);
    closed = true;
  } else {
    content = first;
    while (++line < endLine) {
      pos = state.bMarks[line] + state.tShift[line];
      max = state.eMarks[line];
      if (pos < max && state.sCount[line] < state.blkIndent) break;
      const text = state.src.slice(pos, max);
      const at = text.indexOf('\\]');
      if (at >= 0) {
        if (text.slice(at + 2).trim()) return false;
        content += '\n' + text.slice(0, at);
        closed = true;
        break;
      }
      content += '\n' + text;
    }
  }
  if (!closed) return false;
  if (silent) return true;
  const token = state.push('math_block', 'div', 0);
  token.block = true;
  token.content = content;
  token.map = [startLine, line + 1];
  token.markup = '\\[';
  state.line = line + 1;
  return true;
}

export function markdownMath(md) {
  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}
