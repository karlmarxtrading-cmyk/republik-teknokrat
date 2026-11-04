// Shared hash contract for search, TOC, bookmarks and the router.
const fields = new Set(['title','question','answer','explanation','response','reflection','resume']);
export function unitRoute(id, target) {
  const field = target?.field || target?.panel;
  const base = `#unit/${encodeURIComponent(id)}`;
  return field && fields.has(field) ? `${base}/${field}/${encodeURIComponent(target.slug || '')}` : base;
}
export function parseRoute(hash) {
  try {
    const [kind,id,field,slug,...extra] = String(hash).replace(/^#/,'').split('/').map(decodeURIComponent);
    if (kind === 'unit' && id && !extra.length && (!field || fields.has(field)) && (!slug || /^[a-z0-9-]+$/.test(slug)))
      return {view:'focus',unitId:id,target:field ? {field,slug:slug || null} : null};
    return {view:'overview', invalid: !!hash && hash !== '#ikhtisar'};
  } catch { return {view:'overview',invalid:true}; }
}
