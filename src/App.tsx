import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { HomeJobPreview } from './HomeJobPreview';
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
    <SiteHeader audience="caregiver"/>

    <main>
      <section className="hero">
        <div className="wrap">
          <h1>
            <span className="hero-title-line">Find better-paying caregiver and CNA jobs near you.</span>
          </h1>
          <p>One profile. Personalized matches. Always free. Preview local jobs without a resume or contact details.</p>
          <HomeJobPreview/>
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <div className="modal-kicker">How CareJoys works</div>
          <h2>From finding work to your next opportunity</h2>
          <div className="steps">
            <div className="step">
              <div className="modal-kicker">1 · Find</div>
              <h3>Preview nearby jobs</h3>
              <p className="meta">Start with your ZIP and role. Compare real local openings before creating a profile.</p>
              <div className="job-tags"><span className="pill">No signup required</span></div>
            </div>
            <div className="step">
              <div className="modal-kicker">2 · Confirm</div>
              <h3>Create one reusable profile</h3>
              <p className="meta">Tell CareJoys your pay, commute and schedule preferences. Uploading a resume is optional.</p>
              <div className="job-tags"><span className="pill">Resume optional</span></div>
            </div>
            <div className="step">
              <div className="modal-kicker">3 · Get matched</div>
              <h3>Return to better matches</h3>
              <p className="meta">Apply with your profile and choose whether to receive a free weekly email with suitable jobs.</p>
              <div className="job-tags"><span className="pill">Optional email alerts</span></div>
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
              <div><h3>Turn graduation day into a hiring pipeline</h3><div className="meta">CNA/GNA and other direct-care training programs can give graduates a free CareJoys link to nearby jobs and see how many get hired. In a training program? Ask your school for its CareJoys link.</div><div className="job-tags"><span className="pill">Free for schools</span><span className="pill">Cohort placement</span></div></div>
              <div className="school-home-actions"><a className="btn secondary" href="/training-programs/maryland">Find your Maryland program</a><a className="text-button" href="/add-training-program">Program not listed? Request addition</a></div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Better matches with your preferences.</h2>
          <div className="jobs">
            <div className="job">
              <div><h3>You decide who sees your profile</h3><div className="meta">Employers only see you after you verify your email and say you're looking. Pause anytime from your dashboard.</div></div>
              <span className="pill">Your choice</span>
            </div>
            <div className="job">
              <div><h3>Hiring caregivers?</h3><div className="meta">Home-care agencies, assisted living and senior-care communities can meet local caregivers who want the work. <a href="/pricing">See how it works</a>.</div></div>
              <span className="pill">For employers</span>
            </div>
          </div>
        </div>
      </section>
    </main>

    <SiteFooter/>

  </div>
}