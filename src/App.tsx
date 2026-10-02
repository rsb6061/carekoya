import { lazy, Suspense, useState, type ComponentType, type FormEvent } from 'react';
import { AccountLink } from './AccountLink';
import { IntakeModal, type FormKind, type EmployerPreset } from './IntakeModal';
import { parseJobsHubPath } from './usStates';

// Each page is its own chunk so a visitor only downloads the page they opened.
const named=<K extends string>(load:()=>Promise<Record<K,ComponentType<any>>>,name:K)=>lazy(()=>load().then(m=>({default:m[name]})));
const EmployerWorkspace=named(()=>import('./EmployerWorkspace'),'EmployerWorkspace');
const CaregiverActivation=named(()=>import('./CaregiverActivation'),'CaregiverActivation');
const EmployerAuth=named(()=>import('./EmployerAuth'),'EmployerAuth');
const CandidateResponse=named(()=>import('./CandidateResponse'),'CandidateResponse');
const LegalPage=named(()=>import('./LegalPage'),'LegalPage');
const AgencyClaim=named(()=>import('./AgencyClaim'),'AgencyClaim');
const MarylandCaregiverPage=named(()=>import('./MarylandCaregiverPage'),'MarylandCaregiverPage');
const SchoolProgramPage=named(()=>import('./SchoolPortal'),'SchoolProgramPage');
const SchoolAuth=named(()=>import('./SchoolPortal'),'SchoolAuth');
const SchoolDashboard=named(()=>import('./SchoolPortal'),'SchoolDashboard');
const MarylandSchoolsPage=named(()=>import('./MarylandSchoolsPage'),'MarylandSchoolsPage');
const TrainingOrganizationPage=named(()=>import('./TrainingOrganizationPage'),'TrainingOrganizationPage');
const EmployerRecruitingPage=named(()=>import('./PublicInfoPages'),'EmployerRecruitingPage');
const AboutCareJoysPage=named(()=>import('./PublicInfoPages'),'AboutCareJoysPage');
const HowToBecomeCaregiverMarylandPage=named(()=>import('./CaregiverResourcePage'),'HowToBecomeCaregiverMarylandPage');
const CaregiverResumePage=named(()=>import('./CaregiverResumePage'),'CaregiverResumePage');
const CaregiverJobPage=named(()=>import('./CaregiverJobPage'),'CaregiverJobPage');
const ConfirmInterest=named(()=>import('./ConfirmInterest'),'ConfirmInterest');
const AgentSetupPage=named(()=>import('./AgentSetupPage'),'AgentSetupPage');
const CaregiverDashboard=named(()=>import('./CaregiverDashboard'),'CaregiverDashboard');
const AdminConsole=named(()=>import('./AdminConsole'),'AdminConsole');
const LoginPage=named(()=>import('./LoginPage'),'LoginPage');
const SignInLinkPage=named(()=>import('./LoginPage'),'SignInLinkPage');
const WelcomeRedirect=named(()=>import('./LoginPage'),'WelcomeRedirect');

function routePage(path:string){
  if (/^\/hire-caregivers\/[^/]+\/?$/.test(path)) return <EmployerRecruitingPage />;
  if (path.startsWith('/caregiver-resume')) return <CaregiverResumePage />;
  if (path.startsWith('/jobs/')) return <CaregiverJobPage />;
  if (path.startsWith('/resources/how-to-become-a-caregiver-in-maryland')) return <HowToBecomeCaregiverMarylandPage />;
  if (path === '/about' || path.startsWith('/about/')) return <AboutCareJoysPage />;
  if (path.startsWith('/activate')) return <CaregiverActivation />;
  if (path.startsWith('/auth')) return <EmployerAuth />;
  if (path.startsWith('/respond')) return <CandidateResponse />;
  if (path.startsWith('/confirm-interest')) return <ConfirmInterest />;
  if (path === '/agent') return <AgentSetupPage />;
  if (path.startsWith('/agency')) return <AgencyClaim />;
  if (parseJobsHubPath(path) || path.startsWith('/join/')) return <MarylandCaregiverPage />;
  if (path.startsWith('/training-programs/maryland') || path.startsWith('/schools/maryland')) return <MarylandSchoolsPage />;
  if (path.startsWith('/training-programs/')) return <TrainingOrganizationPage />;
  if (path.startsWith('/school-auth')) return <SchoolAuth />;
  if (path.startsWith('/school-dashboard')) return <SchoolDashboard />;
  if (path.startsWith('/school/')) return <SchoolProgramPage />;
  if (path.startsWith('/privacy-policy')) return <LegalPage kind="privacy" />;
  if (path.startsWith('/terms-of-service')) return <LegalPage kind="terms" />;
  if (path.startsWith('/app')) return <EmployerWorkspace />;
  if (path === '/me' || path.startsWith('/me/')) return <CaregiverDashboard />;
  if (path.startsWith('/admin')) return <AdminConsole />;
  if (path === '/login' || path === '/signup') return <LoginPage />;
  if (path === '/signin') return <SignInLinkPage />;
  if (path === '/welcome') return <WelcomeRedirect />;
  return null;
}

export function App() {
  const path=window.location.pathname;
  const page=routePage(path);
  if (page) return <Suspense fallback={<div className="page-loading" aria-busy="true" />}>{page}</Suspense>;
  // The Worker answers unknown paths with a 404 status; match it instead of showing the homepage.
  if (path !== '/' && path !== '/index.html') return <NotFound />;
  return <Home />;
}

function NotFound(){
  return <div>
    <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/caregiver-jobs/maryland">Caregiver jobs</a><a href="/hire-caregivers/maryland">For employers</a><AccountLink /></nav></div></header>
    <main className="section"><div className="wrap">
      <h1>Page not found</h1>
      <p>That page doesn’t exist. Try <a className="text-link" href="/">the CareJoys home page</a>, <a className="text-link" href="/caregiver-jobs/maryland">caregiver jobs</a>, or <a className="text-link" href="/hire-caregivers/maryland">hiring caregivers</a>.</p>
    </div></main>
  </div>;
}

function Home() {
  const [form, setForm] = useState<FormKind>(() => new URLSearchParams(window.location.search).get('hire') === '1' ? 'employer' : null);
  const [employerPreset, setEmployerPreset] = useState<EmployerPreset>({});

  function handleHeroSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setEmployerPreset({
      role: String(fd.get('role') || ''),
      zip: String(fd.get('location') || '')
    });
    setForm('employer');
  }

  return <div>
    <header className="nav">
      <div className="wrap nav-inner">
        <a className="brand" href="/">CareJoys</a>
        <nav className="navlinks">
          <a className="hide-sm" href="/about">How it works</a>
          <a className="hide-sm" href="/caregiver-jobs/maryland">Caregiver jobs</a>
          <a className="hide-sm" href="/training-programs/maryland">Training programs</a>
          <AccountLink />
          <a href="/hire-caregivers/maryland">For employers</a>
          <button id="nav-primary" onClick={() => { setEmployerPreset({}); setForm('employer'); }}>Find caregivers</button>
        </nav>
      </div>
    </header>

    <main>
      <section className="hero">
        <div className="wrap">
          <h1>
            <span className="hero-title-line">Caregiver recruiting in Maryland.</span>
            <span className="hero-title-line">Interviews ready for you.</span>
          </h1>
          <p>CareJoys helps Maryland home-care agencies and employers match with local caregivers ready to work.</p>
          <form className="search" onSubmit={handleHeroSearch}>
            <select name="role" defaultValue="">
              <option value="">All caregiver roles</option>
              <option value="CNA">CNA</option>
              <option value="GNA">GNA</option>
              <option value="HHA">HHA</option>
              <option value="PCA">PCA</option>
              <option value="Caregiver">Caregiver</option>
            </select>
            <input name="location" placeholder="Hiring ZIP code" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} aria-label="Hiring ZIP code" />
            <button className="btn" type="submit">Find caregivers</button>
          </form>
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <h2>From hiring need to interview</h2>
          <div className="jobs">
            <div className="job">
              <div><h3>Find the right local caregivers</h3><div className="meta">Search by role, geography, shift, pay expectations, commute, and availability freshness.</div><div className="job-tags"><span className="pill">Fresh talent network</span></div></div>
              <div className="meta">01</div>
            </div>
            <div className="job">
              <div><h3>Confirm who is actually interested</h3><div className="meta">CareJoys is designed to reactivate candidates and confirm fit before your team spends time chasing them.</div><div className="job-tags"><span className="pill">Automated activation</span></div></div>
              <div className="meta">02</div>
            </div>
            <div className="job">
              <div><h3>Move qualified people into interviews</h3><div className="meta">Track matched, contacted, interested, qualified, interview, and hired stages in one simple recruiting workspace.</div><div className="job-tags"><span className="pill">Interview-ready</span></div></div>
              <div className="meta">03</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="caregivers">
        <div className="wrap">
          <h2>For caregivers</h2>
          <div className="jobcta">
            <div>
              <strong>One profile. Better local opportunities.</strong>
              <span>Tell CareJoys where you work, what shifts you want, and when you are looking. Keep your availability current without rebuilding a resume for every employer.</span>
            </div>
            <a className="btn" href="/caregiver-jobs/maryland">Find jobs</a>
          </div>
        </div>
      </section>

      <section className="section" id="schools">
        <div className="wrap">
          <h2>For caregiver training programs</h2>
          <div className="jobs">
            <div className="job">
              <div><h3>Turn graduation day into a hiring pipeline</h3><div className="meta">CNA/GNA and other direct-care training programs can introduce graduating cohorts to local employers and track placement outcomes.</div><div className="job-tags"><span className="pill">Free for schools</span><span className="pill">Cohort placement</span></div></div>
              <div className="school-home-actions"><a className="btn secondary" href="/training-programs/maryland">Find your Maryland program</a><button className="text-button" onClick={() => setForm('school')}>Program not listed? Request addition</button></div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Measure hires, not database size.</h2>
          <div className="jobs">
            <div className="job">
              <div><h3>Availability is a live signal</h3><div className="meta">Older caregiver profiles can remain discoverable, but their availability is clearly labeled unconfirmed until they refresh it. Recent confirmations rank higher.</div></div>
              <span className="pill">Freshness shown explicitly</span>
            </div>
            <div className="job">
              <div><h3>Every recruiting interaction improves the network</h3><div className="meta">Responses, preferences, interviews, and hires create a longitudinal workforce record rather than a one-time lead.</div></div>
              <span className="pill">Persistent workforce graph</span>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer className="footer">
      <div className="wrap">CareJoys · Maryland caregiver recruiting and placement · <a href="/hire-caregivers/maryland">For employers</a> · <a href="/caregiver-jobs/maryland">Caregiver jobs</a> · <a href="/training-programs/maryland">Training programs</a> · <a href="/about">About</a> · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div>
    </footer>

    {form && <IntakeModal kind={form} employerPreset={employerPreset} onClose={() => setForm(null)} />}
  </div>
}