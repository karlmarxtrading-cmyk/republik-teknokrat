// app.js
// ------------------------------------------------------------
// FILSAFAT - 1 application shell (docs/ARCHITECTURE.md).
//
//   CONTENT    data/practices.js (the only canon) + data/package-manifest.js (metadata),
//              loaded and validated by js/practice-engine.js.
//   PIPELINE   js/content-document.js (parse) -> js/content-renderer.js
//              (safe DOM) -> MathJax; typed visuals via registered fence
//              renderers (math-visual, philosophy-visual, math-studio).
//   STATE      js/progress-store.js on js/storage.js (local only).
//   VIEWS      Overview Mode (js/ui/overview-view.js) and Focus Mode
//              (js/ui/focus-view.js) read the SAME unit objects.
//   ROUTING    location.hash: #ikhtisar | #unit/<id>[/<field>/<slug>]
//              so refresh, back/forward and direct links work on any
//              static host without server rewrites.
// ------------------------------------------------------------

import { unitRoute, parseRoute } from './routes.js';
import ThemeController from './theme.js';
import { loadPractices, getPackageManifest, hasDataProblems } from './practice-engine.js';
import { buildSearchIndexAsync } from './search-index.js';
import { migrateLegacyProgress, getPrefs, setPrefs, handleExternalStorageEvent, onProgressChange } from './progress-store.js';
import { createOverviewView } from './ui/overview-view.js';
import { createFocusView, flushPendingSaves } from './ui/focus-view.js';
import { createDataDialog } from './ui/data-dialog.js';
import { h, announce } from './ui/dom.js';
import { resolveUnitId } from './unit-identity.js';
import './philosophy-visual-renderer.js'; // registers ```philosophy-visual
import './math-studio-renderer.js'; // registers ```math-studio

const $ = (id) => document.getElementById(id);
const bootState = $('bootState');
const overviewEl = $('overviewView');
const focusEl = $('focusView');

// ---------- boot error surface (never a blank page) ----------
let booted = false;
function showBootError(error) {
  const message = error && error.message ? error.message : String(error);
  bootState.hidden = false;
  bootState.className = 'boot-state boot-error';
  bootState.setAttribute('role', 'alert');
  bootState.replaceChildren(
    h('p', { class: 'boot-title', text: 'Ruang latihan tidak dapat dimuat.' }),
    h('p', { class: 'boot-error-text', text: 'Muat ulang halaman. Bila masalah berlanjut, pastikan seluruh berkas situs tersedia (misalnya folder data/ dan js/) dan Anda membuka situs melalui server web, bukan langsung dari berkas.' }),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => location.reload() }, 'Muat ulang'),
    h('details', { class: 'diagnostics' }, h('summary', {}, 'Detail teknis'), h('pre', { class: 'md-pre' }, h('code', { text: message }))));
}
window.addEventListener('error', (e) => { if (!booted) showBootError(e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => {
  console.warn('Unhandled promise rejection', e.reason);
  if (!booted) showBootError(e.reason);
});

// ---------- theme ----------
function updateThemeToggleUI() {
  const pref = ThemeController.getPreference();
  const icon = pref === 'system' ? '◐' : pref === 'dark' ? '●' : '○';
  const label = pref === 'system' ? 'Sistem' : pref === 'dark' ? 'Gelap' : 'Terang';
  $('themeToggleIcon').textContent = icon;
  $('themeToggleLabel').textContent = label;
  $('themeToggle').setAttribute('aria-label', `Tema: ${label}. Ganti tema tampilan`);
}
$('themeToggle').addEventListener('click', () => {
  ThemeController.cyclePreference();
  updateThemeToggleUI();
  announce('Tema: ' + $('themeToggleLabel').textContent);
});

function renderFooter(manifest) {
  $('siteFooterInner').replaceChildren(
    h('p', {}, h('strong', { text: `${manifest.brand} · ${manifest.name}` }), ' — ruang latihan argumentasi filsafat. Materi bersifat latihan berpikir, bukan otoritas akhir atas persoalan yang dibahas.'),
    h('p', { class: 'muted', text: 'Semua respons dan catatan tersimpan hanya di browser perangkat Anda. Rumus dirender dengan MathJax (lisensi Apache-2.0); teks dengan Source Serif 4 (SIL OFL 1.1).' }));
}

async function boot() {
  updateThemeToggleUI();
  const manifest = getPackageManifest();
  renderFooter(manifest);
  const practices = await loadPractices();
  const diagnostics = practices.diagnostics;

  migrateLegacyProgress(practices);
  // The full-content search index is only needed once someone searches:
  // build it lazily (first query) and pre-warm it when the browser is idle,
  // so first paint is not blocked by parsing every field of every unit.
  let builtIndex = null;
  const index = () => (builtIndex ||= buildSearchIndexAsync(practices));
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  idle(() => index(), { timeout: 4000 });

  let mode = 'overview';
  let overviewScroll = 0;
  let lastRoutedHash = null;
  window.addEventListener('scroll',()=>{if(mode==='overview') overviewScroll=window.scrollY;},{passive:true});
  const openUnit = (id, target) => {
    const next = unitRoute(id, target);
    if (location.hash !== next) history.pushState(null, '', next);
    route();
  };
  const overview = createOverviewView(overviewEl, { practices, manifest, index, onOpenUnit: openUnit });
  const focus = createFocusView(focusEl, { practices, onOverview: () => { location.hash = '#ikhtisar'; }, onOpenUnit: openUnit });
  const dataDialog = createDataDialog({ practices, manifest, diagnostics, onChanged: () => route() });
  $('dataBtn').addEventListener('click', () => dataDialog.open());

  if (hasDataProblems(diagnostics)) {
    const identityProblems = diagnostics.duplicateSourceNumbers + diagnostics.duplicateSourceIds + diagnostics.invalidSourceIds + diagnostics.invalidSourceNumbers + diagnostics.missingStableIdentity;
    const metadataProblems = diagnostics.invalidManifestIds + diagnostics.duplicateManifestIds + diagnostics.duplicateManifestNumbers + diagnostics.ambiguousLegacyIds;
    overviewEl.prepend(h('div', { class: 'content-warning', role: 'note' },
      h('strong', { text: 'Catatan data konten: ' }),
      `${diagnostics.malformed} entri tidak dapat ditampilkan, ${diagnostics.fieldIssues} masalah kolom konten, ${identityProblems} masalah identitas unit, ${diagnostics.answerMirrorMismatches} ketidaksesuaian jawaban, ${diagnostics.ambiguousSeparator} pemisah pembahasan ambigu, ${metadataProblems} masalah metadata, ${diagnostics.invalidVisuals + diagnostics.duplicateVisualIds} masalah visual. Rincian ada di “Data lokal → Diagnostik konten”.`));
  }

  function setMode(next) {
    mode = next;
    document.documentElement.dataset.mode = next;
    $('modeOverview').setAttribute('aria-pressed', String(next === 'overview'));
    $('modeFocus').setAttribute('aria-pressed', String(next === 'focus'));
    overviewEl.hidden = next !== 'overview';
    focusEl.hidden = next !== 'focus';
  }

  function route({ resume = false } = {}) {
    lastRoutedHash = location.hash;
    flushPendingSaves();
    const r = parseRoute(location.hash);
    if (r.invalid) announce('Tautan tidak dikenali. Menampilkan ikhtisar paket.');
    if (r.view === 'focus' && practices.length) {
      const resolved = resolveUnitId(r.unitId, practices);
      if (resolved && resolved !== r.unitId) {
        history.replaceState(null, '', location.hash.replace(/^#unit\/[^/]+/, `#unit/${resolved}`));
        r.unitId = resolved;
      }
      const exists = practices.some((p) => p.id === r.unitId);
      setMode('focus');
      focus.show(exists ? r.unitId : practices[0].id, r.target || (resume ? {field:'resume'} : null));
      document.title = `${(practices.find((p) => p.id === r.unitId) || practices[0]).displayTitle} — FILSAFAT - 1`;
      if (!exists) announce('Unit tidak ditemukan; menampilkan unit pertama.');
    } else {
      focus.destroy();
      setMode('overview');
      setPrefs({ mode: 'overview' });
      overview.show();
      document.title = 'FILSAFAT - 1 — Ruang Latihan Argumentasi Filsafat · Dynanca';
      if (booted) { requestAnimationFrame(()=>{window.scrollTo(0,overviewScroll);overview.focusTitle();}); }
    }
  }

  $('modeOverview').addEventListener('click', () => { if (mode !== 'overview') location.hash = '#ikhtisar'; });
  $('modeFocus').addEventListener('click', () => {
    if (mode === 'focus' || !practices.length) return;
    const prefs = getPrefs();
    openUnit(practices.some((p) => p.id === prefs.lastUnit) ? prefs.lastUnit : practices[0].id,{field:'resume'});
  });
  // The skip link must move focus without touching the hash router.
  $('skipLink').addEventListener('click', (e) => { e.preventDefault(); const m = $('main'); m.focus(); m.scrollIntoView({ block: 'start' }); });
  $('brandLink').addEventListener('click', (e) => { e.preventDefault(); location.hash = '#ikhtisar'; if (mode === 'overview') route(); });
  window.addEventListener('popstate', () => route({resume:true}));
  window.addEventListener('hashchange', () => { if (location.hash !== lastRoutedHash) route(); });
  window.addEventListener('storage', (e) => { handleExternalStorageEvent(e); if (mode === 'overview' && e.key && e.key.startsWith('filsafat-1:')) overview.refresh(); });
  window.addEventListener('pagehide', flushPendingSaves);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPendingSaves(); });
  onProgressChange(() => { if (mode === 'overview') overview.refresh(); });

  bootState.hidden = true;
  if (!location.hash && getPrefs().mode === 'focus' && getPrefs().lastUnit && practices.some((p) => p.id === getPrefs().lastUnit)) {
    history.replaceState(null, '', unitRoute(getPrefs().lastUnit,{field:'resume'}));
  }
  route();
  booted = true;
  window.__filsafat = { practices, diagnostics, get index() { return index(); } }; // read-only debugging aid
}

boot().catch((error) => {
  console.error('FILSAFAT - 1 boot failed', error);
  showBootError(error);
});
