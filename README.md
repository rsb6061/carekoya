# CareJoys

CareJoys is a caregiver workforce network for home-care and senior-care employers.

> **Caregivers ready to work. Interviews ready for you.**

Canonical product domain: **https://carejoys.com**

This repository is the canonical source for the post-Floot rebuild. The repository slug and current Cloudflare Worker service may still use the legacy internal name `carekoya`; that is intentional for now so existing Git integration and domain routing are not disrupted.

## Product thesis

Most recruiting products optimize for applicant volume. CareJoys is designed around a harder question: **who is reachable, qualified enough for this opening, and interested now?**

The long-term asset is a persistent caregiver workforce graph: location, role, credentials, shift preferences, wage expectations, commute radius, availability freshness, response history, interview outcomes, and later retention.

## Current MVP

- Employer-first B2B landing page
- Caregiver workforce positioning
- School / new-graduate acquisition channel
- Freshness-driven candidate model
- GitHub CI
- Vite + React + Cloudflare Worker

## Deployment

Cloudflare Workers Builds should use:

- Build command: `npm run build`
- Deploy command: `npm run deploy`
- Production branch: `main`

The deploy script builds the Vite app, applies D1 migrations, then runs Wrangler deploy.

The Worker config is committed as `wrangler.jsonc`.

## Monitoring

- **Site errors.** Visitors' browsers report JavaScript crashes, CareJoys API calls that fail or hang for 20+ seconds, and uncaught Worker exceptions (`src/errorReporter.ts`, `src/monitoring.ts`). New problems are emailed from the five-minute cron, at most every 30 minutes. Details with stack traces: `/api/admin/monitoring`.
- **Daily funnel alarm.** At 15:41 UTC CareJoys emails if a step (ZIP searches, caregiver sign-ups, Apply clicks, Apply for me, employer sign-ups, workspace visits, openings) had zero in the last 24 hours although its traffic said about 3 or more were due, or if Clarity saw rage clicks or clicks that hit an error. Quiet days send nothing.
- **Click-through test.** `npm run build && npm run test:e2e` runs the main flows in Chromium against a local copy (`e2e/`). It runs on every PR and before every deploy; a failure stops the deploy.

Alerts go to `ALERT_EMAILS` (a Worker variable or secret), else `ADMIN_EMAILS`, else the owner accounts in `admin_authorizations`.

## Floot migration rule

Floot is now **source data only**, not a production dependency.

Keep:
- caregiver identity/contact where legitimately collected
- city/state/ZIP
- role/certifications
- wage range
- experience
- specialties/languages
- commute radius / willingness to drive
- useful profile content

Transform:
- legacy `is_active` is **not** current availability
- imported caregivers begin with availability **unknown**
- availability becomes valid only after a new confirmation

Do not migrate:
- old family marketplace workflows
- family messaging
- old sessions/passwords
- government-ID files
- background-check reports
- unsubstantiated "verified" badges
- empty FCRA machinery

**Never commit caregiver PII into Git.** Production migration will go directly database-to-database or through a protected administrative import.
