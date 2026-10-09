import type { FeatureEnv } from './serverFeatures';

// A caregiver's stored resume file (caregiver_resume_files). Callers decide who may read it.

const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});

export async function loadResume(env:FeatureEnv,caregiverId:string){
  const row=await env.DB!.prepare('SELECT file_blob,file_name,content_type FROM caregiver_resume_files WHERE caregiver_id=? LIMIT 1')
    .bind(caregiverId).first<{file_blob:ArrayBuffer|number[];file_name:string;content_type:string}>();
  if(!row)return null;
  const bytes=row.file_blob instanceof ArrayBuffer?new Uint8Array(row.file_blob):new Uint8Array(row.file_blob as number[]);
  return {name:row.file_name,mimeType:row.content_type,bytes};
}

/** The resume file as a download. Callers decide who may see it. */
export async function resumeDownload(env:FeatureEnv,caregiverId:string){
  const resume=await loadResume(env,caregiverId);
  if(!resume)return json({ok:false,error:'No resume file yet.'},{status:404});
  return new Response(resume.bytes,{headers:{'content-type':resume.mimeType,'content-disposition':'attachment; filename="'+resume.name.replace(/"/g,'')+'"',
    'cache-control':'private,no-store','x-content-type-options':'nosniff'}});
}
