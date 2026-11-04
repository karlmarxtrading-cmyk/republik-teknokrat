// ui/clipboard.js — copy with visible success AND failure feedback.
// When both the Clipboard API and the execCommand fallback fail, the
// learner is told how to copy manually and the text is selected for them.

import { h, announce } from './dom.js';

function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  return legacyCopy(text);
}

/**
 * Copies `text` and shows feedback next to `button`.
 * `label` names what was copied ("pertanyaan", "bagian ini", …).
 */
export async function copyWithFeedback(text, button, label = 'teks') {
  const ok = await copyText(text);
  const host = button.closest('[data-copy-host]') || button.parentElement;
  let note = host.querySelector(':scope > .copy-note');
  if (!note) {
    note = h('span', { class: 'copy-note', role: 'status' });
    host.appendChild(note);
  }
  clearTimeout(note._t);
  note.classList.toggle('copy-note-error', !ok);
  note.textContent = ok ? `Tersalin: ${label}.` : 'Tidak dapat menyalin otomatis — pilih teks di bawah lalu tekan Ctrl+C (⌘C di Mac).';
  if (!ok) {
    let fallback = host.querySelector(':scope > .copy-fallback');
    if (!fallback) {
      fallback = h('textarea', { class: 'copy-fallback', readonly: true, rows: 6, 'aria-label': 'Teks untuk disalin manual' });
      host.appendChild(fallback);
    }
    fallback.value = text;
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
  } else {
    host.querySelector(':scope > .copy-fallback')?.setAttribute('hidden', '');
    note._t = setTimeout(() => { note.textContent = ''; }, 2600);
  }
  announce(note.textContent);
  return ok;
}
