import { expect, test } from '@playwright/test';
// @ts-expect-error plain JS fixtures shared with prepare.mjs
import { CAREGIVER, EMPLOYER, JOBS } from './fixtures.mjs';
import { clean, signIn, watch } from './helpers';

// Click-through test of CareJoys' main flows, run before every deploy (.github/workflows/deploy.yml) and on PRs.
// Each test also fails if the page throws a JavaScript error or the error reporter would have sent an alert,
// so a frozen button or a crash fails here instead of on carejoys.com.

test('@phone job search by ZIP from the homepage', async({page})=>{
  const w=await watch(page);
  await page.goto('/');
  await page.locator('#preview-role').selectOption('CNA');
  await page.locator('#preview-zip').fill('21201');
  await page.getByRole('button',{name:'Preview my jobs'}).click();
  await expect(page.getByRole('heading',{name:'A few matches near you'})).toBeVisible();
  await expect(page.locator('.home-preview-results').getByRole('link',{name:/CNA - Day Shift/})).toBeVisible();
  await page.getByRole('link',{name:'Create my free profile for personalized matches'}).click();
  await expect(page).toHaveURL(/\/caregiver-resume\?zip=21201&role=CNA/);
  await expect(page.getByRole('button',{name:'Continue without a resume'})).toBeVisible();
  clean(w);
});

test('@phone caregiver signup without a resume', async({page},info)=>{
  const w=await watch(page);
  await page.goto('/caregiver-resume?zip=21201&role=CNA');
  await page.getByRole('button',{name:'Continue without a resume'}).click();
  await page.getByLabel('First name').fill('Jordan');
  await page.getByLabel('Last name').fill('Signup');
  await page.getByRole('textbox',{name:'Email'}).fill(`e2e-signup-${info.project.name}@example.test`);
  await page.getByLabel('Preferred shifts').fill('Days');
  await page.getByRole('button',{name:'Find jobs'}).click();
  await expect(page.getByRole('heading',{name:'You’re matched.'})).toBeVisible();
  await expect(page.locator('.onboarding-top-jobs').getByRole('link',{name:/CNA - Day Shift/})).toBeVisible();
  // The sign-in link to come back later.
  await page.getByRole('button',{name:'Email me a sign-in link'}).click();
  await expect(page.getByText(/check your email|sent|link/i).first()).toBeVisible();
  clean(w);
});

test('Apply on a job saves it and offers the employer’s site', async({page})=>{
  const w=await watch(page);
  await signIn(page,CAREGIVER);
  await page.goto('/jobs/'+JOBS.external);
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.getByText('Apply with your CareJoys profile')).toBeVisible();
  await page.getByRole('button',{name:'Save to my dashboard'}).click();
  await expect(page.getByText('Saved, not sent yet')).toBeVisible();
  await expect(page.getByRole('button',{name:'Finish on Harbor Home Care’s site'})).toBeVisible();
  clean(w);
});

test('Apply for me takes a resume and answers the click', async({page})=>{
  // The local copy has no Cloudflare browser, so the run itself ends in "not switched on"; the test checks that
  // the resume upload works and the button always leaves its "Filling in…" state with a message.
  const w=await watch(page,[/apply-agent.*503/]);
  await signIn(page,CAREGIVER);
  await page.goto('/jobs/'+JOBS.applyForMe);
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await page.locator('.apply-agent-start input[type=file]').setInputFiles({name:'resume.txt',mimeType:'text/plain',
    buffer:Buffer.from('Casey Tester\nCertified Nursing Assistant\nBaltimore, MD 21201\n5 years of home care experience.')});
  const start=page.getByRole('button',{name:'Apply for me on Harbor Home Care’s site'});
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.locator('.apply-agent-start .notice, .apply-agent-questions, .apply-agent-status:not(:has(.apply-agent-spinner)), .onboarding-success')).toBeVisible({timeout:20000});
  await expect(page.getByText(/Filling in Harbor Home Care/)).toHaveCount(0);
  await expect(page.locator('.apply-agent-start .notice')).toContainText('Apply for me isn’t switched on yet.');
  // The resume just added is remembered: no second "Add your resume file".
  await expect(start).toBeVisible();
  // And the error reporter caught the failed call, as it would on carejoys.com.
  expect(w.allowed.join(' ')).toContain('POST /api/me/apply-agent/:id returned 503');
  clean(w);
});

test('employer onboarding from Hire caregivers', async({page})=>{
  const w=await watch(page);
  await page.goto('/hire-caregivers');
  await page.getByLabel('Role needed').selectOption('CNA');
  await page.getByLabel('Hiring ZIP').fill('21201');
  await page.getByLabel('Company name').fill('Bayview Care');
  await page.getByLabel('What kind of employer are you?').selectOption('home_care');
  await page.getByLabel('Your name').fill('Sam Employer');
  await page.getByRole('textbox',{name:'Email'}).fill('e2e-new-employer@example.test');
  await page.getByRole('button',{name:'Create opening & continue'}).click();
  await expect(page.getByRole('heading',{name:'Check your email.'})).toBeVisible();
  clean(w);
});

test('employer workspace: create an opening and view matches', async({page})=>{
  const w=await watch(page);
  await signIn(page,EMPLOYER,true);
  await page.goto('/app');
  await page.getByRole('button',{name:'+ New opening'}).click();
  await page.getByLabel('Job title').fill('E2E CNA weekends');
  const modal=page.locator('.modal-panel');
  await modal.getByLabel('Role').selectOption('CNA');
  await modal.getByLabel('ZIP').fill('21201');
  await modal.getByRole('button',{name:/Create (& match|opening)/}).click();
  await expect(page.locator('.modal-panel')).toHaveCount(0);
  // Create & match goes straight to the matches, where the seeded Baltimore CNA should be.
  await expect(page.getByRole('heading',{name:'Matches for E2E CNA weekends'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Casey T.'})).toBeVisible();
  await page.getByRole('button',{name:'← All openings'}).click();
  await expect(page.locator('.job-card',{hasText:'E2E CNA weekends'}).getByRole('button',{name:'View matches'})).toBeVisible();
  clean(w);
});

test('employer finds caregivers: closest first, plain tags, profile panel', async({page})=>{
  const w=await watch(page);
  await signIn(page,EMPLOYER,true);
  await page.goto('/app');
  await page.getByRole('button',{name:'Find caregivers'}).click();
  await expect(page.getByRole('heading',{name:'Find caregivers'})).toBeVisible();
  const near=page.locator('.talent-card',{hasText:'Casey T.'});
  await expect(near.getByText('$18/hr')).toBeVisible();
  // The search opens at commuting distance, so someone across the country isn't shown until asked for.
  const far=page.locator('.talent-card',{hasText:'Dana F.'});
  await expect(far).toHaveCount(0);
  await page.getByLabel('Distance from ZIP').selectOption('all');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.locator('.talent-divider')).toHaveText('Farther away');
  await expect(far.getByText('$50/hr')).toBeVisible();
  // They can't take a job that far away, so there's nothing to invite them to.
  await expect(far.getByText(/Lives beyond their commute/)).toBeVisible();
  await near.getByRole('button',{name:'View profile'}).click();
  const panel=page.getByRole('dialog',{name:'Casey T.'});
  await expect(panel.getByRole('link',{name:'Open in new tab ↗'})).toHaveAttribute('href',/\/app\?talent=/);
  await expect(panel.getByText(/In your candidates for/)).toBeVisible();
  await panel.getByRole('button',{name:'Close'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Save this search as an email alert; it shows as a removable chip.
  await page.getByRole('button',{name:'Email me new matches'}).click();
  await expect(page.locator('.talent-alerts')).toContainText('near 21201');
  await page.getByRole('button',{name:/^Turn off alert/}).click();
  await expect(page.locator('.talent-alerts')).toHaveCount(0);
  clean(w);
});
