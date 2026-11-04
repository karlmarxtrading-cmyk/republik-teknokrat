// text-utils.js
// ------------------------------------------------------------
// Small, dependency-free text normalization for content authored
// as JavaScript template literals in data/practices.js.
//
//   - dedent() lets exercises be written with natural indentation
//     inside a template literal (so the source file stays
//     readable) without that indentation leaking into the
//     rendered/copied text.
//   - practice-engine.js calls dedent() for template indentation.
//   - displayContent() separately decodes recognised serialized
//     envelopes for the parser/copy/export boundary. Raw canon
//     objects and the source file are never changed.
// ------------------------------------------------------------

/**
 * Removes the common leading indentation that the authoring style
 * in data/practices.js introduces, while preserving indentation
 * that is *relative* to that common amount — which is exactly the
 * indentation that matters inside a Python answer.
 *
 * Rules:
 *   1. A single leading blank line (from writing `\n  ...` right
 *      after the opening backtick) is dropped, not just trimmed.
 *   2. A single trailing blank line (from the closing backtick
 *      sitting on its own line) is dropped the same way.
 *   3. The minimum indentation among all remaining non-blank lines
 *      is computed and stripped from every line.
 *   4. Blank lines in the middle of the content are preserved as
 *      empty lines (never given phantom indentation).
 *   5. Everything else — relative indentation, multiple blank
 *      lines, trailing content — is left exactly as written.
 *
 * Example:
 *   dedent("\n    def hello():\n        print(1)\n    ")
 *   -> "def hello():\n    print(1)"
 */
export function dedent(input) {
  if (typeof input !== 'string') return '';

  const lines = input.replace(/\r\n/g, '\n').split('\n');

  // Rule 1 / 2: drop exactly one leading and one trailing blank line
  // (whitespace-only), which is what the opening/closing backtick
  // placement in the authoring style produces. Intentional blank
  // lines the author added beyond that are left untouched.
  if (lines.length && lines[0].trim() === '') lines.shift();
  if (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  if (lines.length === 0) return '';

  // Rule 3: minimum indentation among non-blank lines.
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const leading = line.match(/^[ \t]*/)[0].length;
    if (leading < minIndent) minIndent = leading;
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;

  // Rule 3 / 4: strip that indentation, keep blank lines empty.
  const result = lines.map((line) =>
    line.trim() === '' ? '' : line.slice(minIndent)
  );

  return result.join('\n');
}

/**
 * Recognises an authoring wrapper, not ordinary quoted prose.
 *
 * Some canon entries were imported as a YAML literal block (`|-` followed
 * by an indented body), or as an entire JSON string that still contains
 * escaped newlines. Decode only those complete, unambiguous envelopes for
 * display. The caller retains the original string; nothing is rewritten.
 * Plain quotes, backslashes in prose/TeX, and fenced code are untouched.
 * `quoted` is reserved for a title whose sibling content fields already
 * establish that the record uses a serialized representation.
 */
function serializedContent(input, { quoted = false } = {}) {
  if (typeof input !== 'string') return null;
  const candidate = input.replace(/\r\n/g, '\n');
  const literal = candidate.match(/^\|[-+]?[ \t]*\n([\s\S]*)$/);
  if (literal) {
    const body = literal[1];
    const nonempty = body.split('\n').filter((line) => line.trim());
    if (nonempty.length && nonempty.every((line) => /^[ \t]+/.test(line))) {
      return { text: dedent(body), kind: 'yaml-literal' };
    }
  }

  const trimmed = candidate.trim();
  const json = trimmed.endsWith(',') ? trimmed.slice(0, -1).trimEnd() : trimmed;
  if (!json.startsWith('"') || !json.endsWith('"')) return null;
  // A quoted ordinary sentence is not a serialization instruction. For
  // content, require encoded line breaks plus recognisable document structure.
  if (!quoted && (!/\\n/.test(json) || /\n/.test(json))) return null;
  try {
    const value = JSON.parse(json);
    if (typeof value !== 'string') return null;
    if (!quoted && !/(?:^|\n)[ \t]*(?:#{1,6}\s|Q\d+[.)]\s|\*\*)/.test(value)) return null;
    return { text: value, kind: 'json-string' };
  } catch {
    return null;
  }
}

/** Markdown to render/copy; the input source is never mutated. */
export function displayContent(input, options) {
  return serializedContent(input, options)?.text ?? (typeof input === 'string' ? input : '');
}

/** True only for a recognised serialized content envelope. */
export function hasSerializedContent(input) {
  return serializedContent(input) !== null;
}
