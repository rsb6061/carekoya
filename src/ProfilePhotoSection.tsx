import { useEffect, useState, type ChangeEvent } from 'react';
import { preparePhoto } from './ProfilePhotoStep';

// Photo card on /dashboard/profile. The photo is cropped to a centered square in the browser and saved right away.
export function ProfilePhotoSection({hasPhoto}:{hasPhoto:boolean}){
  const [src,setSrc]=useState(hasPhoto?'/api/me/photo':'');
  const [status,setStatus]=useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [message,setMessage]=useState('');

  useEffect(()=>()=>{if(src.startsWith('blob:'))URL.revokeObjectURL(src)},[src]);

  async function choose(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];
    e.target.value='';
    if(!file)return;
    setStatus('saving');setMessage('');
    try{
      const blob=await preparePhoto(file);
      const res=await fetch('/api/me/photo',{method:'POST',credentials:'same-origin',headers:{'content-type':blob.type},body:blob});
      const body=await res.json().catch(()=>({})) as {ok?:boolean;error?:string};
      if(!res.ok||!body.ok)throw new Error(body.error||'Could not save your photo.');
      setSrc(URL.createObjectURL(blob));
      setStatus('saved');setMessage('Photo saved.');
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not save your photo.');
    }
  }

  return <section className="settings-card profile-section profile-photo-section">
    <div className="profile-photo-square">
      {src?<img src={src} alt="Your profile photo" onError={()=>setSrc('')}/>:<span aria-hidden="true">+</span>}
    </div>
    <div>
      <h3>Your photo</h3>
      <p className="job-meta">A clear head-and-shoulders photo helps employers recognize you. It’s cropped to a square and shown only to signed-in employers.</p>
      <label className="button secondary profile-photo-picker">{status==='saving'?'Saving…':src?'Change photo':'Upload photo'}
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>void choose(e)} disabled={status==='saving'}/>
      </label>
      {message&&<div className={status==='error'?'notice':'profile-photo-status'} role="status">{message}</div>}
    </div>
  </section>;
}
