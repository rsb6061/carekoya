import { Suspense, useEffect, useRef, useState } from 'react';
import { named } from './lazyPage';

const JobDetail=named(()=>import('./CaregiverJobPage'),'JobDetail');

type Open={id:string;apply:boolean};

function jobFromHref(href:string):Open|null{
  try{
    const url=new URL(href,window.location.origin);
    if(url.origin!==window.location.origin)return null;
    const m=url.pathname.match(/^\/jobs\/([^/]+)\/?$/);
    return m?{id:decodeURIComponent(m[1]),apply:url.hash==='#apply'}:null;
  }catch{return null}
}

function withJob(id:string|null){
  const url=new URL(window.location.href);
  if(id)url.searchParams.set('job',id);else url.searchParams.delete('job');
  url.hash='';
  return url.pathname+url.search;
}

/**
 * Mounted once on a page that lists jobs: a plain click on any /jobs/:id link opens that job in a panel on the
 * right instead of leaving the list. The links stay real links, so a new tab, a crawler or a shared URL still
 * gets the full job page. The open job is kept in ?job= so Back closes the panel and a reload reopens it.
 */
export function JobDrawer(){
  const [open,setOpen]=useState<Open|null>(()=>{
    const id=new URLSearchParams(window.location.search).get('job');
    return id?{id,apply:false}:null;
  });
  const pushed=useRef(false);
  const panelRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    function onClick(e:MouseEvent){
      if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
      const a=(e.target as Element|null)?.closest?.('a[href]') as HTMLAnchorElement|null;
      if(!a||a.target==='_blank'||a.hasAttribute('download'))return;
      const next=jobFromHref(a.getAttribute('href')||'');
      if(!next)return;
      e.preventDefault();
      // Inside the panel a similar job replaces this one; from the list it adds one Back step.
      if(pushed.current)window.history.replaceState(window.history.state,'',withJob(next.id));
      else{window.history.pushState({jobDrawer:true},'',withJob(next.id));pushed.current=true}
      setOpen(next);
    }
    function onPop(){
      const id=new URLSearchParams(window.location.search).get('job');
      pushed.current=false;
      setOpen(id?{id,apply:false}:null);
    }
    document.addEventListener('click',onClick);
    window.addEventListener('popstate',onPop);
    return ()=>{document.removeEventListener('click',onClick);window.removeEventListener('popstate',onPop)};
  },[]);

  function close(){
    if(pushed.current){window.history.back();return}
    window.history.replaceState(window.history.state,'',withJob(null));
    setOpen(null);
  }

  useEffect(()=>{
    if(!open)return;
    const before=document.body.style.overflow;
    document.body.style.overflow='hidden';
    panelRef.current?.scrollTo(0,0);
    panelRef.current?.focus();
    // Escape closes the panel, unless the apply box is open on top of it (it closes first).
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.querySelector('.caregiver-apply-modal'))close()};
    window.addEventListener('keydown',onKey);
    return ()=>{document.body.style.overflow=before;window.removeEventListener('keydown',onKey)};
  },[open?.id]);

  if(!open)return null;
  const full='/jobs/'+encodeURIComponent(open.id);
  return <div className="job-drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
    <div className="job-drawer" role="dialog" aria-modal="true" aria-label="Job details" ref={panelRef} tabIndex={-1}>
      <div className="job-drawer-bar">
        <button type="button" className="text-button job-drawer-close" onClick={close} aria-label="Close job">← Back to jobs</button>
        <a className="text-link" href={full} target="_blank" rel="noreferrer">Open full page ↗</a>
      </div>
      <Suspense fallback={<div className="empty">Loading job…</div>}>
        <JobDetail key={open.id} id={open.id} startApply={open.apply} embedded/>
      </Suspense>
    </div>
  </div>;
}
