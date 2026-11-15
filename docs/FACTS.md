# CareJoys facts file

What CareJoys may say about itself, in emails, pages, drafts and replies. If a claim is not here, do not make it: check first, or leave it out.

Last reviewed: 2026-11-15. Review this file whenever the product, the prices or the rules below change.

## Rule one: numbers are looked up, never typed

Counts change every day. Never write a number of jobs, caregivers, agencies, states or applicants from memory, from an old report or from this file.

| Claim | Where the true number comes from |
| --- | --- |
| Jobs on CareJoys, states covered, new this week, employers watched | `homeStats()` in `src/homeStats.ts`, public at `/api/public/home-stats` |
| An agency's own jobs ("your N jobs on CareJoys") | Count that agency's rows in `caregiver_jobs` with `is_published=1 AND status='current'` at the moment of sending |
| Caregivers, sign-ups, applications delivered | Production database, excluding test accounts; `/api/admin/health` for the admin summary |
| Prices | `src/plans.ts` |
| Free caregiver contacts | `freeContacts` setting in `src/billing.ts` (default 5) |

**A message that says an agency has a job on CareJoys may only go to an agency that has one right now.** In November 2026 about 380 notes said "CareJoys lists an open caregiver job" to agencies with none. Check at send time, per recipient, and send nothing if the count is zero.

If the number is small or zero, do not round it up or word around it. Leave the number out.

## True today

- CareJoys is a caregiver job site at carejoys.com, run by Rebecca Myers.
- It is free for caregivers, CNAs and GNAs.
- It lists caregiver jobs found on employers' own careers pages and checks them regularly; a job page shows when it was posted and last checked.
- Caregivers can search by city, state or ZIP, build a profile, apply with CareJoys, and sign up for job alerts by email.
- For some employer job sites, "Apply for me" fills in the employer's form. It stops for CAPTCHAs, logins, criminal-history questions and signatures, which the caregiver does.
- Some applications are finished on the employer's own site. Say so when that is the case.
- Agencies that say yes get applications for their jobs by email, free, one email per caregiver with resume, availability and contact details.
- An agency can ask for a license filter (for example CNA, EMT, MA), and caregivers without that license are stopped before applying.
- Agencies can sign in at carejoys.com/login to manage their jobs, and can put a free jobs widget on their own website.
- Caregivers appear in the public directory only with their consent, with first name and last initial, and no contact details.

## Never say

- That caregivers are **vetted, verified, screened or background-checked**. CareJoys does not do background checks.
- That a license was **verified**, unless a registry check with a date is stored for that caregiver.
- A number of applicants an agency will get, or how fast.
- That CareJoys provides staffing, temp or per-diem workers, shift coverage, payroll or scheduling.
- That CareJoys connects to an agency's software (ATS, HHAeXchange, WellSky and so on).
- That CareJoys sends text messages.
- That something was done (a job removed, a setting changed) unless it already was. Say what will be done.
- Anything about a named agency's hiring that did not come from their own careers page or their own reply.
- Testimonials, hire counts or success stories. There are none recorded yet; when there is a real one, add it here with the date and the person's permission.

## When unsure

Say Rebecca will check and get back to them. An honest "I'll find out" is always allowed.
