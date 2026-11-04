// ui/overview-view.js
// ------------------------------------------------------------
// OVERVIEW MODE — the package at a glance: identity, honest learning
// orientation, real progress, full-content search, status filter and
// the paginated unit list. Reads the same unit objects as Focus Mode;
// nothing is copied or transformed when switching modes.
// ------------------------------------------------------------

import { h, clear } from './dom.js';
import { initPracticeFilter } from '../practice-filter.js';
import { initPracticePagination } from '../practice-pagination.js';
import { setRenderContext } from '../practice-renderer.js';
import { getUnitState, hasActivity, getPrefs } from '../progress-store.js';
import { ROLES, ROLE_ORDER } from '../content-document.js';
import { readingMinutes } from './focus-view.js';

export function createOverviewView(container, { practices, manifest, index, onOpenUnit }) {
  const progressLine = h('p', { class: 'hero-progress' });
  const continueBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large' });
  const totalMinutes = practices.reduce((n, p) => n + readingMinutes(p.question) + readingMinutes(p.answer) + readingMinutes(p.explanation), 0);

  const hero = h('header', { class: 'package-hero' },
    h('p', { class: 'eyebrow', text: `${manifest.brand} · Ruang Latihan ${manifest.workspace}` }),
    h('h1', { class: 'package-title', id: 'packageTitle', tabindex: '-1', text: manifest.name }),
    h('p', { class: 'package-lede', text: manifest.description }),
    h('ul', { class: 'package-facts' },
      h('li', {}, h('strong', { text: String(practices.length) }), ` unit latihan argumentasi`),
      h('li', {}, h('strong', { text: `± ${totalMinutes} menit` }), ' membaca materi', h('span', { class: 'muted', text: ' (seluruh paket; dapat dibaca bertahap, belum termasuk waktu menulis)' })),
      h('li', {}, 'Bahasa: Indonesia')),
    progressLine,
    h('div', { class: 'hero-actions' }, continueBtn));

  const method = h('section', { class: 'orientation', 'aria-labelledby': 'orientationTitle' },
    h('h2', { id: 'orientationTitle', class: 'section-title', text: 'Cara belajar di paket ini' }),
    h('ol', { class: 'method-steps' },
      [['Baca kasusnya', 'Pahami situasi dan pertanyaan terbukanya. Tidak ada jawaban pilihan ganda.'],
        ['Tulis posisi Anda', 'Nyatakan posisi, alasan, bukti, sanggahan terkuat, dan tanggapan Anda — sebagian pun boleh.'],
        ['Bandingkan dengan jawaban model', 'Jawaban model mengikuti bagian yang terdapat dalam materi; gunakan daftar bagiannya untuk menavigasi.'],
        ['Perdalam lewat pembahasan', 'Konsep, tradisi pemikiran, evaluasi premis, kekeliruan penalaran, latihan, dan referensi.'],
        ['Revisi dan catat', 'Simpan revisi posisi Anda, tandai bagian penting, dan unduh catatan bila perlu.']]
        .map(([t, d]) => h('li', {}, h('strong', { text: t }), h('span', { text: d })))),
    h('h3', { class: 'subsection-title', text: 'Kompetensi berpikir yang dilatih' }),
    h('ul', { class: 'competency-list' }, ROLE_ORDER.map((r) => {
      const info = ROLES.find((x) => x.role === r);
      return h('li', { class: 'role-pill role-' + r }, h('span', { text: info.label }), h('span', { class: 'muted', lang: 'en', text: info.en }));
    })));

  const filterEl = h('div', { id: 'practiceFilter' });
  const grid = h('div', { id: 'practiceGrid', class: 'unit-list' });
  const loadMore = h('div', { id: 'practiceLoadMore', hidden: true });
  const listSection = h('section', { class: 'unit-section', 'aria-labelledby': 'unitListTitle' },
    h('h2', { id: 'unitListTitle', class: 'section-title', text: 'Unit dalam paket' }), filterEl, grid, loadMore);

  const orientation = h('details', {class:'orientation-disclosure'}, h('summary',{},'Cara belajar dan kompetensi yang dilatih'), method);
  container.append(hero, orientation, listSection);
  hero.querySelector('.hero-actions').append(h('button', {type:'button',class:'btn btn-secondary',onclick:()=>{filterEl.scrollIntoView({block:'start'});filterEl.querySelector('input').focus({preventScroll:true});}}, 'Cari / daftar unit'));
  hero.after(filterEl); 

  const pagination = initPracticePagination(grid, loadMore, { pageSize: 60 });
  let filter = null;
  function renderList(filtered, results) {
    setRenderContext({ onOpen: onOpenUnit, results });
    pagination.setList(filtered, {
      emptyMessage: practices.length ? 'Tidak ada unit yang cocok dengan pencarian atau filter ini.' : 'Belum ada unit latihan di paket ini.',
      emptyActionLabel: practices.length ? 'Atur ulang pencarian dan filter' : null,
      onEmptyAction: practices.length ? () => filter.reset() : null,
    });
  }
  filter = initPracticeFilter(filterEl, practices, { index, onChange: renderList });

  function paintProgress() {
    const states = practices.map((p) => getUnitState(p.id));
    const active = states.filter(hasActivity).length;
    const done = states.filter((s) => s.flags.done).length;
    const revised = states.filter((s) => s.revisedAt).length;
    clear(progressLine);
    progressLine.append(
      h('span', { class: 'sr-only', text: 'Progres di perangkat ini: ' }),
      active ? `${active} dari ${practices.length} unit sudah Anda pelajari` : 'Belum ada aktivitas tercatat di perangkat ini',
      active ? ` · ${revised} dengan revisi posisi · ${done} ditandai selesai untuk sekarang.` : '.');
    const prefs = getPrefs();
    const last = practices.find((p) => p.id === prefs.lastUnit && getUnitState(p.id).opened);
    continueBtn.textContent = last ? `Lanjutkan: Unit ${last.number}` : practices.length ? `Mulai Unit ${practices[0].number}` : 'Belum ada unit';
    continueBtn.onclick = () => onOpenUnit((last || practices[0]).id,last ? {field:'resume'} : null);
    continueBtn.disabled = !practices.length;
  }

  return {
    show() { paintProgress(); filter.refresh(); },
    refresh() { paintProgress(); filter.refresh(); },
    focusTitle() { hero.querySelector('h1').focus({ preventScroll: true }); },
    filter,
  };
}
