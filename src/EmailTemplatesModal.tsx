import { useState, type FormEvent } from 'react';
import { PLACEHOLDERS, type EmailTemplate } from './emailTemplateFill';

/** Save, edit and delete the emails used from a candidate's profile. Built-in ones can be copied and changed. */
export function EmailTemplatesModal({templates,onSave,onDelete,onClose}:{
  templates:EmailTemplate[];
  onSave:(t:{id?:string;name:string;subject:string;body:string})=>Promise<void>;
  onDelete:(t:EmailTemplate)=>Promise<void>;
  onClose:()=>void;
}){
  const [editing,setEditing]=useState<EmailTemplate|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    setBusy(true);setError('');
    try{
      await onSave({id:editing&&!editing.builtIn&&editing.id?editing.id:undefined,name:String(fd.get('name')||''),subject:String(fd.get('subject')||''),body:String(fd.get('body')||'')});
      setEditing(null);
    }catch(err){setError(err instanceof Error?err.message:'Could not save this template')}
    finally{setBusy(false)}
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal-panel" onMouseDown={e=>e.stopPropagation()}>
    <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
    <div className="modal-kicker">Email templates</div>
    {editing?<form className="intake-form template-form" onSubmit={submit}>
      <h2>{editing.builtIn||!editing.id?'New template':'Edit template'}</h2>
      <label>Name<input name="name" defaultValue={editing.name} maxLength={80} required/></label>
      <label>Subject<input name="subject" defaultValue={editing.subject} maxLength={200} required/></label>
      <label>Message<textarea name="body" rows={9} defaultValue={editing.body} maxLength={4000} required/></label>
      <p className="job-meta">Filled in for each caregiver: {PLACEHOLDERS.map(([k,label])=><span key={k}><code>{k}</code> {label.toLowerCase()} </span>)}</p>
      {error&&<div className="notice">{error}</div>}
      <div className="empty-actions"><button className="button" disabled={busy}>{busy?'Saving…':'Save template'}</button><button type="button" className="button secondary" onClick={()=>setEditing(null)}>Cancel</button></div>
    </form>:<>
      <h2>Your emails to caregivers</h2>
      <p className="modal-intro">Pick one from a caregiver’s profile and it opens in your email app with their name and the opening filled in.</p>
      <ul className="template-list">{templates.map(t=><li key={t.id}>
        <div><strong>{t.name}</strong>{t.builtIn&&<span className="badge">Starter</span>}<div className="job-meta">{t.subject}</div></div>
        <div className="template-actions">
          <button type="button" className="text-button" onClick={()=>setEditing(t)}>{t.builtIn?'Customize':'Edit'}</button>
          {!t.builtIn&&<button type="button" className="text-button" onClick={()=>{if(window.confirm('Delete the "'+t.name+'" template?'))void onDelete(t)}}>Delete</button>}
        </div>
      </li>)}</ul>
      <button type="button" className="button" onClick={()=>setEditing({id:'',name:'',subject:'{opening} at {company}',body:'Hi {first_name},\n\n\n\nThank you,\n{my_name}\n{company}'})}>+ New template</button>
    </>}
  </div></div>;
}
