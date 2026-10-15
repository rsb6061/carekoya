import { lazy, type ComponentType } from 'react';

// A page's own JS/CSS file failed to load: a dropped connection, or an old tab asking for a file a deploy replaced.
// Reload once (keeping the loading state meanwhile) instead of a blank page; a second failure within a minute is a
// real crash and reaches React's error reporting. Use named() for every lazy-loaded component, not React's lazy().
function reloadOnce(error:unknown):never|Promise<never>{
  try{
    if(Date.now()-Number(sessionStorage.getItem('cj_chunk_reload')||0)<60000)throw error;
    sessionStorage.setItem('cj_chunk_reload',String(Date.now()));
  }catch{throw error}
  window.location.reload();
  return new Promise<never>(()=>{});
}
export const named=<K extends string>(load:()=>Promise<Record<K,ComponentType<any>>>,name:K)=>lazy(()=>load().then(m=>({default:m[name]}),reloadOnce));
