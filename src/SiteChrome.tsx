import { AccountLink } from './AccountLink';

// The one header and footer for every public page, so the nav doesn't change from page to page.

type Links={jobsHref?:string;showTraining?:boolean};

/** Phones only have room for one section link: caregiver pages keep jobs, employer pages keep employers. */
type Audience={audience?:'caregiver'|'employer'};

export function SiteHeader({jobsHref='/caregiver-jobs',audience='caregiver'}:Omit<Links,'showTraining'>&Audience){
  return <header className="nav"><div className="wrap nav-inner">
    <a className="brand" href="/">CareJoys</a>
    <nav className="navlinks">
      <a className={audience==='caregiver'?undefined:'hide-sm'} href={jobsHref}>Caregiver jobs</a>
      <a className={audience==='employer'?undefined:'hide-sm'} href="/pricing">For employers</a>
      <AccountLink className="nav-signin"/>
    </nav>
  </div></header>;
}

export function SiteFooter({jobsHref='/caregiver-jobs',showTraining=true}:Links){
  return <footer className="footer"><div className="wrap footer-inner">
    <div className="footer-brand"><strong>CareJoys</strong><span>Free caregiver career matches and job alerts.</span></div>
    <nav className="footer-links">
      <a href={jobsHref}>Caregiver jobs</a>
      {showTraining&&<a href="/training-programs/maryland">Maryland training programs</a>}
      <a href="/pricing">For employers</a>
      <a href="/about">About</a>
      <a href="/privacy-policy">Privacy</a>
      <a href="/terms-of-service">Terms</a>
    </nav>
  </div></footer>;
}
