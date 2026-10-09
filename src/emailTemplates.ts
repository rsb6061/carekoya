import { employerSession, type FeatureEnv } from './serverFeatures';

// Emails an employer saves for reaching caregivers. CareJoys doesn't send these: the browser fills the placeholders
// and opens the employer's own email app, so replies go straight to them.

type Row=Record<string,unknown>;
export const MAX_TEMPLATES=20;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const shape=(r:Row)=>({id:clean(r.id,100),name:clean(r.name,80),subject:clean(r.subject,200),body:clean(r.body,4000),updatedAt:clean(r.updated_at,40)});

/** GET lists, POST creates or (with an id) updates, DELETE /:id removes. Each employer sees only their own. */
export async function handleEmailTemplates(request:Request,env:FeatureEnv,templateId=''){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const employerId=clean(employer.id,100);
  if(request.method==='GET'){
    const rows=await env.DB.prepare('SELECT * FROM employer_email_templates WHERE employer_id=? ORDER BY name COLLATE NOCASE LIMIT ?').bind(employerId,MAX_TEMPLATES).all<Row>();
    return json({ok:true,templates:(rows.results||[]).map(shape)});
  }
  if(request.method==='DELETE'){
    await env.DB.prepare('DELETE FROM employer_email_templates WHERE id=? AND employer_id=?').bind(templateId,employerId).run();
    return json({ok:true});
  }
  const data=await request.json().catch(()=>null) as Row|null;
  const name=clean(data?.name,80),subject=clean(data?.subject,200),body=clean(data?.body,4000);
  if(!name||!subject||!body)return json({ok:false,error:'Add a name, a subject and a message.'},{status:400});
  const id=clean(data?.id,100);
  if(id){
    const result=await env.DB.prepare('UPDATE employer_email_templates SET name=?,subject=?,body=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND employer_id=?').bind(name,subject,body,id,employerId).run();
    if(!result.meta?.changes)return json({ok:false,error:'Template not found'},{status:404});
    return json({ok:true,id});
  }
  const count=Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM employer_email_templates WHERE employer_id=?').bind(employerId).first<Row>())?.n||0);
  if(count>=MAX_TEMPLATES)return json({ok:false,error:'You can save up to '+MAX_TEMPLATES+' templates. Delete one first.'},{status:409});
  const newId=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO employer_email_templates (id,employer_id,name,subject,body) VALUES (?,?,?,?,?)').bind(newId,employerId,name,subject,body).run();
  return json({ok:true,id:newId},{status:201});
}
