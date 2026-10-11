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

## Text messages (Twilio)

Candidates get texts, agencies get email. `src/sms.ts` is a brand-agnostic module (no CareJoys imports; copy it with `migrations/0062_sms.sql` to reuse it for another brand on the same Twilio account with its own Messaging Service). `src/carejoysSms.ts` is CareJoys' binding.

- **Dormant until configured.** Needs the secrets `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`; sending also needs the var `SMS_ENABLED="true"`. Nothing sends texts automatically yet.
- **Consent.** `recordSmsConsent` logs every opt-in with the exact wording shown (`sms_consent_events`); sends go only to numbers whose latest state is opted in. STOP/START/HELP (and Twilio's error 21610) update consent; STOP also clears `caregivers.sms_consent`.
- **Webhooks** (Twilio-signed, others get 403): Messaging Service "incoming messages" → `https://carejoys.com/api/sms/inbound`; status callbacks are set per message to `https://carejoys.com/api/sms/status`.
- **Logs.** `sms_messages` holds every text in and out with Twilio's delivery status and error code, and links each reply to the text it answers. `/api/admin/sms` shows delivered / not delivered / replied per template; `POST /api/admin/sms/test {"to":"..."}` texts your own phone.

## Monitoring

- **Site errors.** Visitors' browsers report JavaScript crashes, CareJoys API calls that fail or hang for 20+ seconds, and uncaught Worker exceptions (`src/errorReporter.ts`, `src/monitoring.ts`). New problems are emailed from the five-minute cron, at most every 30 minutes. Details with stack traces: `/api/admin/monitoring`.
- **Daily funnel alarm.** At 15:41 UTC CareJoys emails if a step (ZIP searches, caregiver sign-ups, Apply clicks, Apply for me, employer sign-ups, workspace visits, openings) had zero in the last 24 hours although its traffic said about 3 or more were due, or if Clarity saw rage clicks or clicks that hit an error. Quiet days send nothing.
- **Click-through test.** `npm run build && npm run test:e2e` runs CareJoys in Chromium against a local copy (`e2e/`): every public page on desktop and phone, every internal link, every button (signed out, caregiver, employer, admin), and the main flows, including the ones that start from an email (sign-in links, employer invites and interview booking, legacy caregiver activation, agency claims). It runs on every PR and before every deploy; a failure stops the deploy.

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
