import { useCaregiverAuth } from './caregiverAuth';
import { homePath, lastDashboard } from './dashboardHome';

/** The header's account link on every public page: "Sign in" when signed out, "My dashboard" when signed in. */
export function AccountLink({className}:{className?:string}){
  const auth=useCaregiverAuth();
  // Keep the space while the session loads so the header doesn't jump.
  if(auth.loading)return <a className={className} href="/login" style={{visibility:'hidden'}} aria-hidden="true" tabIndex={-1}>Sign in</a>;
  if(!auth.isAuthenticated)return <a className={className} href="/login">Sign in</a>;
  return <a className={className} href={homePath(auth.roles,lastDashboard())}>My dashboard</a>;
}
