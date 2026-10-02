import { useCaregiverAuth, type AccountRoles } from './caregiverAuth';

/** The dashboard a signed-in account opens from the header: its only workspace, or the /welcome chooser. */
export function dashboardPath(roles:AccountRoles|null){
  if(!roles||roles.admin)return '/welcome';
  if(roles.caregiver&&!roles.employer)return '/me';
  if(roles.employer&&!roles.caregiver)return '/app';
  return '/welcome';
}

/** The header's account link on every public page: "Sign in" when signed out, "My dashboard" when signed in. */
export function AccountLink({className}:{className?:string}){
  const auth=useCaregiverAuth();
  // Keep the space while the session loads so the header doesn't jump.
  if(auth.loading)return <a className={className} href="/login" style={{visibility:'hidden'}} aria-hidden="true" tabIndex={-1}>Sign in</a>;
  if(!auth.isAuthenticated)return <a className={className} href="/login">Sign in</a>;
  return <a className={className} href={dashboardPath(auth.roles)}>My dashboard</a>;
}
