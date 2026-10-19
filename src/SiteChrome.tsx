import { AccountLink } from './AccountLink';
import { useCaregiverAuth } from './caregiverAuth';

// The one header and footer for every public page, so the nav doesn't change from page to page.

type Links={jobsHref?:string;showTraining?:boolean};

/** Same links in the same order on every public page; phones get the short labels. The employer button sits top right. */
export function SiteHeader({jobsHref='/caregiver-jobs',hireButton=true}:Omit<Links,'showTraining'>&{hireButton?:boolean}){
  // A signed-in caregiver's jobs live in their dashboard, next to their matches and applications.
  const auth=useCaregiverAuth();
  if(auth.isAuthenticated&&auth.roles?.caregiver)jobsHref='/dashboard/jobs';
  return <header className="nav"><div className="wrap nav-inner">
    <a className="brand" href="/">CareJoys</a>
    <nav className="navlinks">
      <a href={jobsHref}><span className="hide-sm">Find caregiver jobs</span><span className="show-sm">Find jobs</span></a>
      <AccountLink hireButton={hireButton}/>
    </nav>
  </div></header>;
}

export function SiteFooter({jobsHref='/caregiver-jobs',showTraining=true}:Links){
  return <footer className="footer"><div className="wrap footer-inner">
    <div className="footer-brand"><strong>CareJoys</strong><span>Free caregiver career matches and job alerts.</span><span className="footer-operator">CareJoys is operated by NourishNode.</span></div>
    <nav className="footer-links">
      <a href={jobsHref}>Caregiver jobs</a>
      {showTraining&&<a href="/training-programs/maryland">Maryland training programs</a>}
      <a href="/resources/nurse-aide-registry-by-state">CNA registry by state</a>
      <a href="/pricing">For employers</a>
      <a href="/about">About</a>
      <a href="/login">Sign in</a>
      <a href="/privacy-policy">Privacy</a>
      <a href="/terms-of-service">Terms</a>
      <a href="/llms.txt">llms.txt</a>
    </nav>
  </div></footer>;
}
