import type { ReactNode } from 'react';
import { AccountLink } from './AccountLink';

// The one header and footer for every public page, so the nav doesn't change from page to page.

type Links={jobsHref?:string;employersHref?:string;showTraining?:boolean};

/** Phones only have room for one section link: caregiver pages keep jobs, employer pages keep employers. */
type Audience={audience?:'caregiver'|'employer'};

export function SiteHeader({jobsHref='/caregiver-jobs/maryland',employersHref='/hire-caregivers/maryland',showTraining=true,audience='caregiver',action}:Links&Audience&{action?:ReactNode}){
  return <header className="nav"><div className="wrap nav-inner">
    <a className="brand" href="/">CareJoys</a>
    <nav className="navlinks">
      <a className={audience==='caregiver'?undefined:'hide-sm'} href={jobsHref}>Caregiver jobs</a>
      {showTraining&&<a className="hide-sm" href="/training-programs/maryland">Training programs</a>}
      <a className={audience==='employer'?undefined:'hide-sm'} href={employersHref}>For employers</a>
      <AccountLink/>
      {action}
    </nav>
  </div></header>;
}

export function SiteFooter({jobsHref='/caregiver-jobs/maryland',employersHref='/hire-caregivers/maryland',showTraining=true}:Links){
  return <footer className="footer"><div className="wrap footer-inner">
    <div className="footer-brand"><strong>CareJoys</strong><span>Caregivers ready to work. Interviews ready for you.</span></div>
    <nav className="footer-links">
      <a href={jobsHref}>Caregiver jobs</a>
      {showTraining&&<a href="/training-programs/maryland">Training programs</a>}
      <a href={employersHref}>For employers</a>
      <a href="/about">About</a>
      <a href="/privacy-policy">Privacy</a>
      <a href="/terms-of-service">Terms</a>
    </nav>
  </div></footer>;
}
