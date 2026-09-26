import { CaregiverOnboarding } from './CaregiverOnboarding';
import './styles.css';

export function CaregiverResumePage(){
  return <div>
    <header className="nav"><div className="wrap nav-inner">
      <a className="brand" href="/">CareJoys</a>
      <nav className="navlinks"><a href="/caregiver-jobs/maryland">Caregiver jobs</a><a href="/training-programs/maryland">Training programs</a><a href="/hire-caregivers/maryland">For employers</a></nav>
    </div></header>

    <main>
      <section className="resume-hero"><div className="wrap resume-hero-grid">
        <div>
          <div className="modal-kicker">Caregiver resume</div>
          <h1>Add your resume, get matched to the best caregiver jobs near you.</h1>
          <p>Upload your resume once. CareJoys builds your caregiver profile, asks only for anything missing, and matches you with caregiver employers and agencies.</p>
          <div className="resume-points"><span>PDF, DOCX or TXT</span><span>Free to use</span><span>One reusable profile</span></div>
        </div>
        <div className="campaign-form-card"><CaregiverOnboarding /></div>
      </div></section>

      <section className="section" id="caregiver-resume-example"><div className="wrap">
        <h2>Caregiver resume example</h2>
        <div className="resume-example">
          <div><strong>Professional summary</strong><p>Compassionate caregiver with experience supporting older adults with activities of daily living, mobility, meal preparation and companionship. Reliable, patient and comfortable working in private homes.</p></div>
          <div><strong>Skills to include when they are true for you</strong><div className="job-tags"><span className="pill">ADLs</span><span className="pill">Dementia care</span><span className="pill">Transfers</span><span className="pill">Hoyer lift</span><span className="pill">Meal preparation</span><span className="pill">Medication reminders</span><span className="pill">Companionship</span><span className="pill">CPR / First Aid</span></div></div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>What should a caregiver resume include?</h2>
        <div className="jobs">
          <div className="job"><div><h3>Your actual caregiving experience</h3><div className="meta">List the people or settings you supported, the duties you performed and the dates you worked. Family caregiving can be relevant when described accurately.</div></div></div>
          <div className="job"><div><h3>Credentials and hands-on skills</h3><div className="meta">Include active certifications and skills you have actually used: CNA/CNA-I, HHA, CPR/BLS, ADLs, dementia care, transfers, vital signs, hospice, meal prep and similar experience.</div></div></div>
          <div className="job"><div><h3>Availability employers can use</h3><div className="meta">Resumes rarely include shifts, travel radius, transportation or current availability. CareJoys asks for those separately so matching is more useful.</div></div></div>
        </div>
      </div></section>
    </main>

    <footer className="footer"><div className="wrap">CareJoys · <a href="/caregiver-jobs/maryland">Caregiver jobs</a> · <a href="/training-programs/maryland">Training programs</a> · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
