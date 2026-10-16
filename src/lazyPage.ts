import { lazy, type ComponentType } from 'react';
import { automatedBrowser } from './errorReporter';

/** Reloads the page unless it already did within the last minute; false when it didn't. */
export function reloadForNewFiles():boolean{
  try{
    if(Date.now()-Number(sessionStorage.getItem('cj_chunk_reload')||0)<60000)return false;
    sessionStorage.setItem('cj_chunk_reload',String(Date.now()));
  }catch{return false}
  window.location.reload();
  return true;
}

// A page's own JS/CSS file failed to load: a dropped connection, or an old tab asking for a file a deploy replaced.
// Reload once (keeping the loading state meanwhile) instead of a blank page; a second failure within a minute is a
// real crash and reaches React's error reporting. Use named() for every lazy-loaded component, not React's lazy().
function reloadOnce(error:unknown):never|Promise<never>{
  if(!reloadForNewFiles())throw error;
  return new Promise<never>(()=>{});
}
export const named=<K extends string>(load:()=>Promise<Record<K,ComponentType<any>>>,name:K)=>lazy(()=>load().then(m=>({default:m[name]}),reloadOnce));

// A stylesheet that fails to load no longer stops the page from drawing: it is asked for once more, and only if that
// fails too (an old tab whose CSS a deploy replaced) does the page reload once. A missing script still goes to
// reloadOnce above. Scraping browsers that never load CSS used to crash every job page here.
export function keepDrawingWithoutStylesheets(){
  window.addEventListener('vite:preloadError',event=>{
    const error=(event as Event&{payload?:unknown}).payload;
    const css=error instanceof Error?error.message.match(/^Unable to preload CSS for (\S+)$/):null;
    if(!css)return;
    event.preventDefault();
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href=css[1];
    link.addEventListener('error',()=>{if(!automatedBrowser())reloadForNewFiles()});
    document.head.appendChild(link);
  });
}
