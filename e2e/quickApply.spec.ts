import { expect, test, type Page } from '@playwright/test';
// @ts-expect-error plain JS fixtures shared with prepare.mjs
import { AGENCY, JOBS } from './fixtures.mjs';
import { clean, signIn, watch } from './helpers';

// The three-step Apply with CareJoys (src/QuickApply.tsx): no account, no resume, then book an interview on the spot.

async function stepOne(page:Page,who:{first:string;last:string;email:string}){
  await page.getByLabel('First name').fill(who.first);
  await page.getByLabel('Last name').fill(who.last);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Mobile phone').fill('410-555-0177');
  await page.getByLabel('ZIP code').fill('21224');
  await page.getByRole('group',{name:'Role'}).getByRole('button',{name:'CNA'}).click();
  await page.getByRole('button',{name:'Continue'}).click();
  await expect(page.getByRole('heading',{name:'A few quick questions'})).toBeVisible();
}
async function stepTwo(page:Page){
  await page.getByRole('group',{name:'Hours'}).getByRole('button',{name:'Part-time'}).click();
  await page.getByRole('group',{name:'Shifts'}).getByRole('button',{name:'Days'}).click();
  await page.getByRole('group',{name:'Shifts'}).getByRole('button',{name:'Weekends'}).click();
  await page.getByRole('group',{name:'Experience'}).getByRole('button',{name:/home care agency/}).click();
  await page.getByRole('group',{name:'Transportation'}).getByRole('button',{name:'My own car'}).click();
  await page.getByRole('group',{name:'Checklist'}).getByRole('button',{name:'18 or older'}).click();
}

test('@phone three-step apply to an agency on CareJoys, then book an interview', async({page},info)=>{
  const w=await watch(page);
  await page.goto('/apply/'+JOBS.onCareJoys);
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await page.getByLabel('ZIP code').fill('21224');
  await expect(page.getByText(/Under a mile from this job|About \d+ miles from this job/)).toBeVisible();
  // Each project (desktop, phone) applies as its own new caregiver.
  await stepOne(page,{first:'Jordan',last:'Quick',email:'jordan.quick+'+info.project.name+'@example.test'});
  await stepTwo(page);
  // The agency's own yes/no question is required.
  await page.getByRole('button',{name:'Send my application'}).click();
  await expect(page.getByText('Answer the highlighted questions.')).toBeVisible();
  await page.getByRole('group',{name:'Can you work in a home with pets?'}).getByRole('button',{name:'Yes'}).click();
  await page.getByLabel('When can you start? (optional)').fill('Next week');
  await page.getByRole('button',{name:'Send my application'}).click();
  await expect(page.getByRole('heading',{name:'Jordan, you’re applied.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Book your interview now'})).toBeVisible();
  await page.locator('.qa-times .qa-chip').first().click();
  await expect(page.getByText(/^Booked: /)).toBeVisible();
  clean(w);
});

test('a knockout answer stops the application before it reaches the agency', async({page})=>{
  const w=await watch(page);
  await page.goto('/apply/'+JOBS.onCareJoys);
  await stepOne(page,{first:'Sam',last:'Nopets',email:'sam.nopets@example.test'});
  await stepTwo(page);
  await page.getByRole('group',{name:'Can you work in a home with pets?'}).getByRole('button',{name:'No'}).click();
  await page.getByRole('button',{name:'Send my application'}).click();
  await expect(page.getByRole('heading',{name:'This job isn’t a match.'})).toBeVisible();
  await expect(page.getByText('Can you work in a home with pets?')).toBeVisible();
  clean(w);
});

test('three-step apply to an employer not on CareJoys saves the profile, then sends them to finish', async({page})=>{
  const w=await watch(page);
  await page.goto('/apply/'+JOBS.external);
  await expect(page.getByText(/then you finish on Harbor Home Care’s site/)).toBeVisible();
  await stepOne(page,{first:'Avery',last:'External',email:'avery.external@example.test'});
  await stepTwo(page);
  await page.getByRole('button',{name:'Save and continue'}).click();
  await expect(page.getByRole('heading',{name:'Last step: finish on Harbor Home Care’s site.'})).toBeVisible();
  await expect(page.getByRole('link',{name:/^Finish on Harbor Home Care/})).toHaveAttribute('href','https://harborhomecare.test/careers/hha');
  // The same email can't apply again without signing in.
  await page.goto('/apply/'+JOBS.external);
  await stepOne(page,{first:'Avery',last:'External',email:'avery.external@example.test'});
  await stepTwo(page);
  await page.getByRole('button',{name:'Save and continue'}).click();
  await expect(page.getByText(/You already have a CareJoys profile/)).toBeVisible();
  clean(w);
});

test('the agency sees the grade, answers and booked interview, with the funnel on top', async({page})=>{
  const w=await watch(page);
  await signIn(page,AGENCY,true);
  await page.goto('/hiring?tab=candidates');
  await expect(page.getByLabel('Applications in the last 30 days')).toBeVisible();
  const tile=page.locator('article.match-tile',{hasText:'Jordan Quick'});
  await expect(tile.locator('.match-grade')).toContainText('Qualified');
  await expect(tile.locator('.match-answers')).toContainText('Can you work in a home with pets?');
  await expect(tile.locator('.match-status')).toContainText('Interview');
  await page.goto('/hiring?tab=settings');
  await expect(page.getByRole('heading',{name:'Interview times'})).toBeVisible();
  clean(w);
});
