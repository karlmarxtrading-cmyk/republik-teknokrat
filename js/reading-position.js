import { readJSON, writeJSON } from './storage.js';
import { NS } from './progress-store.js';
const fields = new Set(['question','response','answer','explanation','reflection','title']);
export function getReadingPosition(id) {
  const p=readJSON(`${NS}reading:${id}`);
  if (!p || !fields.has(p.field) || !Number.isFinite(p.offset)) return null;
  return {field:p.field,slug:typeof p.slug==='string' && /^[a-z0-9-]+$/.test(p.slug) ? p.slug : null,
    title:typeof p.title==='string' ? p.title : null, offset:Math.max(-1000000,Math.min(1000000,p.offset)),
    answer:p.answer===true,explanation:p.explanation===true};
}
export function setReadingPosition(id, position) { return writeJSON(`${NS}reading:${id}`,position); }
