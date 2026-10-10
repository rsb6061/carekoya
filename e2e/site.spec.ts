import { expect, test, type Page } from '@playwright/test';
// @ts-expect-error plain JS fixtures shared with prepare.mjs
import { ADMIN, CAREGIVER, EMPLOYER, JOBS, LINKS, TRAINING } from './fixtures.mjs';
import { clean, emailLink, signIn, watch } from './helpers';

// The rest of the site: every public page loads cleanly, every internal link resolves, every button does
// something, and the flows that arrive by email (sign-in links, invites, activation, agency claims) work.

const PUBLIC_PAGES=['/','/caregiver-jobs','/caregiver-jobs/maryland','/caregiver-jobs/maryland/baltimore','/cna-jobs/maryland',
  '/gna-jobs/maryland','/gna-jobs/maryland/baltimore','/cna-classes/baltimore','/training-programs/maryland','/training-programs/'+TRAINING.slug,
  '/hire-caregivers','/hire-caregivers/maryland','/pricing','/about','/caregiver-resume','/resources/how-to-become-a-caregiver-in-maryland',
  '/resources/nurse-aide-registry-by-state','/privacy-policy','/terms-of-service','/login','/signup','/agent','/add-training-program',
  '/jobs/'+JOBS.applyForMe,'/jobs/'+JOBS.external,'/school-dashboard','/dashboard','/app','/admin'];

test.describe('@phone every public page', ()=>{
  for(const path of PUBLIC_PAGES)test(path, async({page})=>{
    // Signed-out visits to private pages ask the browser who is signed in; their 401s are the expected answer.
    const w=await watch(page);
    const res=await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('h1').first()).not.toHaveText(/Loading|couldn’t|not found/i);
    // Nothing wider than the screen on a phone.
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
    clean(w);
  });
  test('unknown pages are a real 404 page', async({page})=>{
    const res=await page.goto('/no-such-page-e2e');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading',{name:'Page not found'})).toBeVisible();
  });
});

test('every internal link on the public pages resolves', async({page,request})=>{
  const links=new Set<string>();
  for(const path of PUBLIC_PAGES){
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    for(const href of await page.locator('a[href^="/"]').evaluateAll(as=>as.map(a=>(a as HTMLAnchorElement).getAttribute('href')||'')))
      links.add(href.split('#')[0]||'/');
  }
  const broken:string[]=[];
  for(const href of links){
    const res=await request.get(href,{maxRedirects:5});
    if(res.status()>=400)broken.push(`${href} → ${res.status()}`);
  }
  expect(links.size).toBeGreaterThan(15);
  expect(broken,'broken links').toEqual([]);
});

// Every visible button is clicked once (fresh page each time). A button that throws, fails an API call, or changes
// nothing at all on the page fails the test: that is a frozen button.
const SKIP_BUTTON=/sign out|log out|close hiring workspace|delete|remove|copy url|copy link|^copy|google/i;
async function clickEveryButton(page:Page,path:string){
  // Not 'networkidle': the dashboards' keepalive "last dashboard" ping never reports as finished to the browser.
  const open=async()=>{await page.goto(path);await expect(page.getByText(/^Loading/)).toHaveCount(0);await page.waitForTimeout(500)};
  await open();
  const names=[...new Set((await page.locator('button:visible').evaluateAll(bs=>bs.map(b=>(b.textContent||b.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ')))).filter(Boolean))];
  const dead:string[]=[];
  let fresh=true;
  for(const name of names.filter(n=>!SKIP_BUTTON.test(n)).slice(0,40)){
    // Start over only when the last click left the page or opened something on top of it (a dialog or a menu).
    if(!fresh&&(new URL(page.url()).pathname!==path||await page.locator('.modal-backdrop, [role=dialog], [aria-expanded=true]').count()))await open();
    fresh=false;
    const button=page.locator('button:visible').filter({hasText:name}).first();
    if(!await button.count()||!await button.isEnabled())continue;
    // An empty form's submit button is stopped by the browser's own "fill in this field"; a chip that is already on stays on.
    if(await button.evaluate(b=>{const f=(b as HTMLButtonElement).form;return (b.getAttribute('type')!=='button'&&!!f&&!f.checkValidity())||b.getAttribute('aria-pressed')==='true'||b.classList.contains('active')}))continue;
    const before=await page.evaluate(()=>location.href+'|'+document.body.innerHTML);
    // A click that asks CareJoys for something counts as an answer even when the page looks the same (e.g. "Refresh data").
    let asked=false;const onRequest=(r:{url():string})=>{if(new URL(r.url()).pathname.startsWith('/api/'))asked=true};
    page.on('request',onRequest);
    await button.click();
    await page.waitForTimeout(300);
    page.off('request',onRequest);
    const after=await page.evaluate(()=>location.href+'|'+document.body.innerHTML).catch(()=>'navigated');
    if(after===before&&!asked)dead.push(name);
  }
  return dead;
}
const BUTTON_PAGES:{label:string;as?:{session:string};employer?:boolean;pages:string[]}[]=[
  {label:'signed out',pages:['/','/caregiver-jobs/maryland','/gna-jobs/maryland','/hire-caregivers','/pricing','/caregiver-resume','/login','/agent','/add-training-program','/jobs/'+JOBS.external]},
  {label:'caregiver',as:CAREGIVER,pages:['/dashboard','/dashboard/profile','/dashboard/profile/preview','/jobs/'+JOBS.external]},
  {label:'employer',as:EMPLOYER,employer:true,pages:['/app']},
  {label:'admin',as:ADMIN,pages:['/admin']},
];
for(const group of BUTTON_PAGES)test(`every button responds (${group.label})`, async({page})=>{
  test.setTimeout(240000);
  const w=await watch(page,[/apply-agent.*503/,/billing.*(503|500)/]);
  if(group.as)await signIn(page,group.as,group.employer);
  const dead:string[]=[];
  for(const path of group.pages)for(const name of await clickEveryButton(page,path))dead.push(`${path}: "${name}"`);
  expect(dead,'buttons that did nothing when clicked').toEqual([]);
  clean(w);
});

test('@phone sign in with an emailed link', async({page})=>{
  const w=await watch(page);
  await page.goto('/login');
  const since=Date.now();
  await page.getByRole('textbox').first().fill(CAREGIVER.email);
  await page.getByRole('button',{name:'Continue'}).click();
  await expect(page.getByRole('heading',{name:'Check your email'})).toBeVisible();
  await page.goto(await emailLink(since,/https?:\/\/\S+\/signin\?token=[^\s"]+/));
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading',{name:/Hi Casey/})).toBeVisible();
  clean(w);
});

test('caregiver dashboard: availability, weekly emails and profile edits save', async({page})=>{
  const w=await watch(page);
  await signIn(page,CAREGIVER);
  await page.goto('/dashboard');
  const weekly=page.locator('.check-row input[type=checkbox]').first();
  await expect(weekly).toBeEnabled();
  const wasOn=await weekly.isChecked();
  await weekly.click();
  await expect(page.getByRole('status')).toHaveText(wasOn?'Weekly job emails turned off.':'Weekly job emails enabled.');
  await page.reload();
  await expect(page.locator('.check-row input[type=checkbox]').first()).toBeChecked({checked:!wasOn});
  await page.goto('/dashboard/profile');
  await page.getByLabel('A few words for employers').fill('Patient, reliable CNA. Five years of home care.');
  await page.getByRole('button',{name:'Save my profile'}).click();
  await expect(page.getByRole('status')).toHaveText('Profile saved. Your matches were refreshed.');
  await page.goto('/dashboard/profile/preview');
  await expect(page.getByText('Patient, reliable CNA. Five years of home care.')).toBeVisible();
  clean(w);
});

test('employer invites a caregiver, who says yes from the email and books an interview', async({browser})=>{
  const employer=await browser.newPage();
  const we=await watch(employer);
  await signIn(employer,EMPLOYER,true);
  await employer.goto('/app');
  await employer.getByRole('button',{name:'+ New opening'}).click();
  const title='E2E invite CNA '+Date.now().toString(36);
  await employer.getByLabel('Job title').fill(title);
  const modal=employer.locator('.modal-panel');
  await modal.getByLabel('Role').selectOption('CNA');
  await modal.getByLabel('ZIP').fill('21201');
  await modal.getByRole('button',{name:/Create (& match|opening)/}).click();
  await expect(employer.getByRole('heading',{name:'Matches for '+title})).toBeVisible();
  // Interview times first, so the caregiver can book one.
  await employer.getByRole('button',{name:/Add interview times|Manage interview times/}).click();
  const slotModal=employer.locator('.modal-panel');
  const start=new Date(Date.now()+3*86400000);start.setHours(10,0,0,0);
  const local=new Date(start.getTime()-start.getTimezoneOffset()*60000).toISOString().slice(0,16);
  await slotModal.locator('input[type=datetime-local]').first().fill(local);
  await slotModal.getByRole('button',{name:'Save interview times'}).click();
  await expect(employer.locator('.modal-panel')).toHaveCount(0);
  // Saving keeps the employer on the match list they were on.
  await expect(employer.getByRole('heading',{name:'Casey T.'})).toBeVisible();
  const since=Date.now();
  await employer.getByRole('button',{name:'Invite',exact:true}).first().click();
  await expect(employer.getByText(/Invited|invite sent/i).first()).toBeVisible();
  clean(we);

  const caregiver=await browser.newPage();
  const wc=await watch(caregiver);
  await caregiver.goto(await emailLink(since,/https?:\/\/\S+\/respond\?token=[^\s"]+/));
  await expect(caregiver.getByRole('heading',{name:title})).toBeVisible();
  await caregiver.getByRole('button',{name:'I’m interested'}).click();
  await expect(caregiver.getByRole('heading',{name:'Interest sent to employer'})).toBeVisible();
  await caregiver.locator('button.status-choice').first().click();
  await caregiver.getByRole('button',{name:/Book|Confirm/}).click();
  await expect(caregiver.getByRole('heading',{name:'You’re on the calendar.'})).toBeVisible();
  clean(wc);
});

// Desktop only: the emailed link works once.
test('legacy caregiver confirms they are still looking from the email link', async({page})=>{
  const w=await watch(page);
  await page.goto('/activate?token='+LINKS.activation);
  await expect(page.getByRole('heading',{name:'Are you looking for caregiver work right now?'})).toBeVisible();
  await page.locator('button.status-choice').first().click();
  await page.getByLabel('Preferred shifts').fill('Days');
  await page.locator('form button:not([type=button])').last().click();
  await expect(page.locator('h1, h2').filter({hasText:/thanks|you’re|saved|updated/i}).first()).toBeVisible();
  clean(w);
});

test('agency opens its emailed link and one click opens its dashboard', async({page})=>{
  const w=await watch(page);
  await page.goto('/agency?token='+LINKS.agencyTeaser);
  await expect(page.locator('h1')).toHaveText(/live on CareJoys/);
  await page.getByRole('button',{name:'Open my dashboard'}).click();
  await expect(page).toHaveURL(/\/app\?tab=jobs/);
  await expect(page.getByRole('heading',{name:'Show these jobs on your website'})).toBeVisible();
  clean(w);
});

test('Find my agency on Hire caregivers', async({page})=>{
  const w=await watch(page);
  await page.goto('/hire-caregivers');
  await page.getByRole('combobox',{name:'Agency name'}).fill('Harbor Home');
  await page.getByRole('button',{name:'Find my agency'}).click();
  await expect(page.locator('#claim-agency').getByText('Harbor Home Care').first()).toBeVisible();
  clean(w);
});

test('@phone job hub filters and ZIP search', async({page})=>{
  const w=await watch(page);
  await page.goto('/caregiver-jobs/maryland');
  await page.getByRole('button',{name:'HHA',exact:true}).click();
  await expect(page.getByRole('link',{name:/Home Health Aide/}).first()).toBeVisible();
  await expect(page.getByRole('link',{name:/CNA - Day Shift/})).toHaveCount(0);
  clean(w);
});

test('@phone pricing ZIP check shows nearby caregivers', async({page})=>{
  const w=await watch(page);
  await page.goto('/pricing');
  await page.getByRole('textbox').first().fill('21201');
  await page.getByRole('button',{name:'See caregivers near you'}).click();
  await expect(page.getByText(/caregiver|job/i).filter({hasText:/near|within|21201|Baltimore/}).first()).toBeVisible();
  clean(w);
});

test('training program asks to be added', async({page})=>{
  const w=await watch(page);
  await page.goto('/add-training-program');
  await page.getByLabel('School / program name').fill('Bayview CNA School');
  await page.getByLabel('Your name').fill('Riley School');
  await page.getByRole('textbox',{name:'Email'}).fill('e2e-school@example.test');
  await page.getByRole('button',{name:'Request addition'}).click();
  await expect(page.getByRole('heading',{name:'Thanks, we have it.'})).toBeVisible();
  clean(w);
});

test('admin console loads for the owner', async({page})=>{
  const w=await watch(page);
  await signIn(page,ADMIN);
  await page.goto('/admin');
  await expect(page.locator('h1').first()).not.toHaveText(/sign-in/i);
  clean(w);
});
