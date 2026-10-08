// Where "my dashboard" is for an account, shared by the Worker (after sign-in) and the browser (header link).
// There is no chooser page: one workspace opens directly, and an account with several opens the one it used last.
export type DashboardRoles={caregiver:boolean;employer:boolean;admin:boolean;school?:boolean};
export type DashboardKind='me'|'app'|'admin'|'school';
export const LAST_DASHBOARD_COOKIE='cj_last_dashboard';

export function homePath(roles:DashboardRoles|null,last=''){
  if(!roles)return '/dashboard';
  if(last==='admin'&&roles.admin)return '/admin';
  if(last==='app'&&roles.employer)return '/app';
  if(last==='me'&&roles.caregiver)return '/dashboard';
  if(last==='school'&&roles.school)return '/school-dashboard';
  if(roles.admin)return '/admin';
  if(roles.employer)return '/app';
  if(roles.school&&!roles.caregiver)return '/school-dashboard';
  // Caregivers, and brand-new emails: /dashboard builds a caregiver profile and offers hiring setup instead.
  return '/dashboard';
}

export const DASHBOARD_KINDS:DashboardKind[]=['me','app','admin','school'];

let remembered='';
/** Browser only: remember which dashboard this person opened, here and on their account, so the next sign-in on
 *  any device returns there. */
export function rememberDashboard(kind:DashboardKind){
  try{document.cookie=`${LAST_DASHBOARD_COOKIE}=${kind}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`}catch{}
  if(remembered===kind)return;
  remembered=kind;
  fetch('/api/account/last-dashboard',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind}),keepalive:true}).catch(()=>{});
}
export function lastDashboard(){
  try{return document.cookie.split('; ').find(c=>c.startsWith(LAST_DASHBOARD_COOKIE+'='))?.split('=')[1]||''}catch{return ''}
}
