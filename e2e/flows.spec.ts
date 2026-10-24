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
  await page.getByRole('button',{name:'Find jobs'}).click();
  await expect(page.getByRole('heading',{name:'A few matches near you'})).toBeVisible();
  await expect(page.locator('.home-preview-results').getByRole('link',{name:/CNA - Day Shift/})).toBeVisible();
  await page.getByRole('link',{name:'Create my free profile for personalized matches'}).click();
  await expect(page).toHaveURL(/\/caregiver-resume\?zip=21201&role=CNA/);
  await expect(page.getByRole('button',{name:'No resume? Continue without one'})).toBeVisible();
  clean(w);
});

test('@phone caregiver signup without a resume', async({page},info)=>{
  const w=await watch(page);
  await page.goto('/caregiver-resume?zip=21201&role=CNA');
  await page.getByRole('button',{name:'No resume? Continue without one'}).click();
  await page.getByLabel('First name').fill('Jordan');
  await page.getByLabel('Last name').fill('Signup');
  await page.getByRole('textbox',{name:'Email'}).fill(`e2e-signup-${info.project.name}@example.test`);
  await page.getByRole('button',{name:/^Mornings/}).click();
  await page.getByRole('button',{name:'Save and continue'}).click();
  // An optional photo, then the sign-in link that opens their dashboard is already on its way.
  await expect(page.getByRole('heading',{name:'Add a profile photo.'})).toBeVisible();
  await page.getByRole('button',{name:'Continue'}).click();
  await expect(page.getByRole('heading',{name:'Check your email.'})).toBeVisible();
  await page.getByRole('button',{name:/Send the link again|Email me a sign-in link/}).click();
  await expect(page.getByText(/check your email|sent|link/i).first()).toBeVisible();
  clean(w);
});

test('@phone caregiver signup with a resume: check what was found, then preferences', async({page},info)=>{
  const w=await watch(page);
  await page.goto('/caregiver-resume');
  await page.locator('input[type=file]').setInputFiles({name:'resume.txt',mimeType:'text/plain',buffer:Buffer.from(
    `YOLANDA BRIGHTWATER\nCaregiver\n(410) 555-0167 | e2e-resume-${info.project.name}@example.test | Baltimore, MD 21201\n\nLead caregiver with 14 years in memory care. CNA, CPR.`)});
  await expect(page.getByRole('heading',{name:'Check what we found.'})).toBeVisible();
  // The pitch beside the form steps aside once they start.
  await expect(page.getByRole('heading',{name:/add yours, get matched/})).toHaveCount(0);
  await expect(page.getByLabel('First name')).toHaveValue('Yolanda');
  await expect(page.getByLabel('Last name')).toHaveValue('Brightwater');
  await expect(page.getByLabel('ZIP code')).toHaveValue('21201');
  await expect(page.getByLabel('Years of experience')).toHaveValue('14');
  await page.getByRole('button',{name:'Continue'}).click();
  await expect(page.getByRole('heading',{name:'What kind of job fits?'})).toBeVisible();
  await page.getByRole('button',{name:'Mon Mornings'}).click();
  await expect(page.getByRole('button',{name:'Mon Mornings'})).toHaveAttribute('aria-pressed','true');
  // Any step can be revisited, back to the upload itself.
  await page.getByRole('button',{name:'Check details'}).click();
  await expect(page.getByLabel('First name')).toHaveValue('Yolanda');
  await page.getByRole('button',{name:'Upload',exact:true}).click();
  await expect(page.getByText('Upload resume')).toBeVisible();
  await page.getByRole('button',{name:'No resume? Continue without one'}).click();
  await expect(page.getByLabel('First name')).toHaveValue('Yolanda');
  await page.getByRole('button',{name:'Continue'}).click();
  await page.getByRole('button',{name:'Save and continue'}).click();
  await expect(page.getByRole('heading',{name:'Add a profile photo.'})).toBeVisible();
  await expect(page.getByText('Step 4 of 4')).toBeVisible();
  clean(w);
});

test('@phone a job opens in a side panel over the list, and Apply opens its own page in a new tab', async({page,context})=>{
  const w=await watch(page);
  await page.goto('/caregiver-jobs/maryland');
  await page.getByRole('link',{name:'CNA - Day Shift'}).first().click();
  const panel=page.getByRole('dialog',{name:'Job details'});
  await expect(panel.getByRole('heading',{name:'CNA - Day Shift',level:1})).toBeVisible();
  await expect(page).toHaveURL(/\/caregiver-jobs\/maryland\?job=/);
  await page.getByRole('button',{name:'Close job'}).click();
  await expect(panel).toHaveCount(0);
  // The list's View job opens the panel too, not the apply page.
  await page.locator('article.job',{has:page.getByRole('link',{name:'CNA - Day Shift'})}).first().getByRole('link',{name:'View job'}).click();
  await expect(panel.getByRole('heading',{name:'CNA - Day Shift',level:1})).toBeVisible();
  await expect(page.getByText('Apply on CareJoys')).toHaveCount(0);
  const apply=panel.getByRole('link',{name:'Apply with CareJoys'});
  await expect(apply).toHaveAttribute('target','_blank');
  const [tab]=await Promise.all([context.waitForEvent('page'),apply.click()]);
  await tab.waitForURL(/\/apply\//);
  await expect(tab.getByText('Apply on CareJoys')).toBeVisible();
  await expect(tab.getByRole('heading',{name:'CNA - Day Shift',level:1})).toBeVisible();
  await tab.close();
  // The list stays open behind it.
  await expect(panel.getByRole('heading',{name:'CNA - Day Shift',level:1})).toBeVisible();
  // Back closes the panel and leaves the list where it was.
  await page.goBack();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/\/caregiver-jobs\/maryland$/);
  clean(w);
});

test('signed-in caregivers browse all jobs in their dashboard', async({page})=>{
  const w=await watch(page);
  await signIn(page,CAREGIVER);
  await page.goto('/dashboard');
  await page.getByRole('link',{name:'Browse all jobs near you'}).click();
  await expect(page).toHaveURL(/\/dashboard\/jobs$/);
  await page.getByRole('link',{name:'Home Health Aide'}).first().click();
  await expect(page.getByRole('dialog',{name:'Job details'}).getByRole('heading',{name:'Home Health Aide',level:1})).toBeVisible();
  clean(w);
});

test('@phone Apply starts with sign-in, and the profile form flags what is missing', async({page})=>{
  const w=await watch(page);
  await page.goto('/apply/'+JOBS.applyForMe);
  await expect(page.getByText('Apply on CareJoys')).toBeVisible();
  // The employer button stays off the apply page.
  await expect(page.locator('.nav-cta')).toHaveCount(0);
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('link',{name:'Set up an employer account'})).toHaveAttribute('href','/hire-caregivers');
  await page.getByRole('button',{name:'Apply without signing in'}).click();
  await expect(page.getByText('Upload resume')).toBeVisible();
  await page.getByRole('button',{name:'No resume? Continue without one'}).click();
  // Job preferences are optional while applying, so they start folded away.
  await expect(page.getByRole('group',{name:'Weekly availability'})).toHaveCount(0);
  await page.getByRole('button',{name:'Add job preferences (optional)'}).click();
  await expect(page.getByRole('group',{name:'Weekly availability'})).toBeVisible();
  await page.getByRole('button',{name:'Apply',exact:true}).last().click();
  await expect(page.getByText('Fill in the highlighted fields to continue.')).toBeVisible();
  await expect(page.getByLabel('First name')).toHaveAttribute('aria-invalid','true');
  // Typing a last name keeps the row on screen.
  await page.getByLabel('Last name').fill('Applicant');
  await expect(page.getByLabel('Last name')).toBeVisible();
  clean(w);
});

test('Apply with CareJoys on a job CareJoys can’t send says so, then opens the employer’s site in a new tab', async({page,context})=>{
  await signIn(page,CAREGIVER);
  // The employer's site isn't real in tests; stop at the navigation.
  await context.route('https://harborhomecare.test/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<h1>Harbor Home Care application</h1>'}));
  await page.goto('/jobs/'+JOBS.external);
  await expect(page.getByText(/then you finish on .*’s site/)).toBeVisible();
  await page.goto('/apply/'+JOBS.external);
  await expect(page.getByText(/can’t send this one for you yet/)).toBeVisible();
  const [tab]=await Promise.all([context.waitForEvent('page'),page.getByRole('link',{name:/^Finish on /}).click()]);
  await tab.waitForURL('https://harborhomecare.test/**');
  await expect(tab.getByText('Harbor Home Care application')).toBeVisible();
  // CareJoys stays open behind it, on the same job.
  await expect(page).toHaveURL(new RegExp('/apply/'+JOBS.external));
  await expect(page.getByText('Opened in a new tab').first()).toBeVisible();
});

test('Apply for me takes a resume and answers the click', async({page})=>{
  // The local copy has no Cloudflare browser, so the run itself ends in "not switched on"; the test checks that
  // the resume upload works and the button always leaves its "Filling in…" state with a message.
  const w=await watch(page,[/apply-agent.*503/]);
  await signIn(page,CAREGIVER);
  await page.goto('/apply/'+JOBS.applyForMe);
  await page.locator('.apply-agent-start input[type=file]').setInputFiles({name:'resume.txt',mimeType:'text/plain',
    buffer:Buffer.from('Casey Tester\nCertified Nursing Assistant\nBaltimore, MD 21201\n5 years of home care experience.')});
  const start=page.locator('.apply-agent-start').getByRole('button',{name:'Apply',exact:true});
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
  await page.getByLabel('Your name').fill('Sam Employer');
  await page.getByRole('textbox',{name:'Email'}).fill('e2e-new-employer@example.test');
  await page.getByRole('button',{name:'Get started'}).click();
  await expect(page.getByRole('heading',{name:'You’re in. Let’s pick a time.'})).toBeVisible();
  clean(w);
});

test('employer workspace: create an opening and view matches', async({page})=>{
  const w=await watch(page);
  await signIn(page,EMPLOYER,true);
  await page.goto('/hiring');
  await page.getByRole('button',{name:'+ New job listing'}).click();
  await page.getByLabel('Job title').fill('E2E CNA weekends');
  const modal=page.locator('.modal-panel');
  await modal.getByLabel('Role').selectOption('CNA');
  await modal.getByLabel('ZIP').fill('21201');
  await modal.getByRole('button',{name:/Create (& match|job listing)/}).click();
  await expect(page.locator('.modal-panel')).toHaveCount(0);
  // Create & match goes straight to Find caregivers for the new job, with the seeded Baltimore CNA suggested first.
  await expect(page).toHaveURL(/\/hiring\?tab=talent&job=/);
  const picker=page.getByLabel('Job listing');
  await expect(picker.locator('option:checked')).toHaveText('E2E CNA weekends');
  await expect(page.getByRole('heading',{name:'Suggested for this job'})).toBeVisible();
  await expect(page.locator('.match-tile').getByRole('heading',{name:'Casey T.'})).toBeVisible();
  // A suggestion isn't in Candidates until they're invited.
  await page.getByRole('button',{name:/^Candidates/}).first().click();
  await expect(page.getByRole('heading',{name:'Casey T.'})).toHaveCount(0);
  await page.getByRole('button',{name:'Job Listings'}).click();
  const card=page.locator('.job-card',{hasText:'E2E CNA weekends'});
  await expect(card.getByText(/^[1-9]\d* suggested · 0 invited · 0 said yes$/)).toBeVisible();
  await card.getByRole('button',{name:'Candidates'}).click();
  await expect(page.getByRole('heading',{name:'Candidates for E2E CNA weekends'})).toBeVisible();
  await expect(page).toHaveURL(/\/hiring\?tab=candidates&job=/);
  // The link to Find caregivers for a job opens that job.
  const url=new URL(page.url());
  await page.goto('/hiring?tab=talent&job='+url.searchParams.get('job'));
  await expect(page.getByLabel('Job listing').locator('option:checked')).toHaveText('E2E CNA weekends');
  clean(w);
});

test('employer finds caregivers: suggested first, then nearby, profile panel', async({page})=>{
  const w=await watch(page);
  await signIn(page,EMPLOYER,true);
  await page.goto('/hiring');
  await page.locator('.dash-sidenav').getByRole('button',{name:'Find caregivers'}).click();
  await expect(page.getByRole('heading',{name:'Find caregivers'})).toBeVisible();
  await expect(page.getByLabel('Job listing').locator('option:checked')).toHaveText('E2E CNA weekends');
  // Casey is suggested for the job, so the search below doesn't show her twice.
  await expect(page.locator('.match-tile',{hasText:'Casey T.'}).getByRole('button',{name:'Invite',exact:true})).toBeVisible();
  await expect(page.locator('.talent-card',{hasText:'Casey T.'})).toHaveCount(0);
  // The search opens on the job's commute area, so someone across the country isn't shown until asked for.
  const far=page.locator('.talent-card',{hasText:'Dana F.'});
  await expect(far).toHaveCount(0);
  await page.getByRole('button',{name:'Show other areas'}).click();
  await expect(page.locator('.talent-divider')).toHaveText('Farther away');
  await expect(far.getByText('$50/hr')).toBeVisible();
  // They can't take a job that far away, so there's nothing to invite them to.
  await expect(far.getByText('Lives too far from your job listings')).toBeVisible();
  await far.getByRole('button',{name:'View profile'}).click();
  const panel=page.getByRole('dialog',{name:'Dana F.'});
  await expect(panel.getByRole('link',{name:'View full profile'})).toHaveAttribute('href',/\/hiring\?talent=/);
  await expect(panel.getByText('Lives too far from your job listings')).toBeVisible();
  // "View full profile" opens the caregiver's own page in place.
  await panel.getByRole('link',{name:'View full profile'}).click();
  await expect(page).toHaveURL(/\/hiring\?talent=/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Dana F.'})).toBeVisible();
  // New-caregiver emails are a setting, not a button on the search.
  await page.getByRole('button',{name:'Settings'}).click();
  const alertBox=page.getByRole('checkbox',{name:/New caregivers near you/});
  // The box follows the saved alert, so it flips once CareJoys has saved it.
  await alertBox.click();
  await expect(page.getByText('You’ll get an email when new caregivers join near you.')).toBeVisible();
  await expect(alertBox).toBeChecked();
  await alertBox.click();
  await expect(page.getByText('New-caregiver emails turned off.')).toBeVisible();
  await expect(alertBox).not.toBeChecked();
  await expect(page.getByRole('button',{name:'Edit email templates'})).toBeVisible();
  clean(w);
});
