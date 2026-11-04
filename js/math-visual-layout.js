// Measured label placement and accessible, wrapping HTML companions.
// Geometry is immutable: only annotation positions change. No external dependencies.
const NS = 'http://www.w3.org/2000/svg';
function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function details(figure) {const d=el('div',null,'math-visual-details'); figure.append(d); return d;}
function keyList(parent, entries) {
  if (!entries?.length) return;
  const list=el('ul');
  for (const entry of entries) {
    const item=el('li',null,'math-visual-key');
    const label=el('strong',entry.label);
    if(entry.color){const swatch=el('span',null,'math-series-swatch');swatch.setAttribute('aria-hidden','true');swatch.style.borderColor=entry.color;swatch.style.borderTopStyle=list.children.length%2?'dashed':'solid';label.prepend(swatch);}
    item.append(label,el('span',entry.text));list.append(item);
  }
  parent.append(list);
}
export function appendVisualDetails(figure, svg, visual, where) {
  if (where === 'before') {
    if (svg._setEntries) {
      const d=details(figure);
      const heading=el('p'); heading.append(el('strong',svg._universe));
      if (svg._total != null) heading.append(document.createTextNode(' · Total = '+svg._total));
      d.append(heading);keyList(d,svg._setEntries);
    }
    if (svg._mappingEntries?.length) keyList(details(figure),svg._mappingEntries);
    if (svg._axisEntries?.length) keyList(details(figure),svg._axisEntries);
    return;
  }
  if (svg._legendEntries?.length) keyList(details(figure),svg._legendEntries);
  if (svg._membership) {
    const d=details(figure);
    d.append(el('p','The outlines are schematic. The table gives exact membership (✓ means belongs; — means does not belong).'));
    const wrap=el('div',null,'math-membership-scroll');wrap.tabIndex=0;wrap.setAttribute('aria-label','Exact set membership');
    const table=el('table'),head=el('thead'),row=el('tr');
    for(const h of ['Element',...svg._setEntries.map(e=>e.label),'Selected']){const th=el('th',h);th.scope='col';row.append(th)}head.append(row);table.append(head);
    const body=el('tbody');
    const shade=svg._shade;const op=typeof shade==='string'?shade.toLowerCase():String(shade?.op||'').toLowerCase();
    const ids=typeof shade==='object'&&Array.isArray(shade?.sets)?shade.sets.map(String):visual.data.sets.map((s,i)=>String(s.id??i));
    const selected=visual.data.sets.map((s,i)=>ids.includes(String(s.id??i))?i:-1).filter(i=>i>=0);
    for(const entry of svg._membership){const tr=el('tr'),th=el('th',entry.text);th.scope='row';tr.append(th);
      for(let i=0;i<svg._setEntries.length;i++)tr.append(el('td',entry.sets.includes(i)?'✓':'—'));
      let match=false;
      if(op==='union')match=selected.some(i=>entry.sets.includes(i));
      else if(op==='intersection')match=selected.every(i=>entry.sets.includes(i));
      else if(op==='complement')match=selected.every(i=>!entry.sets.includes(i));
      else match=visual.data.sets.some((s,i)=>String(s.id??i).toLowerCase()===op&&entry.sets.includes(i));
      tr.append(el('td',op?(match?'✓':'—'):'Not requested'));body.append(tr);
    }
    table.append(body);wrap.append(table);d.append(wrap);
    if(op==='complement')d.append(el('p','The shaded complement also includes any unlisted elements of the universe outside the selected sets.'));
  }
}
const overlap=(a,b,pad=4)=>a.x < b.x+b.width+pad && a.x+a.width+pad>b.x && a.y<b.y+b.height+pad && a.y+a.height+pad>b.y;
// Real SVG text metrics; uses a temporary off-screen host once, not a resize loop.
// CSS keeps intrinsic font sizes constant across viewports, so zoom scales the
// solved layout uniformly. No observers/listeners accumulate on discarded cards.
export function prepareVisualLayout(figure, svg) {
  if (typeof svg.getBBox !== 'function' || !document.body) return; // jsdom has no layout engine
  const host=el('div');host.style.cssText='position:fixed;left:-20000px;top:0;width:1000px;visibility:hidden;pointer-events:none';
  document.body.append(host);host.append(figure);
  try {
    const counts=[...svg.querySelectorAll('.math-venn-count')];
    if(counts.length){
      const factor=Math.max(1,...counts.map(t=>t.getBBox().width/100));
      if(factor>1){
        const old=svg.viewBox.baseVal;
        for(const e of svg.querySelectorAll('*'))for(const attr of ['x','x1','x2','cx','rx','width']){
          if(e.hasAttribute(attr) && Number.isFinite(Number(e.getAttribute(attr))))e.setAttribute(attr,Number(e.getAttribute(attr))*factor);
        }
        svg.setAttribute('viewBox',`0 0 ${old.width*factor} ${old.height}`);
        svg._minWidth=280*factor;
      }
    }
    const vb=svg.viewBox.baseVal, w=vb.width,h=vb.height;
    const movable=[...svg.querySelectorAll('.math-svg-point-label,.math-svg-measurement,.math-svg-arrow-label,.math-svg-category-label')];
    // Category labels stay at the category x coordinate if they fit; otherwise
    // a short key links the exact label to an HTML legend.
    const fixed=[...svg.querySelectorAll('text')].filter(t=>!movable.includes(t));
    const occupied=fixed.map(t=>t.getBBox());
    const obstacles=[];
    for(const path of svg.querySelectorAll('.math-plot-curve,.math-chart-line')){
      const length=path.getTotalLength();
      for(let d=0;d<=length;d+=8){const p=path.getPointAtLength(d);obstacles.push({x:p.x-2,y:p.y-2,width:4,height:4});}
    }
    for(const point of svg.querySelectorAll('.math-plot-point,.math-geometry-point,.math-chart-point')){
      obstacles.push({x:Number(point.getAttribute('cx'))-5,y:Number(point.getAttribute('cy'))-5,width:10,height:10});
    }
    const entries=[];
    for(const t of movable){
      const text=t.textContent, x=Number(t.getAttribute('x')), y=Number(t.getAttribute('y'));
      const anchorX=Number(t.dataset.anchorX??x), anchorY=Number(t.dataset.anchorY??(y+8));
      const oldAnchor=t.getAttribute('text-anchor')||'middle';
      const category=t.classList.contains('math-svg-category-label');
      const tryPositions=(short=false)=>{
        const candidates=[[x,y,oldAnchor]];
        if(!category) for(const dy of [-16,24,-40,48,-64,72,-88,96])for(const dx of [10,-10,0,40,-40])candidates.push([anchorX+dx,anchorY+dy,dx>0?'start':dx<0?'end':'middle']);
        for(const [nx,ny,anchor] of candidates){t.setAttribute('x',nx);t.setAttribute('y',ny);t.setAttribute('text-anchor',anchor);const box=t.getBBox();
          if(box.x<8||box.y<8||box.x+box.width>w-8||box.y+box.height>h-8||occupied.some(o=>overlap(box,o))||obstacles.some(o=>overlap(box,o,2)))continue;
          occupied.push(box);
          if(!category && (Math.abs(nx-x)>4||Math.abs(ny-y)>4)){
            const line=document.createElementNS(NS,'line');line.setAttribute('class','math-label-leader');
            for(const [k,v] of Object.entries({x1:anchorX,y1:anchorY,x2:Math.max(box.x,Math.min(anchorX,box.x+box.width)),y2:Math.max(box.y,Math.min(anchorY,box.y+box.height))}))line.setAttribute(k,v);
            t.before(line);
          }
          return true;
        }
        return false;
      };
      if(t.getBBox().width<=240 && tryPositions())continue;
      const marker='['+(entries.length+1)+']';
      entries.push({label:marker,text});t.textContent=marker;
      if(!tryPositions(true)){
        // A dense plot uses a dedicated annotation rail. A leader preserves the
        // anchor relationship rather than dropping the annotation.
        let ny=h+24;
        for(const old of entries.slice(0,-1))ny+=24;
        t.setAttribute('x',24);t.setAttribute('y',ny);t.setAttribute('text-anchor','start');
        svg.setAttribute('viewBox',`0 0 ${w} ${ny+16}`);svg.setAttribute('height',ny+16);
        const line=document.createElementNS(NS,'line');line.setAttribute('class','math-label-leader');
        for(const [k,v] of Object.entries({x1:anchorX,y1:anchorY,x2:24,y2:ny-8}))line.setAttribute(k,v);t.before(line);
      }
    }
    if(entries.length)keyList(details(figure),entries);
    figure.dataset.layoutChecked='true';
  } finally {figure.remove();host.remove();}
}
