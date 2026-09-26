import { useEffect, useState, type ChangeEvent } from 'react';

type Props={
  caregiverId:string;
  token:string;
  existingPhotoUrl?:string|null;
};

async function canvasBlob(canvas:HTMLCanvasElement,type:string,quality:number){
  return new Promise<Blob>((resolve,reject)=>{
    canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not prepare that photo.')),type,quality);
  });
}

async function preparePhoto(file:File){
  if(!file.type.startsWith('image/'))throw new Error('Choose a JPG, PNG, or WebP photo.');
  if(file.size>10*1024*1024)throw new Error('Choose a photo under 10 MB.');
  const bitmap=await createImageBitmap(file);
  try{
    const size=320;
    const canvas=document.createElement('canvas');
    canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Could not prepare that photo.');
    const scale=Math.max(size/bitmap.width,size/bitmap.height);
    const width=bitmap.width*scale,height=bitmap.height*scale;
    ctx.drawImage(bitmap,(size-width)/2,(size-height)/2,width,height);
    let blob=await canvasBlob(canvas,'image/webp',0.78).catch(()=>canvasBlob(canvas,'image/jpeg',0.78));
    if(blob.size>180000)blob=await canvasBlob(canvas,'image/jpeg',0.62);
    if(blob.size>180000){
      const smaller=document.createElement('canvas');smaller.width=256;smaller.height=256;
      const smallCtx=smaller.getContext('2d');
      if(!smallCtx)throw new Error('Could not prepare that photo.');
      smallCtx.drawImage(canvas,0,0,256,256);
      blob=await canvasBlob(smaller,'image/jpeg',0.58);
    }
    if(blob.size>180000)throw new Error('That photo is still too large after resizing. Try another image.');
    return blob;
  }finally{
    bitmap.close();
  }
}

export function ProfilePhotoStep({caregiverId,token,existingPhotoUrl}:Props){
  const [file,setFile]=useState<File|null>(null);
  const [preview,setPreview]=useState('');
  const [status,setStatus]=useState<'idle'|'saving'|'saved'|'error'>(existingPhotoUrl?'saved':'idle');
  const [message,setMessage]=useState(existingPhotoUrl?'Profile photo already added.':'');

  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);

  function choose(e:ChangeEvent<HTMLInputElement>){
    const next=e.target.files?.[0]||null;
    if(preview)URL.revokeObjectURL(preview);
    setFile(next);setPreview(next?URL.createObjectURL(next):'');setStatus('idle');setMessage('');
  }

  async function save(){
    if(!file)return;
    setStatus('saving');setMessage('');
    try{
      const blob=await preparePhoto(file);
      const res=await fetch('/api/caregivers/'+encodeURIComponent(caregiverId)+'/photo',{
        method:'POST',
        headers:{'content-type':blob.type,'x-carejoys-profile-token':token},
        body:blob
      });
      const body=await res.json() as {ok?:boolean;error?:string};
      if(!res.ok)throw new Error(body.error||'Could not save your photo.');
      setStatus('saved');setMessage('Photo added to your CareJoys profile.');
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not save your photo.');
    }
  }

  return <div className="profile-photo-step">
    <div className="profile-photo-copy">
      <strong>Add a profile photo <span>optional</span></strong>
      <p>A clear head-and-shoulders photo can help employers recognize your profile. It is shown only to signed-in participating employers reviewing matches.</p>
    </div>
    <div className="profile-photo-actions">
      <div className="profile-photo-preview">
        {preview?<img src={preview} alt="Profile preview" />:<div className="profile-photo-placeholder">{status==='saved'?'✓':'+'}</div>}
      </div>
      <label className="btn secondary profile-photo-picker">{file?'Choose another':'Choose photo'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={choose}/></label>
      {file&&status!=='saved'&&<button type="button" className="btn" onClick={save} disabled={status==='saving'}>{status==='saving'?'Saving…':'Save photo'}</button>}
    </div>
    {message&&<div className={status==='error'?'notice':'profile-photo-status'}>{message}</div>}
  </div>;
}
