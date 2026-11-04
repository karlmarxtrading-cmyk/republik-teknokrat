// url-safety.js
// ------------------------------------------------------------
// Protocol allowlist for every href/src that comes from authored
// content. Pure and DOM-free so it is unit-testable in Node.
//
//   - Allowed: https:, http:, mailto:, same-page fragments (#id) and
//     scheme-less relative paths (./x, x/y, ../x).
//   - Rejected: javascript:, vbscript:, data:, file:, blob:, any other
//     scheme, protocol-relative //host URLs, and anything containing
//     control characters (used to smuggle "java\tscript:").
// ------------------------------------------------------------

const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
// eslint-disable-next-line no-control-regex
const CONTROL_RE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029]');
const LOCAL_IMAGE_RE = /^(?:\.\/)?assets\/[A-Za-z0-9._/-]+\.(?:png|webp|svg|jpe?g)$/i;

/**
 * Classifies an authored link target.
 * @returns {{ ok: boolean, href?: string, external?: boolean, reason?: string }}
 */
export function checkHref(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'not a string' };
  const href = raw.trim();
  if (!href) return { ok: false, reason: 'empty' };
  if (href.length > 2048) return { ok: false, reason: 'too long' };
  if (CONTROL_RE.test(href)) return { ok: false, reason: 'control characters' };
  if (href.startsWith('#')) return /^#[A-Za-z0-9_\-:.]*$/.test(href) ? { ok: true, href, external: false } : { ok: false, reason: 'invalid fragment' };
  if (href.startsWith('//')) return { ok: false, reason: 'protocol-relative URL' };
  // A colon before the first slash, "?" or "#" means "has a scheme".
  const schemeMatch = href.match(/^([^/?#]*?):/);
  if (!schemeMatch) {
    if (/\\/.test(href)) return { ok: false, reason: 'backslash in relative URL' };
    return { ok: true, href, external: false };
  }
  let url;
  try {
    url = new URL(href);
  } catch {
    return { ok: false, reason: 'unparseable URL' };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: 'blocked protocol ' + url.protocol };
  return { ok: true, href: url.href, external: url.protocol === 'http:' || url.protocol === 'https:' };
}

/** Only reviewed local image assets may be shown from Markdown image syntax. */
export function checkLocalImage(raw) {
  if (typeof raw !== 'string') return { ok: false };
  const src = raw.trim();
  if (CONTROL_RE.test(src) || src.includes('..')) return { ok: false };
  return LOCAL_IMAGE_RE.test(src) ? { ok: true, src: src.replace(/^\.\//, './') } : { ok: false };
}
