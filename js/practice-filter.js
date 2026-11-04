// practice-filter.js
// ------------------------------------------------------------
// SEARCH + FILTER toolbar for Overview Mode.
//
//   - Search covers title, question, answer, explanation and their
//     headings (js/search-index.js). Matches report their location.
//   - Status filter replaces the old mastery filter and is based on
//     real recorded actions (js/progress-store.js STATUS_FILTERS).
//   - Difficulty filter is shown ONLY when at least one unit has an
//     author-specified difficulty; nothing is ever inferred.
//   - The result count is a small role="status" line. The list itself
//     is NOT a live region, so screen readers are not flooded when
//     results change.
//   - Never mutates units; calls onChange(filtered, results) and the
//     shell re-renders through js/practice-pagination.js.
// ------------------------------------------------------------

import { h } from './ui/dom.js';
import { collectDifficulties, getDifficultyBucket, DIFFICULTY_LABELS } from './practice-meta.js';
import { getUnitState, STATUS_FILTERS } from './progress-store.js';
import { searchIndexAsync } from './search-index.js';

const SEARCH_DEBOUNCE_MS = 160;

export function initPracticeFilter(container, practices, { index, onChange }) {
  const state = { query: '', difficulty: 'all', status: 'all' };
  const difficulties = collectDifficulties(practices);
  container.replaceChildren();
  container.className = 'practice-filter';

  const searchId = 'unitSearch';
  const searchInput = h('input', { type: 'search', id: searchId, class: 'filter-search', placeholder: 'Contoh: sanggahan, Socrates, premis…', autocomplete: 'off', spellcheck: 'false' });
  const clearBtn = h('button', { type: 'button', class: 'btn btn-ghost filter-clear', hidden: true, 'aria-label': 'Hapus kata pencarian' }, 'Hapus');
  const statusSelect = h('select', { class: 'filter-select', id: 'statusFilter' }, STATUS_FILTERS.map((f) => h('option', { value: f.value, text: f.label })));
  const difficultySelect = h('select', { class: 'filter-select', id: 'difficultyFilter' },
    h('option', { value: 'all', text: `Semua tingkat (${practices.length})` }),
    difficulties.buckets.filter((b) => b.count).map((b) => h('option', { value: b.label, text: `${b.display} (${b.count})` })),
    difficulties.unspecified ? h('option', { value: 'unspecified', text: `Tidak ditentukan (${difficulties.unspecified})` }) : null);
  const resetBtn = h('button', { type: 'button', class: 'btn btn-secondary', hidden: true }, 'Atur ulang filter');
  const count = h('p', { class: 'filter-result-count', role: 'status' });

  container.append(
    h('div', { class: 'filter-search-row' },
      h('label', { for: searchId, class: 'filter-label', text: 'Cari di seluruh paket' }),
      h('div', { class: 'filter-search-wrap' }, searchInput, clearBtn),
      h('p', { class: 'filter-help', id: 'searchHelp', text: 'Mencari di judul, pertanyaan, jawaban model, pembahasan, dan judul-judul bagiannya.' })),
    h('div', { class: 'filter-selects' },
      h('div', { class: 'filter-field' }, h('label', { for: 'statusFilter', class: 'filter-label', text: 'Status belajar' }), statusSelect),
      difficulties.anySpecified ? h('div', { class: 'filter-field' }, h('label', { for: 'difficultyFilter', class: 'filter-label', text: 'Tingkat' }), difficultySelect) : null,
      resetBtn),
    count);
  searchInput.setAttribute('aria-describedby', 'searchHelp');

  let generation = 0;
  async function compute() {
    const token = ++generation;
    const query = state.query;
    let results = null;
    if (query.trim()) {
      count.textContent = 'Menyiapkan pencarian seluruh isi…';
      container.setAttribute('aria-busy', 'true');
      try {
        const ready = await (typeof index === 'function' ? index() : index);
        if (token !== generation) return;
        results = await searchIndexAsync(ready, query);
      } catch {
        if (token === generation) { count.textContent = 'Pencarian belum dapat disiapkan. Coba muat ulang; unit tetap dapat dibuka dari daftar.'; container.removeAttribute('aria-busy'); }
        return;
      }
    }
    if (token !== generation) return;
    container.removeAttribute('aria-busy');
    const statusFilter = STATUS_FILTERS.find((f) => f.value === state.status);
    let filtered = practices.filter((p) => {
      if (results && !results.has(p.id)) return false;
      if (state.difficulty !== 'all') {
        const bucket = getDifficultyBucket(p);
        if (state.difficulty === 'unspecified' ? bucket : bucket !== state.difficulty) return false;
      }
      if (statusFilter?.test && !statusFilter.test(getUnitState(p.id))) return false;
      return true;
    });
    if (results) filtered = [...filtered].sort((a, b) => (results.get(b.id).score - results.get(a.id).score) || a.number - b.number);

    const active = Boolean(state.query.trim()) || state.status !== 'all' || state.difficulty !== 'all';
    resetBtn.hidden = !active;
    clearBtn.hidden = !state.query;
    const total = practices.length;
    const parts = [];
    if (state.query.trim()) parts.push(`“${state.query.trim()}”`);
    if (state.status !== 'all') parts.push(statusFilter.label.toLowerCase());
    if (state.difficulty !== 'all') parts.push(state.difficulty === 'unspecified' ? 'tingkat tidak ditentukan' : 'tingkat ' + DIFFICULTY_LABELS[state.difficulty].toLowerCase());
    count.textContent = active
      ? `${filtered.length} dari ${total} unit cocok${parts.length ? ' untuk ' + parts.join(', ') : ''}.`
      : `${total} unit dalam paket ini.`;
    count.classList.toggle('filter-result-count-empty', filtered.length === 0);
    onChange(filtered, results);
  }

  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = searchInput.value; compute(); }, SEARCH_DEBOUNCE_MS);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) { e.preventDefault(); reset({ keepFilters: true }); }
  });
  clearBtn.addEventListener('click', () => { reset({ keepFilters: true }); searchInput.focus(); });
  statusSelect.addEventListener('change', () => { state.status = statusSelect.value; compute(); });
  difficultySelect.addEventListener('change', () => { state.difficulty = difficultySelect.value; compute(); });
  resetBtn.addEventListener('click', () => { reset(); searchInput.focus(); });

  function reset({ keepFilters = false } = {}) {
    clearTimeout(timer);
    state.query = '';
    searchInput.value = '';
    if (!keepFilters) {
      state.status = 'all'; statusSelect.value = 'all';
      state.difficulty = 'all'; difficultySelect.value = 'all';
    }
    compute();
  }

  compute();
  return { refresh: compute, reset, getQuery: () => state.query, setQuery: (q) => { searchInput.value = q; state.query = q; compute(); } };
}
