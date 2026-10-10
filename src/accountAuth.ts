import { type FeatureEnv, publicFormGuard, startEmployerSession, employerSessionCookie, sessionResponse } from './serverFeatures';
import { DASHBOARD_KINDS, homePath, LAST_DASHBOARD_COOKIE, type DashboardKind } from './dashboardHome';
import { isAdminEmail } from './admin';
import { loginLinkEmail } from './email';

// One sign-in for everyone: an emailed link proves the email, and the account session is keyed by it.
// Caregiver profiles and employer/agency workspaces with that email are found from the session, so one
// person keeps one login whichever side of CareJoys they use.

export type AccountEnv=FeatureEnv&{ADMIN_EMAILS?:string;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string};
type Roles={caregiver:boolean;employer:boolean;admin:boolean;school:boolean};

export const LOGIN_LINK_MINUTES=60;
const ACCOUNT_COOKIE='__Host-cj_account';
const SESSION_DAYS=30;
const CLEAR_EMPLOYER_COOKIE='__Host-cj_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
const CLEAR_SCHOOL_COOKIE='__Host-cj_school_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';

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

/** The training program this email has claimed: training-program staff use the same sign-in as everyone else. */
export const SCHOOL_FOR_EMAIL=`SELECT tp.id AS training_program_id,sl.id AS school_lead_id FROM training_programs tp
  JOIN school_leads sl ON sl.id=tp.claimed_school_lead_id WHERE lower(sl.email)=? ORDER BY tp.updated_at DESC LIMIT 1`;

/** The hiring workspace this email signs in to: their own, or one a teammate added them to. */
export async function workspaceForEmail(env:AccountEnv,email:string){
  if(!env.DB||!email)return null;
  const own=await env.DB.prepare("SELECT id FROM employer_leads WHERE lower(email)=? AND status!='disabled' ORDER BY created_at DESC LIMIT 1").bind(email).first<{id:string}>();
  if(own)return own.id;
  const member=await env.DB.prepare("SELECT e.id FROM employer_members m JOIN employer_leads e ON e.id=m.employer_id WHERE m.email=? AND e.status!='disabled' ORDER BY m.created_at DESC LIMIT 1").bind(email).first<{id:string}>();
  return member?.id||null;
}

export async function accountRoles(env:AccountEnv,email:string):Promise<Roles>{
  if(!env.DB||!email)return {caregiver:false,employer:false,admin:false,school:false};
  const caregiver=await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? AND COALESCE(work_status,'') NOT IN ('merged_duplicate','closed') LIMIT 1").bind(email).first();
  const employer=await workspaceForEmail(env,email);
  const school=await env.DB.prepare(SCHOOL_FOR_EMAIL).bind(email).first();
  return {caregiver:!!caregiver,employer:!!employer,admin:await isAdminEmail(env,email),school:!!school};
}

/** Where a fresh sign-in lands: the page they asked for when they can use it, else their own dashboard. */
export function landingPath(roles:Roles,next:string,last=''){
  const home=homePath(roles,last);
  if(!next||next==='/welcome')return home;
  if(next.startsWith('/admin')&&!roles.admin)return home;
  // /app is honored without a workspace: it offers hiring setup to a new agency.
  return next;
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

export async function startAccountSession(env:AccountEnv,email:string){
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

  const {headers,redirect,roles}=await completeSignIn(env,record.email,safeNext(record.redirect_path),cookie(request,LAST_DASHBOARD_COOKIE));
  headers.set('content-type','application/json; charset=utf-8');
  return new Response(JSON.stringify({ok:true,redirect,roles}),{status:200,headers});
}

/** Signs a proven email in: the account session, plus the employer session when a hiring workspace exists. */
async function completeSignIn(env:AccountEnv,email:string,next:string,last=''){
  const roles=await accountRoles(env,email);
  // Magic-link or Google sign-in proves this mailbox belongs to the caregiver, even before dashboard load.
  await env.DB!.prepare("UPDATE caregivers SET auth0_email_verified=1,updated_at=CURRENT_TIMESTAMP WHERE lower(trim(email))=? AND COALESCE(work_status,'') NOT IN ('closed','merged_duplicate')")
    .bind(email).run();
  // A new device has no cookie yet: fall back to the dashboard this account used last anywhere.
  if(!last)last=(await env.DB!.prepare('SELECT last_dashboard FROM account_preferences WHERE email=? LIMIT 1').bind(email).first<{last_dashboard:string}>())?.last_dashboard||'';
  const headers=new Headers({'cache-control':'no-store'});
  headers.append('Set-Cookie',await startAccountSession(env,email));
  // Admins sign in to /admin through an employer session, so give a first-time admin that record.
  if(roles.admin&&!roles.employer){
    await env.DB!.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,hiring_notes,status) VALUES (?,'CareJoys','Admin',?,'','','CareJoys admin account','active')").bind(crypto.randomUUID(),email).run();
    roles.employer=true;
  }
  const employerId=roles.employer?await workspaceForEmail(env,email):null;
  // Replace any workspace or school session this browser still holds for a different email, so a shared computer never
  // opens someone else's hiring workspace under this sign-in.
  headers.append('Set-Cookie',employerId?employerSessionCookie(await startEmployerSession(env,employerId,email)):CLEAR_EMPLOYER_COOKIE);
  if(!roles.school)headers.append('Set-Cookie',CLEAR_SCHOOL_COOKIE);
  return {headers,redirect:landingPath(roles,next,last),roles};
}

// "Continue with Google": the standard OAuth code flow, run by the Worker. Google proves the email, and the person
// lands in the same account an emailed link would give them. Shown only when both Google keys are set.
const GOOGLE_STATE_COOKIE='__Host-cj_google_state';
export const googleSignInConfigured=(env:AccountEnv)=>!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET);
const googleRedirectUri=(request:Request)=>new URL('/api/auth/google/callback',request.url).toString();

export async function startGoogleSignIn(request:Request,env:AccountEnv){
  if(!googleSignInConfigured(env))return Response.redirect(new URL('/login',request.url).toString(),302);
  const url=new URL(request.url);
  const state=crypto.randomUUID();
  const next=safeNext(url.searchParams.get('next'));
  const google=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID!,redirect_uri:googleRedirectUri(request),response_type:'code',
    scope:'openid email profile',state,prompt:'select_account'}).toString();
  // Lax, so the cookie comes back when Google sends the browser to the callback.
  return new Response(null,{status:302,headers:{location:google.toString(),'cache-control':'no-store',
    'Set-Cookie':`${GOOGLE_STATE_COOKIE}=${encodeURIComponent(state+'|'+next)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`}});
}

export async function finishGoogleSignIn(request:Request,env:AccountEnv){
  const url=new URL(request.url);
  const fail=(reason:string)=>new Response(null,{status:302,headers:{location:'/login?error='+reason,'cache-control':'no-store',
    'Set-Cookie':`${GOOGLE_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`}});
  if(!env.DB||!googleSignInConfigured(env))return fail('google_unavailable');
  const [state,...rest]=cookie(request,GOOGLE_STATE_COOKIE).split('|');
  const code=url.searchParams.get('code')||'';
  if(!state||state!==url.searchParams.get('state')||!code)return fail('google_cancelled');
  let claims:Record<string,unknown>|null=null;
  try{
    const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID!,client_secret:env.GOOGLE_CLIENT_SECRET!,redirect_uri:googleRedirectUri(request),grant_type:'authorization_code'})});
    const token=await res.json() as {id_token?:string};
    // The ID token came straight from Google's token endpoint over TLS, so its claims can be read without re-checking the signature.
    const part=token.id_token?.split('.')[1]||'';
    claims=part?JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-part.length%4)%4))):null;
  }catch{claims=null}
  const email=clean(claims?.email,320).toLowerCase();
  const issuerOk=claims?.iss==='https://accounts.google.com'||claims?.iss==='accounts.google.com';
  if(!claims||!issuerOk||claims.aud!==env.GOOGLE_CLIENT_ID||claims.email_verified!==true||!emailValid(email))return fail('google_failed');
  const {headers,redirect}=await completeSignIn(env,email,safeNext(rest.join('|')),cookie(request,LAST_DASHBOARD_COOKIE));
  headers.set('location',redirect);
  headers.append('Set-Cookie',`${GOOGLE_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return new Response(null,{status:302,headers});
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
  const name=await env.DB!.prepare(`SELECT name FROM (
      SELECT first_name AS name,1 AS rank FROM caregivers WHERE lower(trim(email))=? AND COALESCE(work_status,'') NOT IN ('merged_duplicate','closed')
      UNION ALL SELECT contact_name,2 FROM employer_leads WHERE lower(email)=? AND status!='disabled'
      UNION ALL SELECT contact_name,3 FROM school_leads WHERE lower(email)=?)
    WHERE COALESCE(name,'')!='' ORDER BY rank LIMIT 1`).bind(session.email,session.email,session.email).first<{name:string}>();
  return json({ok:true,signedIn:true,email:session.email,name:clean(name?.name,120).split(/\s+/)[0]||'',roles:await accountRoles(env,session.email)});
}

/** An account session for the email behind an employer's emailed workspace link, which proved that email. */
export async function employerAccountCookie(env:AccountEnv,employerId:string){
  const row=await env.DB!.prepare('SELECT email FROM employer_leads WHERE id=? LIMIT 1').bind(employerId).first<{email:string}>();
  const email=clean(row?.email,320).toLowerCase();
  return emailValid(email)?startAccountSession(env,email):null;
}

/** /api/session: the hiring workspace session, opened from the shared sign-in when this browser doesn't have one yet
 *  (it expired, or the workspace was set up or claimed after they signed in). */
export async function hiringSession(request:Request,env:AccountEnv){
  const existing=await sessionResponse(request,env);
  if(existing.status!==401)return existing;
  const account=await accountSession(request,env);
  const employerId=account?await workspaceForEmail(env,account.email):null;
  const employer=employerId?await env.DB!.prepare("SELECT id,company_name,contact_name,email,phone,zip FROM employer_leads WHERE id=? LIMIT 1")
    .bind(employerId).first<Record<string,unknown>>():null;
  if(!employer)return existing;
  const session=await startEmployerSession(env,String(employer.id),account!.email);
  return json({ok:true,employer:{id:employer.id,companyName:employer.company_name,contactName:employer.contact_name,email:employer.email,phone:employer.phone,zip:employer.zip}},
    {headers:{'Set-Cookie':employerSessionCookie(session)}});
}

/** Where a signed-in visitor to the home page belongs: their own dashboard. Null when not signed in. */
export async function signedInHome(request:Request,env:AccountEnv){
  if(!cookie(request,ACCOUNT_COOKIE))return null;
  const session=await accountSession(request,env);
  if(!session)return null;
  let last=cookie(request,LAST_DASHBOARD_COOKIE);
  if(!last)last=(await env.DB!.prepare('SELECT last_dashboard FROM account_preferences WHERE email=? LIMIT 1').bind(session.email).first<{last_dashboard:string}>())?.last_dashboard||'';
  return homePath(await accountRoles(env,session.email),last);
}

/** Saves the dashboard this account opened last, so a sign-in on another device opens it too. */
export async function saveLastDashboard(request:Request,env:AccountEnv){
  const session=await accountSession(request,env);
  if(!session)return json({ok:false,error:'Sign in required'},{status:401});
  const data=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const kind=clean(data?.kind,20) as DashboardKind;
  if(!DASHBOARD_KINDS.includes(kind))return json({ok:false,error:'Unknown dashboard'},{status:400});
  await env.DB!.prepare(`INSERT INTO account_preferences(email,last_dashboard,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET last_dashboard=excluded.last_dashboard,updated_at=CURRENT_TIMESTAMP`).bind(session.email,kind).run();
  return json({ok:true});
}

/** Leaves one side of CareJoys for this account: closes the hiring workspace, or removes the caregiver profile from
 *  employers and from sign-in. Nothing is deleted, so signing up again on that side picks the record back up. */
export async function closeAccountSide(request:Request,env:AccountEnv){
  const session=await accountSession(request,env);
  if(!session)return json({ok:false,error:'Sign in required'},{status:401});
  const data=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const side=clean(data?.side,20);
  const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  if(side==='hiring'){
    const rows=await env.DB!.prepare("SELECT id FROM employer_leads WHERE lower(email)=? AND status!='disabled'").bind(session.email).all<{id:string}>();
    for(const row of rows.results||[]){
      await env.DB!.prepare("UPDATE employer_leads SET status='disabled',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
      await env.DB!.prepare('DELETE FROM employer_sessions WHERE employer_id=?').bind(row.id).run();
    }
    // A teammate leaves the workspaces they were added to; the agency's own workspace stays.
    await env.DB!.prepare('DELETE FROM employer_members WHERE email=?').bind(session.email).run();
    await env.DB!.prepare('DELETE FROM employer_sessions WHERE signed_in_email=?').bind(session.email).run();
    headers.append('Set-Cookie',CLEAR_EMPLOYER_COOKIE);
  }else if(side==='caregiver'){
    await env.DB!.prepare("UPDATE caregivers SET work_status='closed',is_active=0,updated_at=CURRENT_TIMESTAMP WHERE lower(trim(email))=? AND COALESCE(work_status,'')!='merged_duplicate'").bind(session.email).run();
  }else{
    return json({ok:false,error:'Choose hiring or caregiver'},{status:400});
  }
  const roles=await accountRoles(env,session.email);
  return new Response(JSON.stringify({ok:true,roles,redirect:homePath(roles)}),{status:200,headers});
}

/** Signs this browser out of everything: the account session and any employer session. */
export async function logoutEverywhere(request:Request,env:AccountEnv){
  if(env.DB){
    const account=cookie(request,ACCOUNT_COOKIE);
    if(account)await env.DB.prepare('DELETE FROM account_sessions WHERE session_hash=?').bind(await sha256Hex(account)).run();
    const employer=cookie(request,'__Host-cj_session')||cookie(request,'cj_session');
    if(employer)await env.DB.prepare('DELETE FROM employer_sessions WHERE session_hash=?').bind(await sha256Hex(employer)).run();
    const school=cookie(request,'__Host-cj_school_session');
    if(school)await env.DB.prepare('DELETE FROM school_sessions WHERE session_hash=?').bind(await sha256Hex(school)).run();
  }
  const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  headers.append('Set-Cookie',`${ACCOUNT_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  headers.append('Set-Cookie',CLEAR_EMPLOYER_COOKIE);
  headers.append('Set-Cookie',CLEAR_SCHOOL_COOKIE);
  return new Response(JSON.stringify({ok:true}),{status:200,headers});
}
