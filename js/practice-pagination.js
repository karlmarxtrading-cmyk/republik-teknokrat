// practice-pagination.js
// ------------------------------------------------------------
// SCALABLE RENDERING for the FILSAFAT - 1 unit list (Overview Mode).
//   One package may hold many units; this module windows how many
//   unit cards are mounted at once. Unchanged contract otherwise.
//
//   - practice-renderer.js can build any number of cards, but
//     mounting thousands of them into the DOM in one paint (e.g.
//     the full result of a filter over a 10,000-question dataset)
//     is unnecessarily heavy and can make the page feel slow, even
//     though every one of those questions is genuinely available.
//   - This module is the ONLY place that decides how many of a
//     filtered list's cards are actually in the DOM at once. It
//     never changes WHICH questions match a filter and never
//     changes their order — search, difficulty, and status
//     filtering (js/practice-filter.js) already run over the
//     complete in-memory dataset before this module ever sees the
//     result; this only windows how much of that already-final
//     result gets painted.
//   - setList() is called once per filter change (a brand-new
//     result set) and renders exactly the first page via
//     renderPractices() — same empty-state handling as before,
//     completely unchanged. Clicking "Load more" appends the next
//     page via appendPracticeCards() (no full re-render, so
//     growing to thousands of mounted cards over several clicks
//     stays cheap: each click only builds the NEW cards).
//   - The visible "Load more" button is presentation-only sugar
//     around this window; the result COUNT the learner sees
//     ("Showing N of M questions", js/practice-filter.js) always
//     reflects the complete filtered dataset, never just what's
//     currently mounted — this module never touches that count.
//   - Status lines are painted by practice-renderer.js from the
//     progress store when each card is built, so appended pages are
//     always current without extra wiring.
// ------------------------------------------------------------

import { renderPractices, appendPracticeCards } from './practice-renderer.js';

const DEFAULT_PAGE_SIZE = 60;

/**
 * Wires up progressive rendering for `grid` (the practice card
 * container) with a "Load more" control rendered inside
 * `loadMoreContainer` (an otherwise-empty element placed right
 * after the grid in the DOM — see index.html's #practiceLoadMore).
 *
 * Returns `{ setList(list, renderOptions) }`. Call setList() every
 * time the filtered result changes (i.e. from
 * practice-filter.js's onFilterChange callback) with the COMPLETE
 * filtered array — not a slice — and this module takes care of
 * only mounting the first page and exposing the rest behind
 * "Load more". `renderOptions` is forwarded verbatim to
 * renderPractices() for the first page (emptyMessage,
 * emptyActionLabel, onEmptyAction), so empty/no-results states work
 * exactly as before.
 */
export function initPracticePagination(grid, loadMoreContainer, options = {}) {
  const pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0
    ? options.pageSize
    : DEFAULT_PAGE_SIZE;

  let currentList = [];
  let shown = 0;

  loadMoreContainer.innerHTML = '';
  loadMoreContainer.className = 'load-more-wrap';
  loadMoreContainer.hidden = true;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary load-more-btn';
  loadMoreContainer.appendChild(button);

  button.addEventListener('click', () => {
    const next = currentList.slice(shown, shown + pageSize);
    if (!next.length) return;
    const firstNew = grid.children.length;
    appendPracticeCards(grid, next);
    shown += next.length;
    syncButton();
    // Keyboard users continue from the first newly added unit.
    grid.children[firstNew]?.querySelector('a, button')?.focus();
  });

  function syncButton() {
    const remaining = currentList.length - shown;
    if (remaining <= 0) {
      loadMoreContainer.hidden = true;
      return;
    }
    loadMoreContainer.hidden = false;
    const nextBatch = Math.min(pageSize, remaining);
    button.textContent = `Muat ${nextBatch} unit lagi (${remaining} tersisa)`;
  }

  /**
   * Resets pagination for a brand-new filtered list: mounts just
   * the first page (renderPractices() handles the empty-state case
   * when `list` is empty, exactly as it always has) and shows/hides
   * "Load more" for the rest.
   */
  function setList(list, renderOptions = {}) {
    const nextList = Array.isArray(list) ? list : [];
    const same = nextList.length === currentList.length && nextList.every((p,i)=>p.id === currentList[i].id);
    currentList = nextList;
    shown = Math.min(same ? Math.max(pageSize, shown) : pageSize, currentList.length);
    renderPractices(grid, currentList.slice(0, shown), renderOptions);
    syncButton();
  }

  return { setList, get shown() { return shown; }, get pageSize() { return pageSize; } };
}
