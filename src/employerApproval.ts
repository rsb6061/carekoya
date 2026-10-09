import type { FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
type ApprovalEnv=FeatureEnv&{ADMIN_EMAILS?:string};
export type EmployerApproval={approved:boolean;reason:'manual'|'agency'|'business_email'|'pending'};

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});

// Anyone can sign up with these, so they say nothing about who the employer is.
export const FREE_MAIL=new Set(['gmail.com','googlemail.com','yahoo.com','ymail.com','hotmail.com','outlook.com','live.com','msn.com','aol.com',
  'icloud.com','me.com','mac.com','comcast.net','verizon.net','att.net','sbcglobal.net','protonmail.com','proton.me','gmx.com','mail.com','zoho.com']);

export const isFreeMail=(email:string)=>FREE_MAIL.has(clean(email,320).toLowerCase().split('@').pop()||'');

const adminList=(env:ApprovalEnv)=>clean(env.ADMIN_EMAILS,4000).toLowerCase().split(/[\s,;]+/).filter(e=>e.includes('@'));

/** Employer access requires employer verification, independent of site administrator identity. */
export async function employerApproval(env:ApprovalEnv,employer:Row):Promise<EmployerApproval>{
  if(clean(employer.approved_at,40))return {approved:true,reason:'manual'};
  const email=clean(employer.email,320).toLowerCase();
  const claimed=await env.DB!.prepare('SELECT 1 FROM agency_organizations WHERE claimed_employer_id=? LIMIT 1').bind(employer.id).first();
  if(claimed)return {approved:true,reason:'agency'};
  if(email.includes('@')&&!isFreeMail(email))return {approved:true,reason:'business_email'};
  return {approved:false,reason:'pending'};
}

/** Reloads approval fields the session row doesn't carry. */
export async function approvalFor(env:ApprovalEnv,employerId:string){
  const row=await env.DB!.prepare('SELECT id,email,approved_at FROM employer_leads WHERE id=?').bind(employerId).first<Row>();
  return row?employerApproval(env,row):{approved:false,reason:'pending'} as EmployerApproval;
}

/** 403 for a pending employer. The first time, tells the admins someone is waiting. */
export async function pendingApprovalResponse(env:ApprovalEnv,employerId:string){
  const res=await env.DB!.prepare('UPDATE employer_leads SET approval_requested_at=CURRENT_TIMESTAMP WHERE id=? AND approval_requested_at IS NULL').bind(employerId).run();
  if(res.meta?.changes&&env.EMAIL){
    const e=await env.DB!.prepare('SELECT company_name,contact_name,email FROM employer_leads WHERE id=?').bind(employerId).first<Row>();
    const admins=adminList(env);
    if(e&&admins.length){
      const who=`${clean(e.company_name,200)} (${clean(e.contact_name,120)}, ${clean(e.email,320)})`;
      await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to:admins,subject:'Employer waiting for approval: '+clean(e.company_name,200),
        text:`${who} signed up with a personal email address and is waiting for approval before they can see caregiver profiles.\n\nApprove or ignore them at https://carejoys.com/admin`,
        html:`<p>${who.replace(/[<>&]/g,'')} signed up with a personal email address and is waiting for approval before they can see caregiver profiles.</p><p><a href="https://carejoys.com/admin">Review in the admin console</a></p>`}).catch(()=>null);
    }
  }
  return json({ok:false,pendingApproval:true,error:'Your account is waiting for CareJoys approval. We review new employers within one business day.'},{status:403});
}

export async function approveEmployer(env:ApprovalEnv,employerId:string,approvedBy:string){
  const e=await env.DB!.prepare('SELECT id,company_name,contact_name,email,approved_at FROM employer_leads WHERE id=?').bind(employerId).first<Row>();
  if(!e)return json({ok:false,error:'Employer not found'},{status:404});
  if(!clean(e.approved_at,40)){
    await env.DB!.prepare('UPDATE employer_leads SET approved_at=CURRENT_TIMESTAMP,approved_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(approvedBy||'admin',employerId).run();
    if(env.EMAIL)await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to:clean(e.email,320),subject:'You’re approved on CareJoys',
      text:`Hi ${clean(e.contact_name,80)||'there'},\n\nYour CareJoys account is approved. You can now search caregivers and see your matches:\nhttps://carejoys.com/app\n\nCareJoys`,
      html:`<p>Hi ${clean(e.contact_name,80).replace(/[<>&]/g,'')||'there'},</p><p>Your CareJoys account is approved. You can now search caregivers and see your matches.</p><p><a href="https://carejoys.com/app">Open CareJoys</a></p>`}).catch(()=>null);
  }
  return json({ok:true});
}
