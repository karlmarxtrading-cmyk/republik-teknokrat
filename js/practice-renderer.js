// practice-renderer.js
// ------------------------------------------------------------
// PRESENTATION of the unit list in Overview Mode.
//
//   - renderPractices(container, units, options) / appendPracticeCards()
//     keep their names and roles from the previous version: the first
//     clears and paints one page (with an empty state), the second
//     appends a further page for "Muat lebih banyak". Only
//     js/practice-pagination.js calls them.
//   - A card shows the unit's number, title, honest status, a question
//     excerpt, and — while searching — where each match was found
//     ("Pembahasan → 5. Evaluasi …") with a safely built <mark>.
//   - Opening a unit is delegated to options.onOpen(unitId, target).
//   - Cards are cheap: no Markdown rendering or MathJax happens here.
// ------------------------------------------------------------

import { unitRoute } from './routes.js';
import { h, clear } from './ui/dom.js';
import { getUnitState, statusLabel, stepsOf, STEPS } from './progress-store.js';
import { outlineOf } from './content-document.js';
import { getDifficultyBucket, DIFFICULTY_LABELS } from './practice-meta.js';

let renderContext = { onOpen: () => {}, results: null, total: 0 };
export function setRenderContext(ctx) {
  renderContext = { ...renderContext, ...ctx };
}

function excerpt(unit, max = 240) {
  const sections = outlineOf(unit.question);
  const context = sections.find(s => /kasus.*pertanyaan|^kasus$|^situasi/i.test(s.title || ''));
  const text = (context?.plainText || sections.map(s=>s.plainText).join(' ')).replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, text.lastIndexOf(' ', max)) + ' …' : text;
}

function highlighted(snippet) {
  return h('span', { class: 'hit-snippet' }, snippet.before, h('mark', { text: snippet.match }), snippet.after);
}

function stepDots(state) {
  const steps = stepsOf(state);
  const done = STEPS.filter((s) => steps[s.key]).length;
  return h('span', { class: 'step-dots', title: `${done} dari ${STEPS.length} langkah belajar tercatat` },
    h('span', { class: 'sr-only', text: `${done} dari ${STEPS.length} langkah belajar tercatat.` }),
    ...STEPS.map((s) => h('span', { class: 'step-dot' + (steps[s.key] ? ' is-done' : ''), 'aria-hidden': 'true' })));
}

function buildCard(unit) {
  const state = getUnitState(unit.id);
  const headingId = `card-${unit.id}-h`;
  const result = renderContext.results ? renderContext.results.get(unit.id) : null;
  const bucket = getDifficultyBucket(unit);
  const open = (target) => renderContext.onOpen(unit.id, target);

  const card = h('article', { class: 'unit-card', 'aria-labelledby': headingId, dataset: { unitCard: '', id: unit.id, number: String(unit.number) } },
    h('div', { class: 'unit-card-meta' },
      h('span', { class: 'unit-number', text: `Unit ${unit.number}` }),
      bucket ? h('span', { class: 'badge badge-muted', text: `Tingkat: ${DIFFICULTY_LABELS[bucket]}` }) : null,
      h('span', { class: 'unit-status', dataset: { status: statusLabel(state) } }, stepDots(state), statusLabel(state))),
    h('h3', { class: 'unit-card-title', id: headingId },
      h('a', { href: unitRoute(unit.id), class: 'unit-card-link', text: unit.displayTitle ?? unit.title, onclick: (e) => { e.preventDefault(); open(null); } })),
    h('p', { class: 'unit-excerpt', text: excerpt(unit) }));

  if (result && result.hits.length) {
    const shown = result.hits.slice(0, 5);
    const list = h('ul', { class: 'hit-list', 'aria-label': `Lokasi kecocokan di unit ${unit.number}` },
      shown.map((hit) => h('li', {},
        h('a', {
          href: unitRoute(unit.id, hit),
          class: 'hit-location',
          onclick: (e) => { e.preventDefault(); open({ field: hit.field, slug: hit.slug }); },
        }, h('span', { class: 'hit-where', text: hit.location })),
        highlighted(hit.snippet))));
    card.appendChild(list);
    if (result.hits.length > shown.length) {
      const more = h('details', {class:'more-hits'}, h('summary', {}, `Tampilkan ${result.hits.length-shown.length} lokasi lainnya`));
      let built = false;
      more.addEventListener('toggle', () => {
        if (!more.open || built) return;
        built = true;
        more.appendChild(h('ul', {class:'hit-list'}, result.hits.slice(5).map(hit => h('li', {},
          h('a', {href:unitRoute(unit.id,hit),class:'hit-location',onclick:e=>{e.preventDefault();open(hit);}},h('span',{class:'hit-where',text:hit.location})), highlighted(hit.snippet)))));
      });
      card.appendChild(more);
    }
  }

  card.appendChild(h('div', { class: 'unit-card-actions' },
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => open(state.opened ? {field:'resume'} : null) }, state.opened ? 'Lanjutkan unit' : 'Mulai unit'),
    h('span', { class: 'muted', text: `${outlineOf(unit.answer).length} bagian jawaban · ${outlineOf(unit.explanation).length} bagian pembahasan` })));
  return card;
}

export function renderPractices(container, units, options = {}) {
  clear(container);
  if (!units.length) {
    const empty = h('div', { class: 'empty-state' }, h('p', { text: options.emptyMessage || 'Belum ada unit latihan di paket ini.' }));
    if (options.onEmptyAction && options.emptyActionLabel) {
      empty.appendChild(h('button', { type: 'button', class: 'btn btn-secondary', onclick: options.onEmptyAction, text: options.emptyActionLabel }));
    }
    container.appendChild(empty);
    return;
  }
  appendPracticeCards(container, units);
}

export function appendPracticeCards(container, units) {
  const fragment = document.createDocumentFragment();
  for (const unit of units) fragment.appendChild(buildCard(unit));
  container.appendChild(fragment);
}

export { excerpt as unitExcerpt };
