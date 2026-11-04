// practice-mastery.js
// ------------------------------------------------------------
// COMPATIBILITY ADAPTER for the former "✓ Mastered" feature.
//
// The previous version stored a bare self-report flag under
// `practice-mastery:<id>`. In FILSAFAT - 1 that capability is kept but
// named honestly: it is the self-assessment "Saya merasa memahami",
// one of several real learning steps recorded by js/progress-store.js.
//
// The exported functions keep their old names so any caller (tests,
// console tooling) still works:
//   migrateLegacyMastery(units)  -> progress-store migrateLegacyProgress
//   getMasteredIds(units?)       -> ids whose self-assessment is set
//   isMastered(id)
//   initPracticeMastery(container) attaches a self-assessment toggle to
//     every element with [data-unit-card][data-id] (idempotent, one
//     MutationObserver per container — same contract as before).
// Note: older comments claimed duplicates were "collapsed to one
// card"; the engine keeps every duplicate as its own unit.
// ------------------------------------------------------------

import { getUnitState, setFlag, migrateLegacyProgress, NS } from './progress-store.js';
import { keys as storageKeys } from './storage.js';

export function migrateLegacyMastery(units = []) {
  return migrateLegacyProgress(units);
}

export function isMastered(id) {
  return getUnitState(id).flags.understood === true;
}

export function getMasteredIds(units) {
  const ids = units ? units.map((u) => u.id) : storageKeys().filter((k) => k && k.startsWith(NS + 'unit:')).map((k) => k.slice((NS + 'unit:').length));
  return new Set(ids.filter(isMastered));
}

const observed = new WeakSet();
function attach(card) {
  if (!card || card.nodeType !== 1 || !card.dataset.id || card.querySelector(':scope > .practice-mastery')) return;
  const wrap = document.createElement('div');
  wrap.className = 'practice-actions practice-mastery';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-small';
  const paint = () => {
    const on = isMastered(card.dataset.id);
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('btn-primary', on);
    btn.classList.toggle('btn-secondary', !on);
    btn.textContent = on ? '✓ Saya merasa memahami' : 'Tandai: saya merasa memahami';
  };
  paint();
  btn.addEventListener('click', () => {
    setFlag(card.dataset.id, 'understood', !isMastered(card.dataset.id));
    paint();
    window.dispatchEvent(new CustomEvent('dynanca:mastery-change'));
  });
  wrap.appendChild(btn);
  card.appendChild(wrap);
}

export function initPracticeMastery(container) {
  if (!container) return;
  container.querySelectorAll('[data-unit-card][data-id]').forEach(attach);
  if (observed.has(container)) return;
  observed.add(container);
  new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.matches?.('[data-unit-card][data-id]')) attach(n);
      n.querySelectorAll?.('[data-unit-card][data-id]').forEach(attach);
    });
  }).observe(container, { childList: true, subtree: true });
}
