// ui/flow-map.js
// ------------------------------------------------------------
// "Alur dialektis jawaban" — a map DERIVED from the model answer's own
// section headings. It adds no philosophical claim: nodes are the
// answer's sections in order, labelled with the argumentative function
// detected from their headings, and the only relations drawn are the
// ones that define those functions (a rebuttal answers the
// counterargument; limitations bound the synthesis).
//
// Interaction is two-way: selecting a node jumps to and focuses that
// section; scrolling the text marks the matching node (aria-current).
// It is an ordered list of buttons, so it is fully keyboard- and
// screen-reader-usable without a separate text alternative.
// ------------------------------------------------------------

import { h } from './dom.js';
import { roleInfo, ROLE_ORDER } from '../content-document.js';

const RELATIONS = {
  rebuttal: { to: 'counter', label: 'menanggapi sanggahan' },
  limitations: { to: 'synthesis', label: 'membatasi sintesis' },
  synthesis: { to: 'position', label: 'menguji ulang posisi awal' },
};

export function createFlowMap(sections, onSelect, idPrefix = 'flow') {
  const captionId = idPrefix + '-flow-caption';
  const titled = sections.filter((s) => s.title);
  const roles = titled.map((s) => s.role).filter(Boolean);
  const coverage = ROLE_ORDER.filter((r) => roles.includes(r));
  const items = new Map();
  const list = h('ol', { class: 'flow-map-list' });
  titled.forEach((s, i) => {
    const info = s.role ? roleInfo(s.role) : null;
    const relation = s.role && RELATIONS[s.role] && roles.includes(RELATIONS[s.role].to) ? RELATIONS[s.role] : null;
    const btn = h('button', { type: 'button', class: 'flow-node' + (s.role ? ' role-' + s.role : ''), dataset: { slug: s.slug } },
      h('span', { class: 'flow-node-step', text: String(i + 1) }),
      h('span', { class: 'flow-node-body' },
        h('span', { class: 'flow-node-role', text: info ? info.label : 'Bagian' }),
        h('span', { class: 'flow-node-title', text: s.title }),
        relation ? h('span', { class: 'flow-node-relation', text: '↺ ' + relation.label }) : null));
    btn.addEventListener('click', () => onSelect(s));
    items.set(s.slug, btn);
    list.appendChild(h('li', { class: 'flow-map-item' }, btn));
  });

  const element = h('figure', { class: 'flow-map', 'aria-labelledby': captionId },
    h('figcaption', { class: 'flow-map-caption', id: captionId },
      h('strong', { text: 'Alur dialektis jawaban model' }),
      h('span', { class: 'muted', text: ` · ${titled.length} bagian dari materi; ${coverage.length} fungsi argumentatif dikenali dari judulnya. Pilih satu bagian untuk melompat ke teksnya.` })),
    list,
    h('p', { class: 'flow-map-note muted', text: 'Peta ini disusun otomatis dari urutan judul bagian jawaban; tidak menambahkan klaim di luar teks.' }));

  return {
    element,
    coverage,
    setActive(slug) {
      for (const [key, btn] of items) {
        if (key === slug) btn.setAttribute('aria-current', 'step');
        else btn.removeAttribute('aria-current');
      }
    },
  };
}
