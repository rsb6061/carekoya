import { useEffect } from 'react';
import { SiteFooter, SiteHeader } from './SiteChrome';
import './styles.css';
import { NURSE_AIDE_REGISTRIES, REGISTRIES_CHECKED } from './nurseAideRegistries';

export function HowToBecomeCaregiverMarylandPage(){
  return <div>
    <SiteHeader/>
    <main>
      <section className="hero"><div className="wrap">
        <div className="modal-kicker">Maryland caregiver career guide</div>
        <h1>How to become a CNA or caregiver in Maryland</h1>
        <p>There is more than one path into caregiving. The right route depends on the work you want to do: non-medical personal care, home care, or certified nursing-assistant work.</p>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Choose the kind of caregiver work you want</h2>
        <div className="jobs">
          <div className="job"><div><h3>Personal care aide / caregiver</h3><div className="meta">Many non-medical home-care roles are hired and trained directly by Residential Service Agencies or through approved outside trainers. Employer requirements vary by role and client needs.</div></div><span className="pill">PCA · Caregiver · Companion</span></div>
          <div className="job"><div><h3>Certified nursing assistant</h3><div className="meta">Maryland changed its nursing-assistant framework effective April 1, 2026. New applicants generally enter through the CNA-I pathway by completing Board-approved training and the required competency evaluation.</div></div><span className="pill">CNA-I</span></div>
          <div className="job"><div><h3>Home-health and higher-acuity roles</h3><div className="meta">Home-health and delegated-care work can carry additional training or employer requirements. Check the current Maryland Board of Nursing and employer requirements for the exact role.</div></div><span className="pill">Home care</span></div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Do you need caregiver certification in Maryland?</h2>
        <p>Not for every caregiver job. Personal-care, companion, and other non-medical roles may use employer-based training, while certified nursing-assistant work follows Maryland Board of Nursing requirements. Job titles can overlap, so check the credential requirements for the specific employer and duties.</p>
        <div className="jobcta">
          <div><strong>Looking for CNA training?</strong><span>Browse CareJoys' Maryland caregiver training directory and see approved program locations.</span></div>
          <a className="btn" href="/training-programs/maryland">Find training programs</a>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Ready to work?</h2>
        <div className="jobcta">
          <div><strong>Create one CareJoys profile.</strong><span>Get matched with Maryland CNA, GNA, HHA, PCA, private-duty, and home-care opportunities that fit your location and preferences.</span></div>
          <a className="btn" href="/caregiver-jobs/maryland">Find jobs</a>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Check a Maryland CNA or GNA certification</h2>
        <p>Employers and caregivers can confirm a CNA or GNA certification with the license verification lookup on the Maryland Board of Nursing website.</p>
        <p>Moving from another state? See the <a className="text-link" href="/resources/nurse-aide-registry-by-state">nurse aide registry for every state</a>.</p>
        <h2>Official Maryland sources</h2>
        <p className="meta">CareJoys is not a credentialing body. For current rules, use the <a className="text-link" href="https://health.maryland.gov/mbon/Documents/new-cna-faqs-final.pdf" target="_blank" rel="noreferrer">Maryland Board of Nursing CNA guidance</a> and the <a className="text-link" href="https://health.maryland.gov/ohcq/Pages/Residential-Service-Agencies.aspx" target="_blank" rel="noreferrer">Maryland OHCQ Residential Service Agency guidance</a>.</p>
      </div></section>
    </main>
    <SiteFooter/>
  </div>;
}

const checkedLabel=new Date(REGISTRIES_CHECKED+'T12:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});

export function NurseAideRegistryPage(){
  // The page renders after the browser's own jump to #state, so jump again once the rows exist.
  useEffect(()=>{const id=decodeURIComponent(location.hash.slice(1));if(id)document.getElementById(id)?.scrollIntoView();},[]);
  return <div>
    <SiteHeader/>
    <main>
      <section className="hero"><div className="wrap">
        <div className="modal-kicker">CNA resources</div>
        <h1>Nurse aide registry by state</h1>
        <p>Every state keeps a registry of certified nurse aides. Use it to check a CNA certification, renew, update your name or address, or transfer your certification from another state. Below is the official registry for all 50 states and DC, with each state's online lookup and phone number.</p>
        <p className="meta">Links last checked {checkedLabel}. CareJoys is not a registry or credentialing body; confirm requirements with the state.</p>
      </div></section>

      <section className="section"><div className="wrap">
        <div className="registry-table-wrap"><table className="registry-table">
          <thead><tr><th>State</th><th>Registry</th><th>Look up a certification</th><th>Phone</th></tr></thead>
          <tbody>{NURSE_AIDE_REGISTRIES.map(r=>{
            const contacts=r.also?[r,r.also]:[r];
            return <tr key={r.code} id={r.slug}>
              <th scope="row">{r.name}</th>
              <td>{contacts.map(c=><div key={c.agency}><a className="text-link" href={c.registryUrl} target="_blank" rel="noreferrer">{c.agency}</a></div>)}{r.note&&<div className="meta">{r.note}</div>}</td>
              <td>{contacts.map(c=><div key={c.agency}>{c.lookupUrl?<a className="text-link" href={c.lookupUrl} target="_blank" rel="noreferrer">{c.lookupLabel||'Lookup'}</a>:<span className="meta">Contact the registry</span>}</div>)}</td>
              <td>{contacts.map(c=><div key={c.agency}>{c.phone?<a href={'tel:'+c.phone.replace(/[^0-9]/g,'')}>{c.phone}</a>:<span className="meta">See registry site</span>}</div>)}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Transferring your CNA to another state</h2>
        <p>Most states let a nurse aide who is active and in good standing on another state's registry apply to join theirs, often called reciprocity or endorsement. Apply to the registry in the state you are moving to, not the one you are leaving. Rules, forms and fees differ by state, so check that state's registry page above.</p>
        <h2>Ready to work?</h2>
        <div className="jobcta">
          <div><strong>Find CNA and caregiver jobs near you.</strong><span>Free for caregivers, with pay shown up front.</span></div>
          <a className="btn" href="/caregiver-jobs">Find jobs</a>
        </div>
      </div></section>
    </main>
    <SiteFooter/>
  </div>;
}
