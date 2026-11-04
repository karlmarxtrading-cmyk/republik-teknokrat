// ui/focus-view.js
// ------------------------------------------------------------
// FOCUS MODE — one unit as an active learning sequence:
//
//   1. Kasus & pertanyaan        (always visible, copyable)
//   2. Ruang respons Anda        (structured, optional fields, autosave)
//   3. Jawaban model             (deliberate reveal; built lazily on
//                                 first open; 8 argumentative roles,
//                                 derived flow map, per-section copy +
//                                 bookmark, copy all, Markdown export)
//   4. Pembahasan                (separate reveal, own sections)
//   5. Refleksi & revisi         (initial vs revised position, history,
//                                 honest self-assessment, notes, export)
//
// A table of contents (sticky aside on wide screens, dialog on small
// screens) tracks the section in view and the reading progress of the
// answer and explanation. Every action that changes progress is a real
// action; nothing is inferred or scored.
// ------------------------------------------------------------

import { h, clear, announce, formatDateTime, scrollToElement } from './dom.js';
import { createDocWorkspace } from './doc-workspace.js';
import { createFlowMap } from './flow-map.js';
import { copyWithFeedback } from './clipboard.js';
import { downloadText, safeFilename } from './download.js';
import { confirmDialog } from './confirm-dialog.js';
import { createUnitPager, createUnitPicker } from './unit-navigation.js';
import { getReadingPosition, setReadingPosition } from '../reading-position.js';
import { typesetMath } from '../math-typesetter.js';
import { questionIndex } from '../question-index.js';
import { unitRoute } from '../routes.js';
import { outlineOf } from '../content-document.js';
import { displayContent } from '../text-utils.js';
import { getDifficultyBucket, DIFFICULTY_LABELS } from '../practice-meta.js';
import {
  RESPONSE_FIELDS, STEPS, FLAGS, getUnitState, stepsOf, markStep, setResponseField, snapshotBeforeAnswer,
  saveRevision, setFlag, setNotes, toggleBookmark, clearUnitWriting, getStorageStatus, onProgressChange, setPrefs, hasInitialResponse,
} from '../progress-store.js';

const WORDS_PER_MINUTE = 200;
const AUTOSAVE_MS = 600;

export function readingMinutes(text) {
  const words = displayContent(text).replace(/[#*|`>-]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

const pendingSaves = new Set();
export function flushPendingSaves() {
  for (const fn of [...pendingSaves]) fn();
}

function storageMessage() {
  const { status } = getStorageStatus();
  if (status === 'ok') return { text: 'Tersimpan otomatis di browser perangkat ini.', tone: 'ok' };
  if (status === 'error') return { text: 'Penyimpanan perangkat penuh atau ditolak — perubahan terbaru hanya ada di tab ini. Unduh catatan agar tidak hilang.', tone: 'warn' };
  return { text: 'Penyimpanan perangkat tidak tersedia (misalnya mode privat) — tulisan hanya bertahan sampai tab ditutup. Unduh catatan agar tidak hilang.', tone: 'warn' };
}

function bindAutosave(textarea, save, statusEl) {
  let timer = null;
  const run = () => {
    clearTimeout(timer);
    timer = null;
    pendingSaves.delete(run);
    const { durable } = save(textarea.value);
    const msg = durable ? { text: 'Tersimpan · ' + formatDateTime(Date.now()), tone: 'ok' } : storageMessage();
    if (statusEl) {
      statusEl.textContent = msg.text;
      statusEl.dataset.tone = msg.tone;
    }
    if (!durable) announce(msg.text);
  };
  textarea.addEventListener('input', () => {
    if (statusEl) { statusEl.textContent = 'Menyimpan…'; statusEl.dataset.tone = 'pending'; }
    clearTimeout(timer);
    timer = setTimeout(run, AUTOSAVE_MS);
    pendingSaves.add(run);
  });
  textarea.addEventListener('blur', () => { if (timer) run(); });
}

function autoGrow(textarea) {
  const fit = () => { textarea.style.height = 'auto'; textarea.style.height = Math.min(textarea.scrollHeight + 2, 640) + 'px'; };
  textarea.addEventListener('input', fit);
  requestAnimationFrame(fit);
}

export function buildNotesExport(unit, state, format = 'md') {
  const md = format === 'md';
  const lines = [];
  const hd = (level, text) => lines.push(md ? `${'#'.repeat(level)} ${text}` : text.toUpperCase(), '');
  hd(1, `Catatan belajar — ${unit.displayTitle ?? unit.title}`);
  lines.push(`Paket: FILSAFAT - 1 · Unit ${unit.number}`, `Diekspor: ${formatDateTime(Date.now())}`, '');
  hd(2, 'Respons saya');
  for (const f of RESPONSE_FIELDS) {
    if (!state.response[f.key].trim()) continue;
    lines.push(md ? `**${f.label}**` : f.label + ':', '', state.response[f.key].trim(), '');
  }
  if (state.response.revision.trim()) { hd(2, 'Revisi posisi'); lines.push(state.response.revision.trim(), ''); }
  if (state.history.length) {
    hd(2, 'Riwayat respons');
    for (const item of state.history) {
      lines.push(`${formatDateTime(item.at)} — ${item.kind === 'revised' ? 'revisi disimpan' : 'posisi sebelum membuka jawaban model'}`, '');
      for (const f of [...RESPONSE_FIELDS, {key: 'revision', label: 'Revisi posisi'}]) {
        if (item.response[f.key]?.trim()) lines.push(`${f.label}:`, item.response[f.key], '');
      }
    }
    lines.push('');
  }
  if (state.notes.trim()) { hd(2, 'Catatan pribadi'); lines.push(state.notes.trim(), ''); }
  if (state.bookmarks.length) {
    hd(2, 'Bagian yang ditandai');
    for (const b of state.bookmarks) lines.push(`${md ? '-' : '*'} ${b.field === 'answer' ? 'Jawaban model' : 'Pembahasan'} → ${b.title}`);
    lines.push('');
  }
  const steps = stepsOf(state);
  hd(2, 'Jejak belajar (tercatat di perangkat ini)');
  for (const s of STEPS) lines.push(`${md ? '-' : '*'} [${steps[s.key] ? 'x' : ' '}] ${s.label}`);
  for (const f of FLAGS) lines.push(`${md ? '-' : '*'} [${state.flags[f.key] ? 'x' : ' '}] ${f.label}${f.note ? ` (${f.note})` : ''}`);
  return lines.join('\n') + '\n';
}

export function buildAnswerExport(unit) {
  return [`# ${unit.displayTitle ?? unit.title}`, '', '## Pertanyaan', '', displayContent(unit.question).trim(), '', '## Jawaban model', '', displayContent(unit.answer).trim(), ''].join('\n');
}
export function buildExplanationExport(unit) {
  return [`# ${unit.displayTitle ?? unit.title}`, '', '## Pembahasan', '', displayContent(unit.explanation).trim(), ''].join('\n');
}

export function createFocusView(container, { practices, onOverview, onOpenUnit }) {
  let teardown = [];
  let current = null;

  function destroy() {
    flushPendingSaves();
    teardown.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    teardown = [];
    clear(container);
  }

  function show(unitId, target = null) {
    const unit = practices.find((p) => p.id === unitId) || practices[0];
    if (!unit) return;
    destroy();
    current = unit;
    const resume = target?.field === 'resume' ? getReadingPosition(unit.id) : null;
    setPrefs({ lastUnit: unit.id, mode: 'focus' });
    markStep(unit.id, 'opened');
    const index = practices.indexOf(unit);
    const seenVisualIds = new Set();
    const idp = `u-${unit.id}`;
    const tocTargets = [];
    const questions = questionIndex(unit);
    const picker = createUnitPicker(practices, unit.id, onOpenUnit);
    document.body.appendChild(picker.element);
    teardown.push(() => picker.destroy());
    const pager = (position) => createUnitPager(practices, unit, onOpenUnit, () => picker.open(), position);
    const topbar = h('div', { class: 'focus-topbar' },
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: onOverview }, '← Ikhtisar paket'), pager('top'));

    // ---------- header + journey ----------
    const journey = h('ol', { class: 'journey', 'aria-label': 'Jejak belajar unit ini' });
    const paintJourney = () => {
      const st = getUnitState(unit.id);
      const steps = stepsOf(st);
      clear(journey);
      STEPS.forEach((s) => journey.appendChild(h('li', { class: 'journey-step' + (steps[s.key] ? ' is-done' : '') },
        h('span', { class: 'journey-mark', 'aria-hidden': 'true', text: steps[s.key] ? '✓' : '' }),
        h('span', { text: s.label }),
        h('span', { class: 'sr-only', text: steps[s.key] ? ' — tercatat' : ' — belum' }))));
    };
    paintJourney();
    const bucket = getDifficultyBucket(unit);
    const minutes = readingMinutes(unit.question) + readingMinutes(unit.answer) + readingMinutes(unit.explanation);
    const header = h('header', { class: 'unit-header' },
      h('p', { class: 'eyebrow', text: `FILSAFAT - 1 · Unit ${unit.number}` }),
      h('h1', { class: 'unit-title', id: `${idp}-title`, tabindex: '-1', text: unit.displayTitle ?? unit.title }),
      h('p', { class: 'unit-meta' },
        h('span', { text: `± ${minutes} menit membaca materi` }),
        h('span', { class: 'muted', text: ' (perkiraan dari jumlah kata; belum termasuk waktu menulis)' }),
        h('span', { class: 'unit-meta-sep', 'aria-hidden': 'true', text: ' · ' }),
        h('span', { text: bucket ? `Tingkat: ${DIFFICULTY_LABELS[bucket]}` : 'Tingkat kesulitan: tidak ditentukan penulis' })),
      journey);

    // ---------- 1. question ----------
    let alive = true;
    const frame = (fn) => requestAnimationFrame(() => { if (alive) fn(); });
    teardown.push(() => { alive = false; });
    const qDoc = createDocWorkspace({ unitId: unit.id, field: 'question', source: unit.question, headingBase: 3, seenVisualIds, sectionTools: false });
    teardown.push(() => qDoc.destroy());
    const copyQ = h('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Salin pertanyaan');
    copyQ.addEventListener('click', () => copyWithFeedback(displayContent(unit.question), copyQ, 'pertanyaan'));
    const qPanel = panel('question', 'Kasus dan pertanyaan', '1', [
      qDoc.element,
      h('div', { class: 'panel-actions', dataset: { copyHost: '' } }, copyQ),
    ]);

    // ---------- 2. response workspace ----------
    const state0 = getUnitState(unit.id);
    const saveStatus = h('p', { class: 'save-status', dataset: { tone: 'idle' } });
    const initialStorage = storageMessage();
    saveStatus.textContent = initialStorage.tone === 'ok' ? (hasInitialResponse(state0) ? 'Respons tersimpan di perangkat ini.' : 'Belum ada respons. Semua kolom opsional.') : initialStorage.text;
    saveStatus.dataset.tone = initialStorage.tone === 'ok' ? 'idle' : 'warn';
    const fieldNodes = RESPONSE_FIELDS.map((f, i) => {
      const id = `${idp}-resp-${f.key}`;
      const ta = h('textarea', { id, class: 'response-input', rows: i < 2 ? 3 : 2, 'aria-describedby': `${id}-hint`, spellcheck: 'true' });
      ta.value = state0.response[f.key];
      bindAutosave(ta, (value) => { const r = setResponseField(unit.id, f.key, value); paintJourney(); paintReveal(); return r; }, saveStatus);
      autoGrow(ta);
      return { f, node: h('div', { class: 'response-field' }, h('label', { for: id, class: 'response-label', text: f.label }), h('p', { class: 'response-hint', id: `${id}-hint`, text: f.hint }), ta) };
    });
    const extraOpen = RESPONSE_FIELDS.slice(2).some((f) => state0.response[f.key].trim());
    const respPanel = panel('response', 'Ruang respons Anda', '2', [
      h('p', { class: 'panel-lede', text: 'Tulis dulu jawaban Anda sendiri sebelum membuka jawaban model. Isi sebagian atau semuanya — tidak ada kolom wajib dan tidak ada penilaian otomatis.' }),
      fieldNodes[0].node, fieldNodes[1].node,
      h('details', { class: 'response-more', open: extraOpen },
        h('summary', {}, 'Lengkapi struktur argumen (opsional): bukti, sanggahan, tanggapan, keyakinan'),
        fieldNodes.slice(2).map((x) => x.node)),
      saveStatus,
      h('p', { class: 'privacy-note' }, h('strong', { text: 'Privasi: ' }), 'tulisan Anda hanya disimpan di browser perangkat ini, tidak dikirim ke server mana pun, dan tidak tersinkron ke perangkat lain. Menghapus data situs akan menghapusnya — gunakan “Data lokal” untuk mengunduh cadangan.'),
    ]);

    // ---------- 3/4. answer + explanation (lazy) ----------
    const reveal = {};
    const docs = {};
    function makeRevealable(field, title, num, { onFirstOpen, toolbar, bodyExtra }) {
      const bodyId = `${idp}-${field}-body`;
      const toggle = h('button', { type: 'button', class: 'btn btn-primary reveal-btn', 'aria-expanded': 'false', 'aria-controls': bodyId });
      const hint = h('p', { class: 'reveal-hint' });
      const body = h('div', { class: 'panel-body', id: bodyId, hidden: true, tabindex: '-1' });
      const progress = h('progress', { class: 'read-progress', max: 100, value: 0, 'aria-label': `Progres baca ${title.toLowerCase()}` });
      let built = false;
      const label = { answer: ['Buka jawaban model', 'Tutup jawaban model'], explanation: ['Pelajari pembahasan', 'Tutup pembahasan'] }[field];
      const paint = (open) => { toggle.textContent = open ? label[1] : label[0]; toggle.setAttribute('aria-expanded', String(open)); toggle.classList.toggle('btn-primary', !open); toggle.classList.toggle('btn-secondary', open); };
      paint(false);
      function open({ focus = true } = {}) {
        if (!built) {
          built = true;
          const doc = onFirstOpen();
          docs[field] = doc;
          decorateQuestions(doc, field);
          const extra = bodyExtra ? bodyExtra(doc) : null;
          body.append(...[h('div', { class: 'doc-toolbar', dataset: { copyHost: '' } }, toolbar(doc), progress), extra, doc.element].filter(Boolean),
            h('div', { class: 'panel-actions' },
              h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => scrollToElement(qPanel.querySelector('h2')) }, '↑ Kembali ke pertanyaan'),
              field === 'answer' ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { reveal.explanation.open(); } }, 'Lanjut ke pembahasan') : h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => scrollToElement(reflPanel.querySelector('h2')) }, 'Lanjut ke refleksi')));
          doc.mount();
          refreshToc();
        }
        body.hidden = false;
        paint(true);
        if (focus) scrollToElement(body.querySelector('.doc-toolbar') || body, { focus: false }), body.focus({ preventScroll: true });
        refreshToc();
        onScroll();
      }
      function close() {
        body.hidden = true;
        paint(false);
        toggle.focus();
        refreshToc();
      }
      toggle.addEventListener('click', () => (body.hidden ? open() : close()));
      reveal[field] = { open, close, isOpen: () => !body.hidden, progress, toggle };
      return panel(field, title, num, [h('div', { class: 'reveal-row' }, toggle, hint), body], { hint });
    }

    const bookmarksApi = {
      has: (field, slug) => getUnitState(unit.id).bookmarks.some((b) => b.field === field && b.slug === slug),
      toggle: (field, slug, title) => {
        const { added } = toggleBookmark(unit.id, { field, slug, title });
        announce(added ? `Bagian “${title}” ditandai.` : `Penanda “${title}” dihapus.`);
        paintBookmarks();
      },
    };

    let flow = null;
    const ansPanel = makeRevealable('answer', 'Jawaban model', '3', {
      onFirstOpen: () => {
        flushPendingSaves();
        snapshotBeforeAnswer(unit.id);
        markStep(unit.id, 'answerOpened');
        paintJourney();
        paintRefl();
        return createDocWorkspace({ unitId: unit.id, field: 'answer', source: unit.answer, roles: true, headingBase: 3, seenVisualIds, bookmarks: bookmarksApi });
      },
      toolbar: (doc) => docToolbar(doc, unit.answer, 'jawaban model', buildAnswerExport(unit), safeFilename(unit.title + '-jawaban-model', 'md')),
      bodyExtra: (doc) => {
        flow = createFlowMap(doc.sections, (s) => scrollToElement(s.headingEl), `${idp}-answer`);
        return flow.coverage.length >= 2 ? flow.element : null;
      },
    });
    const expPanel = makeRevealable('explanation', 'Pembahasan', '4', {
      onFirstOpen: () => {
        markStep(unit.id, 'explanationOpened');
        paintJourney();
        return createDocWorkspace({ unitId: unit.id, field: 'explanation', source: unit.explanation, headingBase: 3, seenVisualIds, bookmarks: bookmarksApi });
      },
      toolbar: (doc) => docToolbar(doc, unit.explanation, 'pembahasan', buildExplanationExport(unit), safeFilename(unit.title + '-pembahasan', 'md')),
    });

    if (!unit.explanation.trim()) {
      expPanel._noContent = true;
      expPanel.querySelector('.reveal-row').replaceChildren(h('p', { class: 'reveal-hint', text: 'Source unit ini tidak memuat pembahasan terpisah.' }));
    }

    function docToolbar(doc, source, label, exportText, filename) {
      const copyAll = h('button', { type: 'button', class: 'btn btn-secondary btn-small' }, `Salin ${label} lengkap`);
      copyAll.addEventListener('click', () => copyWithFeedback(displayContent(source), copyAll, label));
      const dl = h('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Unduh Markdown (.md)');
      dl.addEventListener('click', () => { downloadText(filename, exportText); announce('Berkas Markdown dibuat di perangkat Anda.'); });
      return h('span', { class: 'doc-toolbar-actions' }, h('span', { class: 'muted', text: `${doc.sections.filter((s) => s.title).length} bagian` }), copyAll, dl);
    }

    function paintReveal() {
      const st = getUnitState(unit.id);
      const hint = ansPanel._hint;
      hint.textContent = hasInitialResponse(st)
        ? 'Respons awal Anda akan disimpan sebagai “posisi sebelum membuka jawaban model” untuk dibandingkan nanti.'
        : 'Belum ada respons awal. Anda tetap boleh membuka jawaban, tetapi mencoba menjawab dulu membantu membandingkan penalaran Anda.';
      if (!expPanel._noContent) expPanel._hint.textContent = 'Pembahasan memperdalam konsep, konteks tradisi, evaluasi premis, kekeliruan penalaran, latihan, dan referensi.';
    }

    // ---------- 5. reflection ----------
    const reflBody = h('div', { class: 'reflection' });
    const reflPanel = panel('reflection', 'Refleksi, revisi, dan catatan', '5', [reflBody]);
    const bookmarkList = h('ul', { class: 'bookmark-list' });
    function paintBookmarks() {
      const st = getUnitState(unit.id);
      clear(bookmarkList);
      if (!st.bookmarks.length) bookmarkList.appendChild(h('li', { class: 'muted', text: 'Belum ada bagian yang ditandai. Gunakan “☆ Tandai” di samping judul bagian.' }));
      for (const b of st.bookmarks) {
        bookmarkList.appendChild(h('li', {}, h('a', { href: unitRoute(unit.id, b), onclick: (e) => { e.preventDefault(); goTo({ field: b.field, slug: b.slug, title: b.title }); } }, `${b.field === 'answer' ? 'Jawaban model' : 'Pembahasan'} → ${b.title}`)));
      }
      Object.values(docs).forEach((d) => d.repaintBookmarks());
    }

    function paintRefl() {
      flushPendingSaves();
      const st = getUnitState(unit.id);
      clear(reflBody);
      const before = st.history.find((h0) => h0.kind === 'before-answer');
      const revisionId = `${idp}-revision`;
      const revStatus = h('p', { class: 'save-status' });
      const revision = h('textarea', { id: revisionId, class: 'response-input', rows: 4, 'aria-describedby': `${revisionId}-hint` });
      revision.value = st.response.revision;
      bindAutosave(revision, (v) => { const r = setResponseField(unit.id, 'revision', v); saveRevBtn.disabled = !v.trim(); return r; }, revStatus);
      autoGrow(revision);
      const saveRevBtn = h('button', { type: 'button', class: 'btn btn-primary', disabled: !st.response.revision.trim() }, 'Simpan sebagai revisi posisi');
      saveRevBtn.addEventListener('click', () => {
        flushPendingSaves();
        const saved = saveRevision(unit.id);
        paintJourney();
        paintRefl();
        announce(saved.durable ? 'Revisi posisi disimpan ke riwayat.' : storageMessage().text);
        reflBody.querySelector('.revision-history summary')?.focus();
      });

      const compare = h('div', { class: 'compare-grid' },
        h('div', { class: 'compare-col' },
          h('h3', { class: 'compare-title', text: 'Posisi awal Anda' }),
          before && before.response.position.trim()
            ? h('blockquote', { class: 'compare-quote' }, h('p', { text: before.response.position.trim() }), h('footer', { class: 'muted', text: 'Ditulis sebelum membuka jawaban model · ' + formatDateTime(before.at) }))
            : st.response.position.trim()
              ? h('blockquote', { class: 'compare-quote' }, h('p', { text: st.response.position.trim() }), h('footer', { class: 'muted', text: st.answerOpened ? 'Ditulis atau diubah setelah jawaban model dibuka.' : 'Jawaban model belum dibuka.' }))
              : h('p', { class: 'muted', text: 'Belum ada posisi awal yang ditulis di Ruang respons.' })),
        h('div', { class: 'compare-col' },
          h('label', { for: revisionId, class: 'compare-title', text: 'Apakah posisi Anda berubah? Bagaimana dan mengapa?' }),
          h('p', { class: 'response-hint', id: `${revisionId}-hint`, text: 'Setelah membaca jawaban model dan pembahasan, nyatakan posisi akhir Anda — termasuk bagian yang Anda pertahankan dan batas kesimpulannya.' }),
          revision, revStatus, saveRevBtn));

      const history = st.history.length
        ? h('details', { class: 'revision-history' },
          h('summary', {}, `Riwayat respons (${st.history.length})`),
          h('ol', {}, [...st.history].reverse().map((item) => h('li', {},
            h('strong', { text: item.kind === 'revised' ? 'Revisi disimpan' : 'Posisi sebelum membuka jawaban model' }),
            h('span', { class: 'muted', text: ' · ' + formatDateTime(item.at) }),
            h('p', { text: (item.kind === 'revised' ? item.response.revision : item.response.position).trim() || '(kosong)' })))))
        : null;

      const flags = h('fieldset', { class: 'flags' },
        h('legend', { text: 'Status yang Anda tetapkan sendiri' }),
        h('p', { class: 'response-hint', text: 'Penanda ini adalah penilaian diri Anda — bukan nilai atau hasil asesmen yang terverifikasi.' }),
        FLAGS.map((f) => {
          const btn = h('button', { type: 'button', class: 'btn flag-btn', 'aria-pressed': String(st.flags[f.key]) },
            h('span', { class: 'flag-box', 'aria-hidden': 'true', text: st.flags[f.key] ? '✓' : '' }), f.label, f.note ? h('span', { class: 'muted', text: ` (${f.note})` }) : null);
          btn.addEventListener('click', () => {
            const on = !getUnitState(unit.id).flags[f.key];
            setFlag(unit.id, f.key, on);
            paintRefl();
            reflBody.querySelector(`[data-flag="${f.key}"]`)?.focus();
            announce(`${f.label}: ${on ? 'aktif' : 'nonaktif'}.`);
          });
          btn.dataset.flag = f.key;
          return btn;
        }));

      const notesId = `${idp}-notes`;
      const notesStatus = h('p', { class: 'save-status' });
      const notes = h('textarea', { id: notesId, class: 'response-input', rows: 4 });
      notes.value = st.notes;
      bindAutosave(notes, (v) => setNotes(unit.id, v), notesStatus);
      autoGrow(notes);

      const exportMd = h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => { flushPendingSaves(); downloadText(safeFilename(unit.title + '-catatan', 'md'), buildNotesExport(unit, getUnitState(unit.id), 'md')); announce('Catatan diunduh sebagai Markdown.'); } }, 'Unduh catatan (.md)');
      const exportTxt = h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => { flushPendingSaves(); downloadText(safeFilename(unit.title + '-catatan', 'txt'), buildNotesExport(unit, getUnitState(unit.id), 'txt'), 'text/plain;charset=utf-8'); announce('Catatan diunduh sebagai teks.'); } }, 'Unduh catatan (.txt)');
      const wipe = h('button', { type: 'button', class: 'btn btn-danger-ghost btn-small' }, 'Hapus tulisan saya di unit ini…');
      wipe.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Hapus tulisan untuk unit ini?',
          message: 'Yang akan dihapus dari browser perangkat ini:',
          details: ['seluruh isi Ruang respons', 'revisi posisi dan riwayatnya', 'catatan pribadi'],
          confirmLabel: 'Hapus tulisan',
          danger: true,
        });
        if (!ok) return;
        flushPendingSaves();
        const deleted = clearUnitWriting(unit.id);
        show(unit.id, { panel: 'reflection' });
        announce(deleted.durable ? 'Tulisan unit ini dihapus. Jejak belajar dan penanda bagian tetap ada.' : 'Penghapusan belum tersimpan di perangkat. Data lama mungkin muncul kembali setelah memuat ulang.');
      });

      reflBody.append(compare, history || '', flags,
        h('div', { class: 'response-field' }, h('label', { for: notesId, class: 'response-label', text: 'Catatan pribadi' }), h('p', { class: 'response-hint', text: 'Istilah, pertanyaan lanjutan, kaitan dengan bacaan lain — bebas.' }), notes, notesStatus),
        h('div', { class: 'bookmarks-box' }, h('h3', { class: 'compare-title', text: 'Bagian yang ditandai' }), bookmarkList),
        h('div', { class: 'panel-actions' }, exportMd, exportTxt, wipe));
      paintBookmarks();
    }
    paintRefl();
    paintReveal();

    // All original prose remains mounted in reading order; these are only links.
    function questionLinks(number, currentField) {
      const item = questions.items.find(q=>q.number===number);
      return h('span', {class:'q-crosslinks'}, ['question','answer','explanation'].filter(f=>f!==currentField).map(field=>{
        const label = {question:'Pertanyaan',answer:'Jawaban',explanation:'Pembahasan'}[field] + ` Q${number}`;
        return item?.[field] ? h('a', {href:unitRoute(unit.id,{field,slug:`q-${number}`}),onclick:e=>{e.preventDefault();goTo({field,slug:`q-${number}`});}}, label)
          : h('span', {class:'muted',text:label+' — tidak tersedia'});
      }));
    }
    function decorateQuestions(doc, field) {
      for (const node of doc.element.querySelectorAll('[data-q-number]')) node.after(questionLinks(Number(node.dataset.qNumber),field));
    }
    decorateQuestions(qDoc,'question');
    const qSelect = h('select', {id:`${idp}-question-select`}, questions.items.map(q=>h('option',{value:q.number,text:`Q${q.number} — ${q.question?.title.replace(/^Q\d+[.:]\s*/,'') || 'Lokasi ambigu'}`})));
    const qActions = h('div', {class:'panel-actions'});
    function paintQActions() {
      const n=Number(qSelect.value), row=questions.items.find(q=>q.number===n);
      qActions.replaceChildren(...['question','answer','explanation'].map(field=>h('button', {type:'button',class:'btn btn-secondary btn-small',disabled:!row?.[field],onclick:()=>goTo({field,slug:`q-${n}`})}, `${{question:'Pertanyaan',answer:'Jawaban',explanation:'Pembahasan'}[field]} Q${n}`)));
    }
    qSelect.addEventListener('change',paintQActions);paintQActions();
    const qNav = h('section',{class:'question-navigator','aria-label':'Navigasi pertanyaan'},
      h('label',{for:qSelect.id,class:'response-label',text:`Baca utuh · ${questions.items.length} pertanyaan bernomor`}),
      questions.items.length ? [qSelect,qActions] : h('p',{class:'muted',text:'Tidak ditemukan pola Q yang dapat dipetakan. Seluruh dokumen tetap tersedia.'}),
      questions.issues.length ? h('details',{},h('summary',{},`${questions.issues.length} catatan pemetaan pertanyaan`),h('ul',{},questions.issues.map(text=>h('li',{text})))) : null);
    const quickNav = h('nav',{class:'quick-sections','aria-label':'Bagian utama unit'},
      [['question','Kasus & pertanyaan'],['response','Respons'],['answer','Jawaban model'],['explanation','Pembahasan'],['reflection','Refleksi / catatan']].map(([field,label])=>h('button',{type:'button',class:'btn btn-ghost btn-small',onclick:()=>goTo({field})},label)));

    const preparePrint = () => { flushPendingSaves(); reveal.answer.open({focus:false}); if(unit.explanation.trim()) reveal.explanation.open({focus:false}); };
    quickNav.append(h('button',{type:'button',class:'btn btn-ghost btn-small',onclick:async()=>{preparePrint();await typesetMath(container);if(alive) window.print();}},'Cetak unit lengkap'));
    window.addEventListener('beforeprint',preparePrint);
    teardown.push(()=>window.removeEventListener('beforeprint',preparePrint));

    // ---------- TOC ----------
    const tocNav = h('nav', { class: 'toc', 'aria-label': 'Daftar isi unit' });
    const tocDialogBody = h('div', { class: 'toc-dialog-body' });
    function tocLink(label, targetEl, { level = 1, slug, field, progressOf } = {}) {
      const a = h('a', { href: '#', class: `toc-link toc-l${level}`, dataset: { target: targetEl.id } }, label);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        tocDialog.open && tocDialog.close();
        if (field && slug) goTo({ field, slug });
        else scrollToElement(targetEl.querySelector('h2') || targetEl);
      });
      const li = h('li', {}, a);
      if (progressOf) li.appendChild(h('span', { class: 'toc-progress', dataset: { progressOf }, 'aria-hidden': 'true' }, h('span', { class: 'toc-progress-bar' })));
      return li;
    }
    function buildTocList() {
      tocTargets.length = 0;
      const list = h('ol', { class: 'toc-list' });
      const add = (label, el, opts) => { tocTargets.push(el); list.appendChild(tocLink(label, el, opts)); };
      add('Kasus dan pertanyaan', qPanel);
      const questionList = h('ol', {class:'toc-sublist'});
      for (const s of qDoc.sections.filter(x=>x.title)) { tocTargets.push(s.element); questionList.appendChild(tocLink(s.title,s.element,{level:2,field:'question',slug:s.slug})); }
      list.lastElementChild.appendChild(questionList);
      add('Ruang respons Anda', respPanel);
      for (const [field, panelEl, label] of [['answer', ansPanel, 'Jawaban model'], ['explanation', expPanel, 'Pembahasan']]) {
        const isOpen = reveal[field].isOpen();
        add(isOpen ? label : `${label} (tertutup)`, panelEl, { progressOf: isOpen ? field : null });
        if (isOpen && docs[field]) {
          const sub = h('ol', { class: 'toc-sublist' });
          for (const s of docs[field].sections.filter((x) => x.title)) { tocTargets.push(s.element); sub.appendChild(tocLink(s.title, s.element, { level: 2, field, slug: s.slug })); }
          list.lastElementChild.appendChild(sub);
        }
      }
      add('Refleksi, revisi, dan catatan', reflPanel);
      return list;
    }
    function refreshToc() {
      tocNav.replaceChildren(h('p', { class: 'toc-title', text: 'Di unit ini' }), buildTocList());
      tocDialogBody.replaceChildren(buildTocList());
      onScroll();
    }

    const tocDialog = h('dialog', { class: 'app-dialog toc-dialog', 'aria-label': 'Daftar isi unit' },
      h('div', { class: 'dialog-head' }, h('h2', { class: 'dialog-title', text: 'Daftar isi unit' }), h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => tocDialog.close() }, 'Tutup')),
      tocDialogBody);
    const tocFab = h('button', { type: 'button', class: 'btn btn-primary toc-fab', 'aria-haspopup': 'dialog' }, 'Daftar isi');
    tocFab.addEventListener('click', () => { if (typeof tocDialog.showModal === 'function') tocDialog.showModal(); });

    // ---------- scroll tracking ----------
    let raf = 0;
    let readingTimer = 0;
    let currentReading = null;
    const saveReading = () => { clearTimeout(readingTimer); if(currentReading) setReadingPosition(unit.id,currentReading); };
    window.addEventListener('pagehide',saveReading);
    teardown.push(()=>{saveReading(); window.removeEventListener('pagehide',saveReading);});
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const line = (window.innerHeight || 800) * 0.3;
        let activeEl = null;
        for (const el of tocTargets) {
          if (!el.isConnected || el.closest('[hidden]')) continue;
          if (el.getBoundingClientRect().top <= line) activeEl = el;
        }
        activeEl = activeEl || tocTargets[0];
        const activeSection = [qDoc,...Object.values(docs)].flatMap(d=>d.sections.map(s=>({...s,field:d.field}))).find(s=>s.element===activeEl);
        const panelField = activeEl?.id?.replace(/^panel-/,'');
        if(activeEl) {
          currentReading = {field:activeSection?.field || panelField || 'title',slug:activeSection?.slug || null,title:activeSection?.title || null,
            offset:-activeEl.getBoundingClientRect().top,answer:reveal.answer.isOpen(),explanation:reveal.explanation.isOpen()};
          clearTimeout(readingTimer); readingTimer=setTimeout(saveReading,700);
        }
        [...tocNav.querySelectorAll('.toc-link'), ...tocDialogBody.querySelectorAll('.toc-link')].forEach((a) => {
          if (activeEl && a.dataset.target === activeEl.id) a.setAttribute('aria-current', 'location');
          else a.removeAttribute('aria-current');
        });
        const activeSlug = activeEl?.classList.contains('doc-section') ? Object.values(docs).flatMap((d) => d.sections).find((s) => s.element === activeEl)?.slug : null;
        if (flow) flow.setActive(activeEl?.closest('.doc-answer') ? activeSlug : null);
        // Two-way link for typed philosophy visuals: nodes/steps that declare
        // `section` light up while that section is being read.
        container.querySelectorAll('[data-section-link]').forEach((n) => n.classList.toggle('is-active', Boolean(activeSlug) && n.getAttribute('data-section-link') === activeSlug));
        for (const field of ['answer', 'explanation']) {
          const doc = docs[field];
          if (!doc || !reveal[field].isOpen()) continue;
          const pct = Math.round(doc.progress() * 100);
          reveal[field].progress.value = pct;
          reveal[field].progress.textContent = pct + '%';
          document.querySelectorAll(`[data-progress-of="${field}"] .toc-progress-bar`).forEach((bar) => { bar.style.width = pct + '%'; });
        }
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    teardown.push(() => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf); });
    teardown.push(onProgressChange((id, source) => { if (id === unit.id && source === 'external') { paintJourney(); } }));
    teardown.push(() => Object.values(docs).forEach((d) => d.destroy()));
    teardown.push(() => tocDialog.remove());

    // ---------- mount ----------
    const main = h('article', { class: 'focus-main', 'aria-labelledby': `${idp}-title` }, header, quickNav, qNav, qPanel, respPanel, ansPanel, expPanel, reflPanel, pager('bottom'));
    const aside = h('aside', { class: 'focus-aside' }, tocNav);
    container.append(topbar, h('div', { class: 'focus-grid' }, main, aside), tocFab);
    document.body.appendChild(tocDialog);
    qDoc.mount();
    refreshToc();

    function goTo(t) {
      if (!t) return;
      const field = t.field || t.panel;
      if (['question', 'answer', 'explanation'].includes(field)) {
        if (field !== 'question') reveal[field].open({ focus: false });
        const doc = field === 'question' ? qDoc : docs[field];
        const qMatch = t.slug?.match(/^q-([1-9]\d*)$/);
        const qTarget = qMatch ? doc.element.querySelector(`[data-q-number="${qMatch[1]}"]`) : null;
        const section = doc.sections.find(x => x.slug === t.slug && (!t.title || x.title === t.title));
        if (t.slug && !section && !qTarget) announce('Bagian tujuan tidak ditemukan atau telah berubah. Menampilkan awal dokumen; catatan Anda tetap ada.');
        const fallback = field === 'question' ? qPanel.querySelector('h2') : reveal[field].toggle;
        frame(() => scrollToElement(qTarget || section?.headingEl || section?.element || fallback));
        return;
      }
      const map = { response: respPanel, reflection: reflPanel, title: header };
      const el = map[field];
      if (el) frame(() => scrollToElement(el.querySelector('h1, h2') || el));
    }

    if (resume) {
      if(resume.answer) reveal.answer.open({focus:false});
      if(resume.explanation && unit.explanation.trim()) reveal.explanation.open({focus:false});
      const doc = resume.field === 'question' ? qDoc : docs[resume.field];
      const section = doc?.sections.find(s=>s.slug === resume.slug && (!resume.title || s.title === resume.title));
      const map = {question:qPanel,response:respPanel,answer:ansPanel,explanation:expPanel,reflection:reflPanel,title:header};
      const anchor = section?.element || map[resume.field] || header;
      if(resume.slug && !section) announce('Lokasi baca sebelumnya telah berubah. Menampilkan awal bagian.');
      frame(()=>{window.scrollTo({top:window.scrollY+anchor.getBoundingClientRect().top+(resume.slug && !section ? 0 : resume.offset),behavior:'instant'});(section?.headingEl || anchor).focus({preventScroll:true});});
    } else if (target && target.field !== 'resume') goTo(target);
    else frame(() => { window.scrollTo(0, 0); header.querySelector('h1').focus({ preventScroll: true }); });
  }

  function panel(key, title, num, children, { hint } = {}) {
    const id = `panel-${key}`;
    const node = h('section', { class: `panel panel-${key}`, id, 'aria-labelledby': `${id}-h` },
      h('h2', { class: 'panel-title', id: `${id}-h`, tabindex: '-1' }, h('span', { class: 'panel-num', 'aria-hidden': 'true', text: num }), title),
      children);
    if (hint) node._hint = hint;
    return node;
  }

  return { show, destroy, get current() { return current; } };
}
