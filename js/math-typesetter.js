// math-typesetter.js
// ------------------------------------------------------------
// Serializes MathJax work for dynamically inserted content. MathJax
// is bundled locally and configured in index.html; this module
// also provides an explicit visible fallback if startup fails.
//
// Fallback contract: raw TeX (\(..\) / \[..\]) stays in the DOM and
// remains readable/copyable; a warning with a "Coba lagi" button is
// shown. A failed readiness check is NOT cached forever (audit §13.1):
// the next typeset call — or the retry button — probes MathJax again.
// ------------------------------------------------------------

let queue = Promise.resolve();
let readiness = null;
let injected = false;

// The local MathJax bundle (~2.1 MB) is loaded ON DEMAND, the first time a
// typeset request meets TeX delimiters. Earlier versions loaded it with
// <script defer> on every page; because deferred classic scripts run before
// module scripts, the whole app waited for it even when no content used TeX.
// Same file, same configuration (window.MathJax in index.html), same CSP.
export const MATHJAX_SRC = new URL('../assets/vendor/mathjax/tex-svg.js', import.meta.url).href;
function ensureMathJaxScript() {
  if (injected || typeof document === 'undefined' || !window.MathJax || window.MathJax.startup?.promise) return;
  injected = true;
  const script = document.createElement('script');
  script.src = MATHJAX_SRC;
  script.async = true;
  script.dataset.mathjax = 'on-demand';
  script.addEventListener('error', () => { injected = false; script.remove(); }); // allow retry
  document.head.appendChild(script);
}

/** True when an element's text contains TeX delimiters. */
export function containsTex(root) {
  const text = root && root.textContent;
  return Boolean(text && (text.includes('\\(') || text.includes('\\[')));
}

function normalizeRoots(value) {
  if (!value) return [];
  const roots = Array.isArray(value) ? value : [value];
  return roots.filter((root) => root && root.nodeType === 1);
}

function showFailure(root, message) {
  root.classList.add('math-typeset-failed');
  if (root.querySelector(':scope > .math-render-warning')) return;
  const doc = root.ownerDocument;
  const warning = doc.createElement('div');
  warning.className = 'math-render-warning';
  warning.setAttribute('role', 'alert');
  const text = doc.createElement('span');
  text.textContent = 'Rumus belum dapat ditampilkan (' + message + '). Teks TeX aslinya tetap terlihat di bawah. ';
  const retry = doc.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn-secondary btn-small';
  retry.textContent = 'Coba lagi';
  retry.addEventListener('click', () => {
    warning.remove();
    root.classList.remove('math-typeset-failed');
    typesetMath(root);
  });
  warning.append(text, retry);
  root.prepend(warning);
}

export function waitForMathJax(timeoutMs = 10000) {
  if (readiness) return readiness;
  const attempt = new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(null);
      return;
    }
    // In DOM-only test runners the inline MathJax configuration from
    // index.html is intentionally absent. Resolve immediately instead
    // of leaving synthetic tests waiting on a browser script.
    if (!window.MathJax) {
      resolve(null);
      return;
    }
    ensureMathJaxScript();
    const started = Date.now();
    const check = () => {
      const mathJax = window.MathJax;
      if (mathJax?.startup?.promise && typeof mathJax.typesetPromise === 'function') {
        mathJax.startup.promise.then(() => resolve(mathJax)).catch(() => resolve(null));
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(check, 40);
    };
    check();
  });
  readiness = attempt.then((mj) => {
    if (!mj) readiness = null; // allow a later retry instead of caching failure
    return mj;
  });
  return readiness;
}

/** True when the page contains TeX delimiters worth typesetting. */
export function hasTex(root) {
  return Boolean(root && root.querySelector && root.querySelector('.math-tex'));
}

export function typesetMath(roots) {
  const elements = normalizeRoots(roots);
  if (!elements.length) return queue;
  queue = queue.then(async () => {
    // Pagination can remove cards while earlier typesetting is queued.
    const connected = elements.filter(root => root.isConnected);
    // No TeX in these roots: nothing to typeset, so MathJax is not loaded.
    connected.filter((root) => !containsTex(root)).forEach((root) => root.classList.add('math-typeset-complete'));
    let active = connected.filter(containsTex);
    if (!active.length) return;
    const mathJax = await waitForMathJax();
    active = active.filter(root=>root.isConnected);
    if(!active.length) return;
    if (!mathJax) {
      active.filter(hasTex).forEach((root) => showFailure(root, 'MathJax lokal tidak berhasil dimulai'));
      return;
    }
    try {
      await mathJax.typesetPromise(active);
      active.forEach((root) => {
        root.classList.add('math-typeset-complete');
        root.querySelectorAll('mjx-container[display="true"]').forEach((math) => {
          math.tabIndex = 0;
          math.setAttribute('role', 'group');
          math.setAttribute('aria-label', 'Rumus matematika; gulir horizontal bila perlu');
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      active.forEach((root) => showFailure(root, message));
      console.warn('math-typesetter: MathJax typesetting failed', error);
    }
  });
  return queue;
}

export function clearMath(root) {
  if (!root || typeof window === 'undefined') return;
  try {
    window.MathJax?.typesetClear?.([root]);
  } catch (error) {
    console.warn('math-typesetter: unable to clear removed MathJax items', error);
  }
}
