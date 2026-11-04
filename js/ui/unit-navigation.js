import { h } from './dom.js';
import { normalizeQuery } from '../search-index.js';
import { unitRoute } from '../routes.js';
export function createUnitPager(practices, unit, onOpenUnit, onPick, position) {
  const index = practices.indexOf(unit);
  const direction = (offset, label) => {
    const target = practices[index + offset];
    return h('button', {type:'button',class:'btn btn-secondary',disabled:!target,
      title:target ? `Unit ${target.number}: ${target.displayTitle ?? target.title}` : label,
      dataset:{direction:offset < 0 ? 'previous':'next', target:target?.id || ''},
      onclick:()=>target && onOpenUnit(target.id)},label);
  };
  return h('nav',{class:`unit-pager unit-pager-${position}`,'aria-label':`Navigasi unit ${position === 'bottom' ? 'bawah' : 'atas'}`},
    h('p',{class:'focus-position',text:`Urutan ${index+1} dari ${practices.length} · Unit ${unit.number}`}),
    h('div',{class:'focus-pager'},direction(-1,'‹ Sebelumnya'),
      h('button',{type:'button',class:'btn btn-ghost',onclick:onPick,'aria-haspopup':'dialog'},'Daftar unit'),direction(1,'Berikutnya ›')));
}
export function createUnitPicker(practices, currentId, onOpenUnit) {
  let trigger;
  const input = h('input',{type:'search',class:'filter-search',id:'unitPickerSearch',placeholder:'Nomor atau judul unit',autocomplete:'off'});
  const list = h('ol',{class:'unit-picker-list'});
  const count = h('p',{role:'status',class:'muted'});
  const more = h('button',{type:'button',class:'btn btn-secondary'},'Tampilkan unit berikutnya');
  let limit = 40;
  function paint(){
    const terms = normalizeQuery(input.value).split(' ').filter(Boolean);
    const matches = practices.filter(p=>terms.every(t=>normalizeQuery(`${p.number} ${p.displayTitle ?? p.title}`).includes(t)));
    count.textContent = `${matches.length} unit cocok. ${Math.min(limit,matches.length)} ditampilkan.`;
    list.replaceChildren(...matches.slice(0,limit).map(p=>h('li',{},h('a',{href:unitRoute(p.id),'aria-current':p.id===currentId?'page':null,
      onclick:e=>{e.preventDefault();dialog.close();onOpenUnit(p.id);}},`Unit ${p.number} — ${p.displayTitle ?? p.title}`))));
    more.hidden = matches.length <= limit;
  }
  more.addEventListener('click',()=>{limit+=40;paint();});
  input.addEventListener('input',()=>{limit=40;paint();});
  const dialog=h('dialog',{class:'app-dialog unit-picker','aria-labelledby':'unitPickerTitle'},
    h('div',{class:'dialog-head'},h('h2',{id:'unitPickerTitle',class:'dialog-title',text:'Daftar unit'}),h('button',{type:'button',class:'btn btn-ghost',onclick:()=>dialog.close()},'Tutup')),
    h('label',{for:'unitPickerSearch',class:'filter-label',text:'Cari nomor atau judul unit'}),input,count,list,more);
  dialog.addEventListener('close',()=>{if(trigger?.isConnected) trigger.focus({preventScroll:true});});
  return {element:dialog,open(){trigger=document.activeElement;input.value='';limit=40;paint();dialog.showModal();input.focus();},destroy(){dialog.remove();}};
}
