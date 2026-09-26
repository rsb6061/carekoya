import './styles.css';

export function EmployerRecruitingPage(){
  return <div>
    <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/caregiver-jobs/maryland">For caregivers</a><a href="/training-programs/maryland">Training programs</a><a href="/about">About</a><a href="/app">Employer workspace</a></nav></div></header>
    <main>
      <section className="hero"><div className="wrap">
        <div className="modal-kicker">Hire caregivers</div>
        <h1>Hire caregivers in Maryland.</h1>
        <p>Find local CNAs, GNAs, HHAs, PCAs and caregivers who are actually interested in your opening.</p>
        <div className="hero-actions"><a className="btn" href="/?hire=1">Find caregivers</a><a className="text-link" href="/about">How CareJoys works</a></div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>What CareJoys does for care employers</h2>
        <div className="jobs">
          <div className="job"><div><h3>Find relevant local caregivers</h3><div className="meta">Match against caregiver role, ZIP, commute, shifts, desired pay, transportation, certifications, specialties, and availability freshness.</div></div><div className="meta">01</div></div>
          <div className="job"><div><h3>Confirm who is actually interested</h3><div className="meta">CareJoys is built to distinguish a profile in a database from a caregiver who is currently looking and wants to hear about your opening.</div></div><div className="meta">02</div></div>
          <div className="job"><div><h3>Move matches into interviews</h3><div className="meta">Track matched, contacted, interested, qualified, interview, and hired stages without forcing your team to manage another giant applicant database.</div></div><div className="meta">03</div></div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Caregiver roles CareJoys supports</h2>
        <div className="jobcta"><div><strong>CNA · GNA · HHA · PCA · Caregiver</strong><span>CareJoys models credentials, experience, work preferences, transportation, and current availability separately from job title so employers can match the actual requirements of the role.</span></div><a className="btn secondary" href="/caregiver-jobs/maryland">Caregiver network</a></div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>How CareJoys is different from a job board</h2>
        <div className="jobs">
          <div className="job"><div><h3>One persistent caregiver profile</h3><div className="meta">Caregivers do not need to rebuild the same basic work profile for every employer.</div></div></div>
          <div className="job"><div><h3>Availability is a live signal</h3><div className="meta">CareJoys labels whether a caregiver recently confirmed they are looking instead of treating every old profile as an active candidate.</div></div></div>
          <div className="job"><div><h3>Training-to-hire attribution</h3><div className="meta">Caregiver training programs can refer graduates through tracked links so CareJoys can measure profiles, matches, employer interest, interviews, and recorded hires.</div></div></div>
        </div>
      </div></section>
    </main>
    <footer className="footer"><div className="wrap">CareJoys · Maryland caregiver recruiting and placement · <a href="/about">About</a> · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}

export function AboutCareJoysPage(){
  return <div>
    <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/hire-caregivers/maryland">For employers</a><a href="/caregiver-jobs/maryland">For caregivers</a><a href="/training-programs/maryland">Training programs</a></nav></div></header>
    <main>
      <section className="hero"><div className="wrap">
        <div className="modal-kicker">About CareJoys</div>
        <h1>Caregiver recruiting built around current interest, not stale profiles.</h1>
        <p><strong>CareJoys is a Maryland caregiver recruiting and placement network.</strong> It connects care employers, caregivers, and caregiver training programs so a hiring need can move from relevant local match to confirmed interest to interview with less manual chasing.</p>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>What is CareJoys?</h2>
        <div className="jobs">
          <div className="job"><div><h3>For care employers</h3><div className="meta">Find local caregivers who fit the role and work preferences, see availability freshness, confirm interest, and manage the path to interview and hire.</div></div><a className="text-link" href="/hire-caregivers/maryland">Employer recruiting →</a></div>
          <div className="job"><div><h3>For caregivers</h3><div className="meta">Create one work profile, keep availability current, and decide which relevant Maryland opportunities you want to pursue.</div></div><a className="text-link" href="/caregiver-jobs/maryland">Caregiver network →</a></div>
          <div className="job"><div><h3>For caregiver training programs</h3><div className="meta">Give graduates tracked referral links and measure downstream profiles, matches, employer interest, interviews, and recorded hires.</div></div><a className="text-link" href="/training-programs/maryland">Training programs →</a></div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>What CareJoys is not</h2>
        <div className="source-strip"><div className="source-strip-title">Not a credentialing body and not a generic resume database</div><div className="meta">State regulators and approved training programs remain the source of credential and training status. CareJoys organizes recruiting, matching, referral attribution, candidate interest, and hiring workflow signals.</div></div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Current focus</h2>
        <p>CareJoys is currently focused on Maryland care hiring, including CNA, GNA, HHA, PCA, caregiver, and related direct-care roles. The network is designed to expand by role and geography only where there is enough real employer and caregiver activity to make the matching experience useful.</p>
      </div></section>
    </main>
    <footer className="footer"><div className="wrap">CareJoys · Maryland caregiver recruiting and placement · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
