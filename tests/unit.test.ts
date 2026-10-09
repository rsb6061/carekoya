import { availabilityByDay, jobFit, jobConflict } from '../src/caregiverApi';
import { describe, expect, it } from 'vitest';
import { boundingBox, fallbackStateForZip, haversineMiles, normalizeZip } from '../src/geo';
import { commuteRadiusMiles, freshnessLabel, scoreCandidate } from '../src/matching';
import { dailyCap, outreachEnabled, remainingToday } from '../src/outreach';
import { adminEmails, adminFromRequest, secretsMatch } from '../src/admin';
import { withUnsubscribe, caregiverActivationEmail } from '../src/email';
import { stateForZipPrefix } from '../src/usStates';
import { siteEmail } from '../src/agencyFeatures';
import { allowedApplyNavigation, applyProfileFromCaregiver, applyStartUrl, classifyApplicationQuestion, detectApplyProvider, jobSiteName } from '../src/applyAgentRules';
import { locationStringParts, looksLikeMarketingPage, mentionsOtherStates, mentionsState, normalizeCity, notAJobPosting, publicationDecision, canonicalJobIdentity } from '../src/jobDiscovery';

const NOW=Date.parse('2026-10-01T12:00:00Z');
const BALTIMORE={lat:39.2946,lng:-76.6252};   // 21201
const TOWSON={lat:39.4015,lng:-76.6019};      // 21204, ~7 mi
const DC={lat:38.9,lng:-77.03};               // ~35 mi

describe('geo', ()=>{
  it('computes great-circle miles', ()=>{
    expect(haversineMiles(BALTIMORE,BALTIMORE)).toBe(0);
    expect(haversineMiles(BALTIMORE,TOWSON)).toBeGreaterThan(6);
    expect(haversineMiles(BALTIMORE,TOWSON)).toBeLessThan(9);
    expect(haversineMiles(BALTIMORE,DC)).toBeGreaterThan(30);
    expect(haversineMiles(BALTIMORE,DC)).toBeLessThan(40);
  });
  it('bounding box contains every point within the radius', ()=>{
    const box=boundingBox(BALTIMORE,10);
    expect(TOWSON.lat).toBeGreaterThan(box.minLat);
    expect(TOWSON.lat).toBeLessThan(box.maxLat);
    expect(DC.lat).toBeLessThan(box.minLat);
  });
  it('normalizes ZIPs and falls back to Maryland prefixes', ()=>{
    expect(normalizeZip(' 21201-1234')).toBe('21201');
    expect(normalizeZip('abc')).toBe('');
    expect(fallbackStateForZip('21201')).toBe('MD');
    expect(fallbackStateForZip('10001')).toBe('');
  });
});

describe('employer required role matching',()=>{
  it('does not match an unrelated worker just because of location and recency',()=>{
    const opening={role:'CNA',zip:'21201',state:'MD',geo_lat:39.29,geo_lng:-76.61};
    const unrelated={role:'DSP',zip:'21201',state:'MD',geo_lat:39.29,geo_lng:-76.61,work_status:'actively_looking',last_confirmed_at:'2026-10-01T12:00:00Z'};
    expect(scoreCandidate(opening,unrelated,Date.parse('2026-10-02T12:00:00Z')).score).toBe(0);
    expect(scoreCandidate(opening,{...unrelated,role:'CNA'},Date.parse('2026-10-02T12:00:00Z')).score).toBeGreaterThan(0);
  });
});

describe('scoreCandidate', ()=>{
  const opening={role:'CNA',zip:'21201',state:'MD',geo_lat:BALTIMORE.lat,geo_lng:BALTIMORE.lng,shift_preferences:'nights'};
  const fresh={role:'CNA',work_status:'actively_looking',last_confirmed_at:'2026-09-30T12:00:00Z',shift_preferences:'Nights, weekends'};

  it('scores a nearby, fresh, credentialed caregiver highly with a distance reason', ()=>{
    const r=scoreCandidate(opening,{...fresh,geo_lat:TOWSON.lat,geo_lng:TOWSON.lng},NOW);
    expect(r.score).toBe(22+40+25+10);
    expect(r.reasons).toContain('7 mi away');
    expect(r.distanceMiles).toBeGreaterThan(6);
  });
  it('excludes caregivers outside their commute radius', ()=>{
    const r=scoreCandidate(opening,{...fresh,geo_lat:DC.lat,geo_lng:DC.lng,travel_distance_miles:20},NOW);
    expect(r.score).toBe(0);
    expect(r.reasons).toEqual(['outside commute radius']);
  });
  it('honors a long commute radius', ()=>{
    expect(scoreCandidate(opening,{...fresh,geo_lat:DC.lat,geo_lng:DC.lng,travel_distance_miles:50},NOW).score).toBeGreaterThan(0);
  });
  it('falls back to ZIP/city/state when coordinates are missing and rejects other states', ()=>{
    const noGeo={role:'CNA',zip:'21201',state:'MD'};
    expect(scoreCandidate(noGeo,{...fresh,zip:'21201',state:'MD'},NOW).reasons).toContain('same ZIP');
    expect(scoreCandidate(noGeo,{...fresh,zip:'90001',state:'CA'},NOW).score).toBe(0);
  });
  it('gives related-credential credit through aliases', ()=>{
    const r=scoreCandidate({...opening,role:'caregiver'},{role:'HHA',geo_lat:BALTIMORE.lat,geo_lng:BALTIMORE.lng},NOW);
    expect(r.reasons).toContain('related credential');
  });
  it('clamps commute radius', ()=>{
    expect(commuteRadiusMiles({})).toBe(25);
    expect(commuteRadiusMiles({travel_distance_miles:1})).toBe(5);
    expect(commuteRadiusMiles({travel_distance_miles:500})).toBe(100);
  });
  it('labels freshness', ()=>{
    expect(freshnessLabel('actively_looking','2026-09-28T12:00:00Z',NOW)).toBe('Confirmed 3d ago');
    expect(freshnessLabel('actively_looking','2026-05-01T12:00:00Z',NOW)).toBe('Availability unconfirmed');
    expect(freshnessLabel('not_looking',null,NOW)).toBe('Not currently looking');
  });
});

describe('outreach caps', ()=>{
  it('is off unless explicitly enabled', ()=>{
    expect(outreachEnabled({})).toBe(false);
    expect(outreachEnabled({OUTREACH_ENABLED:'false'})).toBe(false);
    expect(outreachEnabled({OUTREACH_ENABLED:'TRUE'})).toBe(true);
  });
  it('parses caps with defaults, zero to pause, and a ceiling', ()=>{
    expect(dailyCap({},'reactivation')).toBe(50);
    expect(dailyCap({},'agency_teasers')).toBe(10);
    expect(dailyCap({REACTIVATION_DAILY_CAP:'0'},'reactivation')).toBe(0);
    expect(dailyCap({AGENCY_TEASER_DAILY_CAP:'9999'},'agency_teasers')).toBe(500);
    expect(dailyCap({REACTIVATION_DAILY_CAP:'nope'},'reactivation')).toBe(50);
    expect(remainingToday(50,48)).toBe(2);
    expect(remainingToday(10,12)).toBe(0);
  });
});

describe('admin auth', ()=>{
  it('parses the admin allowlist', ()=>{
    expect(adminEmails({ADMIN_EMAILS:'A@x.com, b@y.org;not-an-email'})).toEqual(['a@x.com','b@y.org']);
  });
  it('compares secrets', async()=>{
    expect(await secretsMatch('abc','abc')).toBe(true);
    expect(await secretsMatch('abc','abd')).toBe(false);
    expect(await secretsMatch('','')).toBe(false);
  });
  it('accepts the admin bearer token and rejects everything else', async()=>{
    const req=(auth?:string)=>new Request('https://carejoys.com/api/admin/overview',{headers:auth?{authorization:auth}:{}});
    expect(await adminFromRequest(req('Bearer s3cret'),{ADMIN_TOKEN:'s3cret'})).toEqual({via:'token',email:''});
    expect(await adminFromRequest(req('Bearer wrong'),{ADMIN_TOKEN:'s3cret'})).toBeNull();
    expect(await adminFromRequest(req(),{})).toBeNull();
  });
});

describe('email', ()=>{
  it('adds an unsubscribe link to html and text', ()=>{
    const msg=withUnsubscribe(caregiverActivationEmail('Ana','https://carejoys.com/activate?token=x'),'https://carejoys.com/api/unsubscribe?token=y');
    expect(msg.html).toContain('https://carejoys.com/api/unsubscribe?token=y');
    expect(msg.html.indexOf('Unsubscribe')).toBeLessThan(msg.html.lastIndexOf('</div>'));
    expect(msg.text).toContain('Unsubscribe: https://carejoys.com/api/unsubscribe?token=y');
  });
});

import { billingEnabled, freeContacts, verifyStripeSignature } from '../src/billing';

describe('billing', ()=>{
  it('is inert until Stripe is configured', ()=>{
    expect(billingEnabled({})).toBe(false);
    expect(billingEnabled({STRIPE_SECRET_KEY:'sk'})).toBe(false);
    expect(billingEnabled({STRIPE_SECRET_KEY:'sk',STRIPE_PRICE_ID:'price'})).toBe(true);
    expect(freeContacts({})).toBe(5);
    expect(freeContacts({FREE_CONTACTS:'0'})).toBe(0);
  });
  it('verifies Stripe webhook signatures', async()=>{
    const secret='whsec_test',payload='{"type":"ping"}',t=1_700_000_000;
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${t}.${payload}`)))).map(b=>b.toString(16).padStart(2,'0')).join('');
    expect(await verifyStripeSignature(payload,`t=${t},v1=${sig}`,secret,t+10)).toBe(true);
    expect(await verifyStripeSignature(payload+' ',`t=${t},v1=${sig}`,secret,t+10)).toBe(false);
    expect(await verifyStripeSignature(payload,`t=${t},v1=${sig}`,secret,t+1000)).toBe(false);
    expect(await verifyStripeSignature(payload,`t=${t},v1=${sig}`,'other',t)).toBe(false);
  });
});

import { employmentTypeSchema, jobPageTitle, jobPostingJsonLd, payText, trimAtWord } from '../src/seo';
import { parseJobsHubPath, slugify, usState } from '../src/usStates';
import { emailMatchesAgencyDomain, maskEmail, normalizeDomain } from '../src/agencySelfServe';

describe('seo helpers', ()=>{
  it('trims at a word boundary', ()=>{
    expect(trimAtWord('Certified Nursing Assistant overnight shift',30)).toBe('Certified Nursing Assistant');
    expect(trimAtWord('short',30)).toBe('short');
  });
  it('drops the employer before cutting the job title', ()=>{
    expect(jobPageTitle('CNA','Acme Care')).toBe('CNA | Acme Care | CareJoys');
    expect(jobPageTitle('Home Health Aide – weekend days','A Very Long Home Care Agency Name LLC of Maryland')).toBe('Home Health Aide – weekend days | CareJoys');
  });
  it('maps employment types and pay', ()=>{
    expect(employmentTypeSchema('Full-time, Part time')).toEqual(['FULL_TIME','PART_TIME']);
    expect(employmentTypeSchema('PRN')).toEqual(['PER_DIEM']);
    expect(employmentTypeSchema('')).toEqual([]);
    expect(payText(18,22,'hour')).toBe('$18–$22/hr');
    expect(payText(0,40000,'year')).toBe('Up to $40,000/yr');
  });
  it('builds Google for Jobs markup', ()=>{
    const posting=jobPostingJsonLd({id:'job_1',title:'CNA &amp; GNA',employer_name:'Acme Care',city:'Baltimore',state:'MD',zip:'21201',
      employment_type:'Full-time',pay_min:18,pay_max:22,pay_period:'hour',description_text:'Copied employer text',summary_text:'Help <clients> at home • Valid license',date_posted:'2026-09-20',
      last_checked_at:'2026-09-30 10:00:00'},{primary_website:'https://acme.example'}) as any;
    expect(posting['@type']).toBe('JobPosting');
    expect(posting.title).toBe('CNA & GNA');
    expect(posting.datePosted).toBe('2026-09-20');
    expect(posting.validThrough).toBe('2026-10-30T10:00:00.000Z');
    expect(posting.hiringOrganization).toEqual({'@type':'Organization',name:'Acme Care',sameAs:'https://acme.example'});
    expect(posting.jobLocation.address).toMatchObject({addressLocality:'Baltimore',addressRegion:'MD',postalCode:'21201',addressCountry:'US'});
    expect(posting.baseSalary.value).toEqual({'@type':'QuantitativeValue',minValue:18,maxValue:22,unitText:'HOUR'});
    expect(posting.employmentType).toBe('FULL_TIME');
    expect(posting.description).toBe('<p>Help &lt;clients&gt; at home</p><ul><li>Valid license</li></ul>');
  });
});

describe('us states', ()=>{
  it('resolves slugs and codes', ()=>{
    expect(usState('new-york')?.code).toBe('NY');
    expect(usState('va')?.slug).toBe('virginia');
    expect(usState('narnia')).toBeNull();
    expect(slugify('Ellicott City')).toBe('ellicott-city');
  });
  it('parses hub paths and rejects non-canonical ones', ()=>{
    expect(parseJobsHubPath('/caregiver-jobs/maryland')).toEqual({state:usState('MD'),citySlug:''});
    expect(parseJobsHubPath('/caregiver-jobs/maryland/baltimore')?.citySlug).toBe('baltimore');
    expect(parseJobsHubPath('/caregiver-jobs/md')).toBeNull();
    expect(parseJobsHubPath('/caregiver-jobs/narnia')).toBeNull();
  });
});

describe('agency self-serve claim helpers', ()=>{
  it('normalizes domains from emails and URLs', ()=>{
    expect(normalizeDomain('https://www.Acme-Care.com/careers')).toBe('acme-care.com');
    expect(normalizeDomain('pat@acme-care.com')).toBe('acme-care.com');
    expect(normalizeDomain('not a domain')).toBe('');
  });
  it('only counts work email at the agency domain', ()=>{
    const org={primary_domain:'acme-care.com'};
    expect(emailMatchesAgencyDomain('pat@acme-care.com',org)).toBe(true);
    expect(emailMatchesAgencyDomain('pat@hr.acme-care.com',org)).toBe(true);
    expect(emailMatchesAgencyDomain('pat@notacme-care.com',org)).toBe(false);
    expect(emailMatchesAgencyDomain('pat@gmail.com',{primary_domain:'gmail.com'})).toBe(false);
    expect(emailMatchesAgencyDomain('pat@acme-care.com',{})).toBe(false);
  });
  it('masks emails', ()=>{
    expect(maskEmail('jane@agency.com')).toBe('j***@agency.com');
  });
});

describe('national agency helpers', ()=>{
  it('maps ZIP prefixes to states', ()=>{
    expect(stateForZipPrefix('21201')).toBe('MD');
    expect(stateForZipPrefix('23219-1234')).toBe('VA');
    expect(stateForZipPrefix('20001')).toBe('DC');
    expect(stateForZipPrefix('22030')).toBe('VA');
    expect(stateForZipPrefix('25301')).toBe('WV');
    expect(stateForZipPrefix('90210')).toBe('CA');
    expect(stateForZipPrefix('00901')).toBe('');
    expect(stateForZipPrefix('abc')).toBe('');
  });
  it('takes an email only from the agency\'s own domain', ()=>{
    expect(siteEmail('<a href="mailto:Jobs@SunriseCare.com">x</a> sentry@wixpress.com','sunrisecare.com')).toBe('jobs@sunrisecare.com');
    expect(siteEmail('logo@2x.png support@wix.com','sunrisecare.com')).toBe('');
    expect(siteEmail('hr@mail.sunrisecare.com','sunrisecare.com')).toBe('hr@mail.sunrisecare.com');
  });
});

describe('job location by agency state', ()=>{
  const VA={code:'VA',name:'Virginia'},MD={code:'MD',name:'Maryland'},IN={code:'IN',name:'Indiana'};
  it('strips state suffixes from cities without eating real words', ()=>{
    expect(normalizeCity('Richmond, VA')).toBe('Richmond');
    expect(normalizeCity('Richmond, Virginia')).toBe('Richmond');
    expect(normalizeCity('Baltimore Maryland')).toBe('Baltimore');
    expect(normalizeCity('BALTIMORE MD')).toBe('Baltimore');
    expect(normalizeCity('Bel Air')).toBe('Bel Air');
    expect(normalizeCity('Ellicott City')).toBe('Ellicott City');
  });
  it('reads any state from ATS location strings', ()=>{
    expect(locationStringParts('Richmond, VA 23219')).toEqual({city:'Richmond',state:'VA',zip:'23219'});
    expect(locationStringParts('Towson, Maryland')).toEqual({city:'Towson',state:'MD',zip:''});
    expect(locationStringParts('Remote')).toEqual({city:'',state:'',zip:''});
  });
  it('recognizes state mentions safely', ()=>{
    expect(mentionsState('Now hiring in Norfolk, VA',VA)).toBe(true);
    expect(mentionsState('Serving Virginia families',VA)).toBe(true);
    expect(mentionsState('Charleston, West Virginia',VA)).toBe(false);
    expect(mentionsState('Sign IN to apply',IN)).toBe(false);
    expect(mentionsState('Carmel, IN 46032',IN)).toBe(true);
    expect(mentionsState('Baltimore MD',MD)).toBe(true);
    expect(mentionsOtherStates('Offices in Richmond, VA and Raleigh, NC',VA)).toBe(true);
    expect(mentionsOtherStates('Offices in Richmond, VA',VA)).toBe(false);
  });
  it('publishes jobs with an explicit location in any state', ()=>{
    const job={sourceProvider:'x',sourceJobId:'',sourceUrl:'https://a.test/j',sourceListingUrl:'',title:'Home Health Aide',role:'HHA',city:'Richmond',state:'VA',zip:'',
      employmentType:'',payMin:null,payMax:null,descriptionText:'',classifierReason:'',confidence:95,datePosted:'',validThrough:''};
    expect(publicationDecision(job)).toEqual({publish:true,reason:'explicit_state_location'});
    expect(publicationDecision({...job,state:'',zip:'23219'}).publish).toBe(true);
    expect(publicationDecision({...job,state:'',zip:''})).toEqual({publish:false,reason:'missing_state_evidence'});
  });
  it('quarantines contradictory state/ZIP evidence before publishing',()=>{
    const job={sourceProvider:'generic_html',sourceJobId:'',sourceUrl:'https://agency.example/jobs/cna',sourceListingUrl:'https://agency.example/jobs',
      title:'CNA - Day shift',role:'CNA',city:'Baltimore',state:'MD',zip:'21201',employmentType:'',payMin:null,payMax:null,descriptionText:'',
      classifierReason:'',confidence:96,datePosted:'',validThrough:''};
    expect(publicationDecision({...job,state:'VA'}).reason).toBe('state_zip_mismatch');
    expect(publicationDecision(job).publish).toBe(true);
    expect(publicationDecision(job,{primary_website:'https://agency.example'}).publish).toBe(true);
    expect(publicationDecision({...job,sourceListingUrl:'https://different-franchise.example/jobs'},{primary_website:'https://agency.example'}).reason).toBe('source_employer_mismatch');
  });
  it('canonicalizes exact duplicates within an employer but separates distinct shifts or locations',()=>{
    const a=canonicalJobIdentity('Agency-1','CNA - Day Shift','BALTIMORE','MD','21201');
    expect(a).toBe(canonicalJobIdentity('agency-1','CNA - Day Shift','Baltimore','md','21201'));
    expect(a).not.toBe(canonicalJobIdentity('agency-2','CNA - Day Shift','Baltimore','MD','21201'));
    expect(a).not.toBe(canonicalJobIdentity('agency-1','CNA - Night Shift','Baltimore','MD','21201'));
  });
  it('never publishes expired requisitions and obvious non-job pages',()=>{
    const job={sourceProvider:'generic_html',sourceJobId:'',sourceUrl:'https://agency.example/jobs/cna',sourceListingUrl:'https://agency.example/jobs',
      title:'CNA - Day shift',role:'CNA',city:'Baltimore',state:'MD',zip:'21201',employmentType:'',payMin:null,payMax:null,descriptionText:'',
      classifierReason:'',confidence:96,datePosted:'',validThrough:'2020-01-01'};
    expect(publicationDecision(job).reason).toBe('expired');
    expect(publicationDecision({...job,validThrough:'',title:'Caregiver of the Year Award'}).reason).toBe('not_a_job_posting');
  });
  it('keeps training pages and councils off the jobs list but not jobs that mention training', ()=>{
    expect(notAJobPosting('Our CNA Leadership Council','https://www.genesiscareers.jobs/nurse-aide-training')).toBe(true);
    expect(notAJobPosting('Certified Nursing Assistant','https://www.genesiscareers.jobs/nurse-aide-training')).toBe(true);
    expect(notAJobPosting('CNA Training Program','https://a.test/jobs/123')).toBe(true);
    expect(notAJobPosting('CNA - Paid Training Provided','https://a.test/jobs/cna-paid-training-4821')).toBe(false);
    expect(notAJobPosting('Home Health Aide','https://a.test/careers/home-health-aide')).toBe(false);
  });
  it('keeps service and marketing pages from agency websites off the jobs list', ()=>{
    for(const t of ['Companion Care','Companion Care Services for Adults and Seniors','Caregiver of the Year Award','Finding the Perfect Caregiver',
      'Caregiver Careers at Village Caregiving','Become a Caregiver','Caregiver Resources','Home Health Aide Services','What Does a CNA Do?'])
      expect(looksLikeMarketingPage(t),t).toBe(true);
    for(const t of ['Home Health Aide (HHA)','Certified Nursing Assistant','Direct Support Professional (DSP)','Live-In Caregiver','CNA - Private Duty - Baltimore (Hourly)','Caregiver Needed!'])
      expect(looksLikeMarketingPage(t),t).toBe(false);
    expect(notAJobPosting('Companion Care','https://a.test/companion-care','generic_html')).toBe(true);
    expect(notAJobPosting('Companion Care','https://boards.greenhouse.io/a/jobs/1','greenhouse')).toBe(false);
  });
});

describe('apply for me rules', ()=>{
  it('recognizes only the job sites it can fill in, and stays on them', ()=>{
    expect(detectApplyProvider('https://recruiting.paylocity.com/Recruiting/Jobs/Details/123')).toBe('paylocity');
    expect(detectApplyProvider('https://careers-acme.icims.com/jobs/55/cna/job')).toBe('icims');
    expect(detectApplyProvider('https://acme.wd1.myworkdayjobs.com/x')).toBeNull();
    expect(detectApplyProvider('https://www.homecare.example/careers')).toBeNull();
    expect(detectApplyProvider('https://aris-at-home-inc.careerplug.com/jobs/3592578/apps/new')).toBe('careerplug');
    expect(detectApplyProvider('https://alliance-senior-care.careerplug.com/jobs?locale=en-US')).toBeNull();
    expect(detectApplyProvider('https://a-t-moore-health-care.careerplug.com/account')).toBeNull();
    expect(detectApplyProvider('https://affirmedhomecare.applytojob.com/apply/l745UJxX0Q/Home-Health-Aides')).toBe('jazzhr');
    expect(detectApplyProvider('https://amaraycares.applytojob.com/apply/jobs/details/13VaMRMriJ?&')).toBe('jazzhr');
    expect(detectApplyProvider('https://amaraycares.applytojob.com/apply')).toBeNull();
    expect(applyStartUrl('careerplug','https://acme.careerplug.com/jobs/3592578?src=x')).toBe('https://acme.careerplug.com/jobs/3592578/apps/new?src=x');
    expect(applyStartUrl('careerplug','https://acme.careerplug.com/jobs/3592578/apps/new')).toBe('https://acme.careerplug.com/jobs/3592578/apps/new');
    expect(allowedApplyNavigation('careerplug','https://acme.careerplug.com/jobs/1/apps/new','https://acme.careerplug.com/jobs/1')).toBe(true);
    expect(allowedApplyNavigation('jazzhr','https://other.applytojob.com/apply/x','https://acme.applytojob.com/apply/abcdef1/x')).toBe(false);
    expect(allowedApplyNavigation('icims','https://careers-acme.icims.com/apply','https://careers-acme.icims.com/jobs/55')).toBe(true);
    expect(allowedApplyNavigation('icims','https://careers-other.icims.com/apply','https://careers-acme.icims.com/jobs/55')).toBe(false);
    expect(applyStartUrl('lever','https://jobs.lever.co/acme/abc')).toBe('https://jobs.lever.co/acme/abc/apply');
    expect(jobSiteName('https://acme.wd1.myworkdayjobs.com/x')).toBe('Workday');
  });
  it('never answers demographic, background or signature questions', ()=>{
    for(const q of ['Have you ever been convicted of a crime?','Race / ethnicity','Electronic signature','Do you consent to a background check?','Date of birth'])
      expect(classifyApplicationQuestion(q).reusePolicy).toBe('never_auto');
    expect(classifyApplicationQuestion('First name').key).toBe('firstName');
    expect(classifyApplicationQuestion('Do you have an active CNA certification?').key).toBe('cnaCertified');
    expect(classifyApplicationQuestion('Do you have reliable transportation?').key).toBe('reliableTransportation');
    expect(classifyApplicationQuestion('Desired pay').reusePolicy).toBe('confirm_each_time');
  });
  it('builds answers from the profile and remembered answers, never guessing a no', ()=>{
    const p=applyProfileFromCaregiver({first_name:'Ana',last_name:'Lee',email:'ana@x.test',phone:'4105550100',zip:'21201',city:'Baltimore',state:'MD',certifications:'CNA, CPR',transportation:'Own car',years_experience:4},
      {workAuthorizationUs:'true',streetAddress:'1 Main St',cnaCertified:'false'});
    expect(p).toMatchObject({firstName:'Ana',cnaCertified:true,cprCertified:true,reliableTransportation:true,workAuthorizationUs:true,streetAddress:'1 Main St',yearsExperience:4});
    expect(applyProfileFromCaregiver({certifications:''},{}).cnaCertified).toBeNull();
  });
});

import { normalizePay, payLabel, tidyTitle } from '../src/jobFormat';
describe('job pay cleanup', () => {
  it('drops paycheck amounts tagged hourly and fixes mislabeled periods', () => {
    expect(payLabel({payMin:1104.57,payMax:1104.57,payPeriod:'hour'})).toBe('');
    expect(payLabel({payMin:17.99,payMax:null,payPeriod:'year'})).toBe('$17.99/hr');
    expect(payLabel({payMin:18,payMax:null,payPeriod:'hour'})).toBe('$18/hr');
    expect(payLabel({payMin:16,payMax:16,payPeriod:'hour'})).toBe('$16/hr');
    expect(payLabel({payMin:20,payMax:55,payPeriod:'hour'})).toBe('$20–$55/hr');
    expect(payLabel({payMin:45000,payMax:52000,payPeriod:'hour'})).toBe('$45,000–$52,000/yr');
    expect(payLabel({payMin:18,payMax:1800,payPeriod:'hour'})).toBe('$18/hr');
    expect(payLabel({payMin:22,payMax:18,payPeriod:''})).toBe('$18–$22/hr');
    expect(payLabel({payMin:900,payMax:1100,payPeriod:'week'})).toBe('$900–$1,100/wk');
    expect(payLabel({payMin:0,payMax:0,payPeriod:'hour'})).toBe('');
    expect(normalizePay(3,null,'hour')).toEqual({min:null,max:null,period:''});
  });
  it('repairs title casing', () => {
    expect(tidyTitle('CNA Caregiver in MaryLand')).toBe('CNA Caregiver in Maryland');
    expect(tidyTitle('HOME HEALTH AIDE - HHA')).toBe('Home Health Aide - HHA');
    expect(tidyTitle('Certified Nursing Assistant (CNA)')).toBe('Certified Nursing Assistant (CNA)');
  });
});

describe('jobFit', ()=>{
  const cna={role:'CNA',certifications:'CNA, CPR / First Aid',hourly_rate_min:18,employment_types:'full_time'};
  it('ranks jobs the caregiver is credentialed for above licensed jobs they are not', ()=>{
    const cnaJob=jobFit(cna,{role:'CNA',title:'CNA Days',pay_max:20},10,25);
    const rnJob=jobFit(cna,{role:'RN',title:'RN Case Manager',pay_max:45},2,25);
    const companion=jobFit(cna,{role:'Caregiver',title:'Companion Caregiver',pay_max:19},10,25);
    expect(cnaJob).toBeGreaterThan(companion);
    expect(companion).toBeGreaterThan(rnJob);
  });
  it('prefers jobs that meet the minimum pay and are closer', ()=>{
    expect(jobFit(cna,{role:'CNA',title:'CNA',pay_max:20},10,25)).toBeGreaterThan(jobFit(cna,{role:'CNA',title:'CNA',pay_max:15},10,25));
    expect(jobFit(cna,{role:'CNA',title:'CNA'},2,25)).toBeGreaterThan(jobFit(cna,{role:'CNA',title:'CNA'},20,25));
  });
});

describe('strict job suitability', ()=>{
  const caregiver={role:'CNA',certifications:'CNA, CPR',hourly_rate_min:21,shift_preferences:'Days',employment_types:'full_time'};
  it('excludes a licensed role the worker does not hold, not an ordinary caregiver role',()=>{
    expect(jobConflict(caregiver,{title:'RN Nurse',role:'RN'})).toBe('required credential missing');
    expect(jobConflict(caregiver,{title:'Companion caregiver',role:'Caregiver'})).toBeNull();
    expect(jobConflict(caregiver,{title:'CNA / RN caregiver',role:'CNA'})).toBeNull();
  });
  it('honors the minimum hourly pay when a salary is explicitly advertised',()=>{
    expect(jobConflict(caregiver,{title:'CNA',role:'CNA',pay_max:20,pay_period:'hour'})).toBe('below minimum hourly pay');
    expect(jobConflict(caregiver,{title:'CNA',role:'CNA',pay_max:23,pay_period:'hour'})).toBeNull();
    expect(jobConflict(caregiver,{title:'CNA',role:'CNA',pay_max:null})).toBeNull();
    expect(jobConflict(caregiver,{title:'CNA',role:'CNA',pay_max:55000,pay_period:'year'})).toBeNull();
  });
  it('rejects explicitly incompatible shifts or employment types but keeps unknowns',()=>{
    expect(jobConflict(caregiver,{title:'CNA - Night Shift',role:'CNA'})).toBe('shift conflict');
    expect(jobConflict(caregiver,{title:'CNA - Day Shift',role:'CNA'})).toBeNull();
    expect(jobConflict(caregiver,{title:'CNA',role:'CNA',employment_type:'part_time'})).toBe('employment type conflict');
    expect(jobConflict(caregiver,{title:'CNA',role:'CNA',employment_type:''})).toBeNull();
    expect(jobConflict({...caregiver,shift_preferences:'Weekends only'},{title:'CNA - Weekdays only',role:'CNA'})).toBe('schedule conflict');
  });
  it('never ranks an explicitly ineligible job above a suitable one',()=>{
    expect(jobFit(caregiver,{title:'CNA - Night Shift',role:'CNA'},1,25)).toBeLessThan(0);
    expect(jobFit(caregiver,{title:'CNA - Days',role:'CNA',pay_max:25},5,25)).toBeGreaterThan(0);
  });
});

describe('profile list fields', ()=>{
  it('reads legacy JSON, mixed and comma text the same way', async ()=>{
    const { cleanList, listText } = await import('../src/listField');
    expect(listText('["CPR/First Aid", "Driver\'s License"], CNA')).toBe("CPR/First Aid, Driver's License, CNA");
    expect(listText('["English"], English, Spanish')).toBe('English, Spanish');
    expect(cleanList('[]')).toEqual([]);
    expect(cleanList('CNA, HHA')).toEqual(['CNA','HHA']);
    expect(cleanList(['CNA','cna',' BLS '])).toEqual(['CNA','BLS']);
  });
});

describe('job summaries', ()=>{
  it('turns the model output into the lead and bullets the job page renders', async ()=>{
    const { parseSummary } = await import('../src/jobSummary');
    expect(parseSummary('Here is the summary:\nHome care aide role supporting seniors in Rockport.\n- Help with bathing and meals\n* Driver license required\n\n1. Weekend shifts')).toBe('Home care aide role supporting seniors in Rockport. • Help with bathing and meals • Driver license required • Weekend shifts');
    expect(parseSummary('- only bullets')).toBeNull();
    expect(parseSummary('NO_DETAILS')).toBe('');
  });
});

describe('availabilityByDay', ()=>{
  it('groups neighboring days with the same shifts', ()=>{
    const days={mon:['morning'],tue:['morning'],wed:['morning'],thu:['morning'],fri:['morning'],sat:['overnight'],sun:['overnight']};
    expect(availabilityByDay({days,liveIn:false})).toBe('Mon–Fri: mornings · Sat–Sun: overnights');
    expect(availabilityByDay({days:{...days,wed:[]},liveIn:false})).toBe('Mon–Tue: mornings · Thu–Fri: mornings · Sat–Sun: overnights');
    expect(availabilityByDay({days:{mon:[],tue:[],wed:[],thu:[],fri:[],sat:[],sun:[]},liveIn:true})).toBe('');
  });
});
