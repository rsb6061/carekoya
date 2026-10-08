// Profile list fields (certifications, specialties, languages) are stored as comma text, but the legacy
// CareKoya import wrote JSON arrays, and early profile edits mixed the two ('["CPR/First Aid"], CNA').

/** Any of those shapes (or a real array) as a clean, de-duplicated list. */
export function cleanList(value:unknown):string[]{
  const parts:string[]=[];
  if(Array.isArray(value))parts.push(...value.map(String));
  else if(typeof value==='string'){
    const rest=value.replace(/\[[^\]]*\]/g,chunk=>{
      try{const arr=JSON.parse(chunk);if(Array.isArray(arr)){parts.push(...arr.map(String));return ','}}catch{}
      return chunk;
    });
    parts.push(...rest.split(','));
  }
  const seen=new Set<string>(),out:string[]=[];
  for(const raw of parts){
    const item=raw.replace(/^[\s"'[\]]+|[\s"'[\]]+$/g,'').slice(0,80);
    const key=item.toLowerCase();
    if(item&&!seen.has(key)){seen.add(key);out.push(item)}
  }
  return out;
}

export const listText=(value:unknown)=>cleanList(value).join(', ');
