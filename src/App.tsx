import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { isNationalJobsPath, parseJobsHubPath } from './usStates';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { useCaregiverAuth } from './caregiverAuth';
import { homePath, lastDashboard } from './dashboardHome';

// Each page is its own chunk so a visitor only downloads the page they opened.
const named=<K extends string>(load:()=>Promise<Record<K,ComponentType<any>>>,name:K)=>lazy(()=>load().then(m=>({default:m[name]})));
const EmployerWorkspace=named(()=>import('./EmployerWorkspace'),'EmployerWorkspace');
const CaregiverActivation=named(()=>import('./CaregiverActivation'),'CaregiverActivation');
const EmployerAuth=named(()=>import('./EmployerAuth'),'EmployerAuth');
const CandidateResponse=named(()=>import('./CandidateResponse'),'CandidateResponse');
const LegalPage=named(()=>import('./LegalPage'),'LegalPage');
const AgencyClaim=named(()=>import('./AgencyClaim'),'AgencyClaim');
const CaregiverJobsHub=named(()=>import('./CaregiverJobsHub'),'CaregiverJobsHub');
const SchoolProgramPage=named(()=>import('./SchoolPortal'),'SchoolProgramPage');
const SchoolAuth=named(()=>import('./SchoolPortal'),'SchoolAuth');
const SchoolDashboard=named(()=>import('./SchoolPortal'),'SchoolDashboard');
const MarylandSchoolsPage=named(()=>import('./MarylandSchoolsPage'),'MarylandSchoolsPage');
const TrainingOrganizationPage=named(()=>import('./TrainingOrganizationPage'),'TrainingOrganizationPage');
const EmployerRecruitingPage=named(()=>import('./PublicInfoPages'),'EmployerRecruitingPage');
const AboutCareJoysPage=named(()=>import('./PublicInfoPages'),'AboutCareJoysPage');
const PricingPage=named(()=>import('./PublicInfoPages'),'PricingPage');
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
const FindCaregiversPage=named(()=>import('./IntakePage'),'FindCaregiversPage');
const AddTrainingProgramPage=named(()=>import('./IntakePage'),'AddTrainingProgramPage');

function routePage(path:string){
  if (/^\/hire-caregivers\/[^/]+\/?$/.test(path)) return <EmployerRecruitingPage />;
  if (path.startsWith('/caregiver-resume')) return <CaregiverResumePage />;
  if (path.startsWith('/jobs/')) return <CaregiverJobPage />;
  if (path.startsWith('/resources/how-to-become-a-caregiver-in-maryland')) return <HowToBecomeCaregiverMarylandPage />;
  if (path === '/about' || path.startsWith('/about/')) return <AboutCareJoysPage />;
  if (path === '/pricing') return <PricingPage />;
  if (path.startsWith('/activate')) return <CaregiverActivation />;
  if (path.startsWith('/auth')) return <EmployerAuth />;
  if (path.startsWith('/respond')) return <CandidateResponse />;
  if (path.startsWith('/confirm-interest')) return <ConfirmInterest />;
  if (path === '/agent') return <AgentSetupPage />;
  if (path.startsWith('/agency')) return <AgencyClaim />;
  if (isNationalJobsPath(path) || parseJobsHubPath(path) || path.startsWith('/join/')) return <CaregiverJobsHub />;
  if (path.startsWith('/training-programs/maryland') || path.startsWith('/schools/maryland')) return <MarylandSchoolsPage />;
  if (path.startsWith('/training-programs/')) return <TrainingOrganizationPage />;
  if (path.startsWith('/school-auth')) return <SchoolAuth />;
  if (path.startsWith('/school-dashboard')) return <SchoolDashboard />;
  if (path.startsWith('/school/')) return <SchoolProgramPage />;
  if (path.startsWith('/privacy-policy')) return <LegalPage kind="privacy" />;
  if (path.startsWith('/terms-of-service')) return <LegalPage kind="terms" />;
  if (path.startsWith('/app')) return <EmployerWorkspace />;
  if (path === '/dashboard' || path.startsWith('/dashboard/')) return <CaregiverDashboard />;
  if (path.startsWith('/admin')) return <AdminConsole />;
  if (path === '/login' || path === '/signup') return <LoginPage />;
  if (path === '/signin') return <SignInLinkPage />;
  if (path === '/welcome') return <WelcomeRedirect />;
  if (path === '/hire-caregivers' || path === '/find-caregivers') return <FindCaregiversPage />;
  if (path === '/add-training-program') return <AddTrainingProgramPage />;
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
    <SiteHeader/>
    <main className="section not-found"><div className="wrap">
      <div className="modal-kicker">404</div>
      <h1>Page not found</h1>
      <p>That page doesn’t exist. Try <a className="text-link" href="/">the CareJoys home page</a>, <a className="text-link" href="/caregiver-jobs">caregiver jobs</a>, or <a className="text-link" href="/hire-caregivers">hiring caregivers</a>.</p>
    </div></main>
    <SiteFooter/>
  </div>;
}

function Home() {
  const auth=useCaregiverAuth();
  // The Worker already redirects signed-in visitors; this catches a home page the browser served from its cache.
  useEffect(()=>{
    if(!auth.loading&&auth.isAuthenticated)window.location.replace(homePath(auth.roles,lastDashboard()));
  },[auth.loading,auth.isAuthenticated]);
  return <div>
    <SiteHeader audience="employer"/>

    <main>
      <section className="hero">
        <div className="wrap">
          <h1>
            <span className="hero-title-line">Caregiver recruiting near you.</span>{' '}
            <span className="hero-title-line">Interviews ready for you.</span>
          </h1>
          <p>CareJoys helps home-care agencies and employers match with local caregivers ready to work.</p>
          <form className="search" action="/hire-caregivers" method="get">
            <select name="role" defaultValue="">
              <option value="">All caregiver roles</option>
              <option value="CNA">CNA</option>
              <option value="GNA">GNA</option>
              <option value="HHA">HHA</option>
              <option value="PCA">PCA</option>
              <option value="Caregiver">Caregiver</option>
            </select>
            <input name="zip" placeholder="Hiring ZIP code" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} aria-label="Hiring ZIP code" />
            <button className="btn" type="submit">Hire caregivers</button>
          </form>
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <div className="modal-kicker">How CareJoys works</div>
          <h2>From hiring need to interview</h2>
          <div className="steps">
            <div className="step">
              <div className="modal-kicker">1 · Find</div>
              <h3>Find the right local caregivers</h3>
              <p className="meta">Search by role, geography, shift, pay expectations, commute, and availability freshness.</p>
              <div className="job-tags"><span className="pill">Fresh talent network</span></div>
            </div>
            <div className="step">
              <div className="modal-kicker">2 · Confirm</div>
              <h3>Confirm who is actually interested</h3>
              <p className="meta">CareJoys is designed to reactivate candidates and confirm fit before your team spends time chasing them.</p>
              <div className="job-tags"><span className="pill">Automated activation</span></div>
            </div>
            <div className="step">
              <div className="modal-kicker">3 · Interview</div>
              <h3>Move qualified people into interviews</h3>
              <p className="meta">Track matched, contacted, interested, qualified, interview, and hired stages in one simple recruiting workspace.</p>
              <div className="job-tags"><span className="pill">Interview-ready</span></div>
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
            <a className="btn" href="/caregiver-jobs">Find jobs</a>
          </div>
        </div>
      </section>

      <section className="section" id="schools">
        <div className="wrap">
          <h2>For caregiver training programs</h2>
          <div className="jobs">
            <div className="job">
              <div><h3>Turn graduation day into a hiring pipeline</h3><div className="meta">CNA/GNA and other direct-care training programs can introduce graduating cohorts to local employers and track placement outcomes.</div><div className="job-tags"><span className="pill">Free for schools</span><span className="pill">Cohort placement</span></div></div>
              <div className="school-home-actions"><a className="btn secondary" href="/training-programs/maryland">Find your Maryland program</a><a className="text-button" href="/add-training-program">Program not listed? Request addition</a></div>
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

    <SiteFooter/>

  </div>
}