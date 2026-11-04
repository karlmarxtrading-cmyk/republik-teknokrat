// Derive numbered Q locations from real top-level Markdown blocks.
// Fences, tables, quotes, lists and incidental references never create targets.
import { parseDocument, titleText } from './content-document.js';
export function questionTargets(source) {
  const tokens = parseDocument(source).tokens;
  const targets = [];
  for (let i=0;i<tokens.length;i++) {
    const t=tokens[i];
    if (t.level !== 0 || !['heading_open','paragraph_open'].includes(t.type) || tokens[i+1]?.type !== 'inline') continue;
    const title = titleText(tokens[i+1].content).trim();
    const pattern = t.type === 'heading_open' ? /^(?:(?:Jawaban|Penjelasan|Pembahasan)\s+)?Q([1-9]\d*)(?=[\s.:—–-]|$)/i : /^Q([1-9]\d*)[.:]\s+/i;
    const m = title.match(pattern);
    if (m) targets.push({number:Number(m[1]),tokenIndex:i,title,slug:`q-${Number(m[1])}`});
  }
  const counts = new Map();
  targets.forEach(t=>counts.set(t.number,(counts.get(t.number)||0)+1));
  return targets.map(t=>({...t,ambiguous:counts.get(t.number)>1}));
}
export function questionIndex(unit) {
  const fields=Object.fromEntries(['question','answer','explanation'].map(field=>[field,questionTargets(unit[field] || '')]));
  const numbers=[...new Set(fields.question.map(t=>t.number))];
  const issues=[];
  const items=numbers.map(number=>{
    const row={number};
    for (const field of Object.keys(fields)) {
      const found=fields[field].filter(t=>t.number===number);
      row[field]=found.length===1 ? found[0] : null;
      if(found.length!==1) issues.push(`Q${number}: ${field} ${found.length ? 'ambigu (nomor berulang)' : 'tidak ditemukan'}`);
    }
    return row;
  });
  for (const field of ['answer','explanation']) for(const t of fields[field]) if(!numbers.includes(t.number)) issues.push(`${field} Q${t.number}: pertanyaan sumber tidak ditemukan`);
  return {items,issues};
}
