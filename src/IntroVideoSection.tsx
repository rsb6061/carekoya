import { useEffect, useState, type ChangeEvent } from 'react';

// Optional intro video card on /dashboard/profile. The phone records (or picks) a clip, the browser uploads it
// straight to Cloudflare Stream, and CareJoys reviews it before employers can watch it.

const MAX_SECONDS=60;
const MAX_BYTES=200*1024*1024; // Stream's limit for a single direct upload.
type Video={status:'review'|'approved'|'rejected'|'uploading';processing?:boolean;playbackUrl?:string|null};

async function post<T>(path:string,body?:unknown):Promise<T>{
  const res=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});
  const data=await res.json().catch(()=>({})) as T&{ok?:boolean;error?:string};
  if(!res.ok||!data.ok)throw new Error(data.error||'Something went wrong. Please try again.');
  return data;
}
/** Seconds of video in a local file, or null when the browser can't tell. */
function videoSeconds(file:File){
  return new Promise<number|null>(resolve=>{
    const el=document.createElement('video');
    const url=URL.createObjectURL(file);
    const done=(v:number|null)=>{URL.revokeObjectURL(url);resolve(v)};
    el.preload='metadata';
    el.onloadedmetadata=()=>done(Number.isFinite(el.duration)?el.duration:null);
    el.onerror=()=>done(null);
    el.src=url;
  });
}

export function IntroVideoSection(){
  const [enabled,setEnabled]=useState(false);
  const [video,setVideo]=useState<Video|null>(null);
  const [consent,setConsent]=useState(false);
  const [busy,setBusy]=useState<''|'uploading'|'removing'>('');
  const [message,setMessage]=useState('');
  const [error,setError]=useState(false);

  async function load(){
    const res=await fetch('/api/me/video',{credentials:'same-origin'}).catch(()=>null);
    const data=await res?.json().catch(()=>null) as {ok?:boolean;enabled?:boolean;video?:Video|null}|null;
    if(data?.ok){setEnabled(!!data.enabled);setVideo(data.video||null)}
  }
  useEffect(()=>{void load()},[]);

  async function choose(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];
    e.target.value='';
    if(!file)return;
    setMessage('');setError(false);
    const seconds=await videoSeconds(file);
    if(seconds!==null&&seconds>MAX_SECONDS+1){setError(true);setMessage('Please keep your video to one minute or less.');return}
    if(file.size>MAX_BYTES){setError(true);setMessage('That video file is too large. Try recording a shorter clip.');return}
    setBusy('uploading');
    try{
      const {uploadURL}=await post<{uploadURL:string}>('/api/me/video/upload',{consent:true});
      const form=new FormData();
      form.append('file',file);
      const sent=await fetch(uploadURL,{method:'POST',body:form});
      if(!sent.ok)throw new Error('The upload didn’t go through. Please try again.');
      await post('/api/me/video/complete');
      setMessage('Thanks! We’ll review your video, then employers can watch it.');
      await load();
    }catch(err){
      setError(true);setMessage(err instanceof Error?err.message:'Could not upload your video.');
    }finally{setBusy('')}
  }
  async function remove(){
    if(!window.confirm('Delete your intro video? Employers will no longer see it.'))return;
    setBusy('removing');setMessage('');setError(false);
    try{await post('/api/me/video/delete');setVideo(null);setConsent(false);setMessage('Your video was deleted.')}
    catch(err){setError(true);setMessage(err instanceof Error?err.message:'Could not delete your video.')}
    finally{setBusy('')}
  }

  if(!enabled&&!video)return null;
  const has=video&&video.status!=='rejected';
  const statusText=!video?'':
    video.status==='rejected'?'Your last video wasn’t approved. You’re welcome to try another one.':
    video.status==='approved'?'Approved. Employers can watch it on your profile.':
    'We’re reviewing your video. Employers will see it once it’s approved.';

  return <section className="settings-card profile-section intro-video-section">
    <h3>Intro video <span className="job-meta">(optional)</span></h3>
    <p className="job-meta">Up to one minute. Say hello, why you do care work, and the kind of clients you love working with. Only signed-in employers can watch it, and you can delete it any time.</p>
    {has&&(video.playbackUrl
      ?<div className="intro-video-frame"><iframe src={video.playbackUrl} title="Your intro video" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen/></div>
      :<p className="job-meta">Your video is processing. Check back in a few minutes to watch it.</p>)}
    {statusText&&<p className="profile-photo-status" role="status">{statusText}</p>}
    {enabled&&<>
      {!has&&<label className="check-row"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
        <span>I agree CareJoys may show this video to employers reviewing my profile.</span></label>}
      <div className="intro-video-actions">
        <label className={'button secondary profile-photo-picker'+((!has&&!consent)||busy?' disabled':'')}>
          {busy==='uploading'?'Uploading…':has?'Replace video':'Record or upload video'}
          <input type="file" accept="video/*" onChange={e=>void choose(e)} disabled={(!has&&!consent)||!!busy}/>
        </label>
        {video&&video.status!=='rejected'&&<button type="button" className="button secondary" onClick={()=>void remove()} disabled={!!busy}>{busy==='removing'?'Deleting…':'Delete video'}</button>}
      </div>
    </>}
    {message&&<div className={error?'notice':'profile-photo-status'} role="status">{message}</div>}
  </section>;
}
