import { useEffect, useState } from 'react';

// Admin → Caregivers: intro videos waiting for review. Employers only see a video after it's approved here;
// rejecting deletes it from Cloudflare Stream.

type PendingVideo={caregiverId:string;name:string;role?:string;place?:string;durationSeconds?:number|null;submittedAt?:string;playbackUrl?:string|null};

export function AdminVideoReview(){
  const [videos,setVideos]=useState<PendingVideo[]|null>(null);
  const [enabled,setEnabled]=useState(true);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');

  async function load(){
    try{
      const res=await fetch('/api/admin/videos',{credentials:'same-origin'});
      const body=await res.json() as {ok?:boolean;enabled?:boolean;videos?:PendingVideo[];error?:string};
      if(!res.ok||!body.ok)throw new Error(body.error||'Could not load videos.');
      setEnabled(!!body.enabled);setVideos(body.videos||[]);
    }catch(err){setError(err instanceof Error?err.message:'Could not load videos.')}
  }
  useEffect(()=>{void load()},[]);

  async function decide(id:string,decision:'approve'|'reject'){
    if(decision==='reject'&&!window.confirm('Reject and delete this video? The caregiver can upload a new one.'))return;
    setBusy(id);setError('');
    try{
      const res=await fetch('/api/admin/videos/'+encodeURIComponent(id)+'/'+decision,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'});
      const body=await res.json().catch(()=>({})) as {ok?:boolean;error?:string};
      if(!res.ok||!body.ok)throw new Error(body.error||'Could not save that decision.');
      setVideos(v=>(v||[]).filter(x=>x.caregiverId!==id));
    }catch(err){setError(err instanceof Error?err.message:'Could not save that decision.')}
    finally{setBusy('')}
  }

  if(!enabled&&!videos?.length)return null;
  return <section className="section-block admin-video-review">
    <div className="section-heading"><h2>Intro videos to review</h2><p>Approve videos that are a respectful, on-topic introduction. Employers see a video only after it’s approved.</p></div>
    {error&&<div className="notice" role="alert">{error}</div>}
    {videos===null?<p className="job-meta">Loading…</p>:
     videos.length===0?<div className="admin-ok-note"><strong>No videos waiting.</strong> New uploads will appear here.</div>:
     <div className="admin-video-list">{videos.map(v=><article className="admin-video-card" key={v.caregiverId}>
       <h3>{v.name}</h3>
       <p className="job-meta">{[v.role,v.place,v.durationSeconds?v.durationSeconds+'s':''].filter(Boolean).join(' · ')}</p>
       {v.playbackUrl
         ?<div className="intro-video-frame"><iframe src={v.playbackUrl} title={'Intro video from '+v.name} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen/></div>
         :<p className="job-meta">Still processing. Refresh in a few minutes to watch it.</p>}
       <div className="intro-video-actions">
         <button type="button" className="button" disabled={!v.playbackUrl||busy===v.caregiverId} onClick={()=>void decide(v.caregiverId,'approve')}>Approve</button>
         <button type="button" className="button secondary" disabled={busy===v.caregiverId} onClick={()=>void decide(v.caregiverId,'reject')}>Reject</button>
       </div>
     </article>)}</div>}
  </section>;
}
