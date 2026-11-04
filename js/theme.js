// theme.js
// ------------------------------------------------------------
// PRESENTATION LAYER ONLY — theme switching (light / dark / system).
// Persists to its own namespaced key ('filsafat-1:theme'), separate
// from learning progress (js/progress-store.js), so a corrupted or
// blocked theme preference can never affect progress or vice versa.
// A preference saved by earlier versions under 'dynanca.theme' is
// read once as a fallback (and copied forward); it is never deleted,
// because other Dynanca pages on the same origin may still use it.
//
// The actual <html data-theme="..."> attribute is already set as
// early as possible by the inline snippet in index.html's <head>
// (before first paint, so there is no flash of the wrong theme).
// This module only wires up the visible toggle button afterwards
// and keeps it in sync if the OS theme changes while "system" is
// selected.
// ------------------------------------------------------------

const STORAGE_KEY = 'filsafat-1:theme';
const LEGACY_KEY = 'dynanca.theme';
const VALID = (v) => v === 'light' || v === 'dark' || v === 'system';
const root = document.documentElement;
const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function safeGet() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (VALID(v)) return v;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (VALID(legacy)) { localStorage.setItem(STORAGE_KEY, legacy); return legacy; }
    return v;
  } catch (e) { return memoryPref; }
}
let memoryPref = null;
function safeSet(v) {
  memoryPref = v;
  try { localStorage.setItem(STORAGE_KEY, v); return true; } catch (e) { return false; }
}

/** 'light' | 'dark' | 'system' — the user's stored preference (defaults to 'system'). */
function getPreference() {
  const v = safeGet();
  return VALID(v) ? v : 'system';
}

function systemPrefersDark() {
  return !!(media && media.matches);
}

function effectiveTheme(pref) {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref;
}

function apply(pref) {
  root.setAttribute('data-theme', effectiveTheme(pref));
  root.setAttribute('data-theme-pref', pref);
}

function setPreference(pref) {
  apply(pref);
  safeSet(pref);
  const detail = { pref, effective: effectiveTheme(pref) };
  document.dispatchEvent(new CustomEvent('gp:themechange', { detail })); // legacy event name kept
  document.dispatchEvent(new CustomEvent('filsafat:themechange', { detail }));
}

const ORDER = ['system', 'light', 'dark'];
function cyclePreference() {
  const cur = getPreference();
  const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
  setPreference(next);
  return next;
}

// Keep "system" live if the OS theme changes while the tab is open.
if (media) {
  const onChange = () => {
    if (getPreference() !== 'system') return;
    apply('system');
    document.dispatchEvent(new CustomEvent('filsafat:themechange', { detail: { pref: 'system', effective: effectiveTheme('system') } }));
  };
  if (media.addEventListener) media.addEventListener('change', onChange);
  else if (media.addListener) media.addListener(onChange);
}

const ThemeController = { getPreference, effectiveTheme, setPreference, cyclePreference };
export default ThemeController;
