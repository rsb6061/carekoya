import { type FeatureEnv, publicFormGuard, startEmployerSession, employerSessionCookie } from './serverFeatures';
import { adminEmails } from './admin';
import { loginLinkEmail } from './email';

// One sign-in for everyone: an emailed link proves the email, and the account session is keyed by it.
// Caregiver profiles and employer/agency workspaces with that email are found from the session, so one
// person keeps one login whichever side of CareJoys they use.

export type AccountEnv=FeatureEnv&{ADMIN_EMAILS?:string};
type Roles={caregiver:boolean;employer:boolean;admin:boolean};

export const LOGIN_LINK_MINUTES=60;
const ACCOUNT_COOKIE='__Host-cj_account';
const SESSION_DAYS=30;

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const emailValid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
async function sha256Hex(value:string){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function cookie(request:Request,name:string){
  for(const piece of (request.headers.get('cookie')||'').split(';')){
    const [key,...rest]=piece.trim().split('=');
    if(key===name)return decodeURIComponent(rest.join('='));
  }
  return '';
}

/** A same-site path to return to after sign-in, or '' when the value could leave CareJoys or loop back to sign-in. */
export function safeNext(raw:unknown){
  const next=clean(raw,500);
  if(!next.startsWith('/')||next.startsWith('//')||next.includes('\\'))return '';
  if(/^\/(login|signup|signin)(\/|\?|$)/.test(next))return '';
  return next;
}

export async function accountRoles(env:AccountEnv,email:string):Promise<Roles>{
  if(!env.DB||!email)return {caregiver:false,employer:false,admin:false};
  const caregiver=await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? AND COALESCE(work_status,'')!='merged_duplicate' LIMIT 1").bind(email).first();
  const employer=await env.DB.prepare("SELECT id FROM employer_leads WHERE lower(email)=? AND status!='disabled' LIMIT 1").bind(email).first();
  return {caregiver:!!caregiver,employer:!!employer,admin:adminEmails(env).includes(email)};
}

/** Where a fresh sign-in lands: the page they asked for when they can use it, else their own dashboard. */
export function landingPath(roles:Roles,next:string){
  if(next){
    if(next.startsWith('/admin')&&!roles.admin)return '/welcome';
    if(next.startsWith('/app')&&!roles.employer)return '/welcome';
    return next;
  }
  if(roles.admin)return '/admin';
  if(roles.employer&&roles.caregiver)return '/welcome';
  if(roles.employer)return '/app';
  if(roles.caregiver)return '/me';
  return '/welcome';
}

export async function requestLogin(request:Request,env:AccountEnv){
  if(!env.DB||!env.EMAIL)return json({ok:false,error:'Sign-in email is not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const guard=await publicFormGuard(request,env,'login_link',data,5,15);
  if(guard)return guard;
  const email=clean(data?.email,320).toLowerCase();
  if(!emailValid(email))return json({ok:false,error:'Enter a valid email address'},{status:400});
  const token=crypto.randomUUID()+'-'+crypto.randomUUID();
  const expires=new Date(Date.now()+LOGIN_LINK_MINUTES*60000).toISOString();
  await env.DB.prepare("DELETE FROM login_tokens WHERE email=? AND used_at IS NULL AND datetime(expires_at)<=datetime('now')").bind(email).run();
  await env.DB.prepare('INSERT INTO login_tokens(id,email,token_hash,redirect_path,expires_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(),email,await sha256Hex(token),safeNext(data?.next)||null,expires).run();
  const body=loginLinkEmail('https://carejoys.com/signin?token='+encodeURIComponent(token));
  await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to:email,subject:body.subject,html:body.html,text:body.text});
  // The same answer for every address, so the form never reveals who has an account.
  return json({ok:true,message:'Check your email for a secure sign-in link.'});
}

async function startAccountSession(env:AccountEnv,email:string){
  const session=crypto.randomUUID()+'-'+crypto.randomUUID();
  const expires=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
  await env.DB!.prepare('INSERT INTO account_sessions(id,email,session_hash,expires_at) VALUES (?,?,?,?)')
    .bind(crypto.randomUUID(),email,await sha256Hex(session),expires).run();
  return `${ACCOUNT_COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS*86400}`;
}

export async function verifyLogin(request:Request,env:AccountEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const token=clean(data?.token,300);
  if(!token)return json({ok:false,error:'Sign-in link is missing'},{status:400});
  const record=await env.DB.prepare("SELECT id,email,redirect_path FROM login_tokens WHERE token_hash=? AND used_at IS NULL AND datetime(expires_at)>datetime('now') LIMIT 1")
    .bind(await sha256Hex(token)).first<{id:string;email:string;redirect_path?:string|null}>();
  if(!record)return json({ok:false,error:'This sign-in link is invalid or has expired.'},{status:400});
  const used=await env.DB.prepare('UPDATE login_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL').bind(record.id).run();
  if(Number(used.meta?.changes||0)!==1)return json({ok:false,error:'This sign-in link has already been used.'},{status:400});

  const email=record.email;
  const roles=await accountRoles(env,email);
  const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  headers.append('Set-Cookie',await startAccountSession(env,email));
  // Admins sign in to /admin through an employer session, so give a first-time admin that record.
  if(roles.admin&&!roles.employer){
    await env.DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,hiring_notes,status) VALUES (?,'CareJoys','Admin',?,'','','CareJoys admin account','active')").bind(crypto.randomUUID(),email).run();
    roles.employer=true;
  }
  if(roles.employer){
    const employer=await env.DB.prepare("SELECT id FROM employer_leads WHERE lower(email)=? AND status!='disabled' ORDER BY created_at DESC LIMIT 1").bind(email).first<{id:string}>();
    if(employer)headers.append('Set-Cookie',employerSessionCookie(await startEmployerSession(env,employer.id)));
  }
  return new Response(JSON.stringify({ok:true,redirect:landingPath(roles,safeNext(record.redirect_path)),roles}),{status:200,headers});
}

/** The proven email behind this browser's CareJoys sign-in, or null. */
export async function accountSession(request:Request,env:AccountEnv){
  if(!env.DB)return null;
  const token=cookie(request,ACCOUNT_COOKIE);
  if(!token)return null;
  const row=await env.DB.prepare("SELECT id,email FROM account_sessions WHERE session_hash=? AND datetime(expires_at)>datetime('now') LIMIT 1")
    .bind(await sha256Hex(token)).first<{id:string;email:string}>();
  if(!row)return null;
  await env.DB.prepare('UPDATE account_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?').bind(row.id).run();
  return {email:row.email};
}

export async function accountStatus(request:Request,env:AccountEnv){
  const session=await accountSession(request,env);
  if(!session)return json({ok:true,signedIn:false});
  return json({ok:true,signedIn:true,email:session.email,roles:await accountRoles(env,session.email)});
}

/** Signs this browser out of everything: the account session and any employer session. */
export async function logoutEverywhere(request:Request,env:AccountEnv){
  if(env.DB){
    const account=cookie(request,ACCOUNT_COOKIE);
    if(account)await env.DB.prepare('DELETE FROM account_sessions WHERE session_hash=?').bind(await sha256Hex(account)).run();
    const employer=cookie(request,'__Host-cj_session')||cookie(request,'cj_session');
    if(employer)await env.DB.prepare('DELETE FROM employer_sessions WHERE session_hash=?').bind(await sha256Hex(employer)).run();
  }
  const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  headers.append('Set-Cookie',`${ACCOUNT_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  headers.append('Set-Cookie','__Host-cj_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
  return new Response(JSON.stringify({ok:true}),{status:200,headers});
}
