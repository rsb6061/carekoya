# CareJoys: read this first

CareJoys (carejoys.com) is a caregiver job site run by one person, Rebecca. She is not a developer: she asks Claude to build, test and merge. Write to her in plain language, lead with the result, and keep choices to a yes or no where you can.

Before any task, read:

1. This file.
2. `docs/FACTS.md` before writing anything a caregiver, agency or the public will read (pages, emails, drafts, replies).
3. `src/emailPlaybook.ts` before writing or changing any email. It is her voice, learned from replies she sent.
4. Project memory and the shared project files folder (`reviews/`, `outreach/`), when you have them. They hold past decisions and why.

## Standing rules (Rebecca's decisions)

Each line has the date she decided it. Do not reopen these; if one blocks the work, ask her.

- **No SMS.** Do not build on or turn on text messages (2026-10-01). A Twilio module exists (`src/sms.ts`, added 2026-10-18) and has never sent a text; `SMS_ENABLED` is `"false"` (2026-11-16). Do not add Twilio secrets. See "Text messages" in `README.md`.
- **Ask before any new outreach.** No new campaign, audience, or re-send without her yes in the thread. `OUTREACH_ENABLED` and the per-campaign switches in `wrangler.jsonc` are hers to flip (2026-10-01).
- **New agency outreach is paused** (2026-11-13, `AGENCY_HIRING_INVITES_ENABLED=false`). Replies, yes set-ups and application emails keep running.
- **School outreach is on hold** (2026-10-23). Do not send or automate it.
- **The focus is caregivers in Maryland**, measured by applications delivered to agencies per week; the target is 10 (2026-11-13).
- **Email comes from rebecca@carejoys.com or hello@carejoys.com only**, never her Gmail. Reply drafts never send themselves; she presses Send.
- **Spending is small and capped.** Paid data runs at cents to a few dollars a day (careers lookup is $0.25 a day). Ask before any spend above the cap already set.
- **No paid ads right now** (2026-11-18). She turned down the roughly $150 Maryland caregiver ad test. Do not propose ad spend again unless she raises it.
- **API keys live in Cloudflare Worker settings**, never in the repository. `keep_vars` is on so deploys do not wipe them.
- **Agency email is the "reply yes" note**: plain text from rebecca@, one campaign only, capped at 60 a day when it runs (2026-10-23).
- **Apply with CareJoys means profile first for every job**, opened in a new tab (2026-10-24). Be upfront when the caregiver finishes on the employer's site.
- **The caregiver directory is consent-based**: first name and last initial, no contact details or exact ZIP, photo by separate consent (2026-10-23).
- **Carexroads is a platform, not an agency.** Keep it out of agency lists and counts (2026-10-26).
- **Never commit caregiver personal data to Git.**

When Rebecca makes a new standing decision, add it here with the date in the same change. Do not delete an old rule; mark it "replaced on (date)" and add the new one.

## How work ships

- Merging to `main` deploys to production through GitHub Actions (`.github/workflows/deploy.yml`): typecheck, unit tests, build, database migrations, deploy, live smoke tests. There is no other deploy path, and no staging site.
- Rebecca reviews in chat and asks Claude to merge. Do not merge without her yes.
- Before opening a pull request: `npm run typecheck`, `npm test`, and for anything a visitor sees, `npm run build && npm run test:e2e`.
- Never skip or disable a test to get a green run.
- Migrations are numbered files in `migrations/` and run against production on deploy. They cannot be undone by a revert, so make them additive.
- Do not create two files whose names differ only by upper and lower case. It has broken a deploy.

## Where things are

- `src/worker.ts`: every route and the scheduled timers. `wrangler.jsonc`: settings and campaign switches, each with a comment saying who decided what and when.
- Pay display: always `payLabel` / `normalizePay` in `src/jobFormat.ts`.
- Prices and plan wording: `src/plans.ts` only.
- Outreach: `src/replyYesOutreach.ts`, `src/outreach.ts`. Agency replies and drafts: `src/inboundEmail.ts`, `src/replyDrafter.ts`, `src/emailPlaybook.ts`.
- Monitoring and alarms: see "Monitoring" in `README.md`.

## Voice

Rebecca writes like a person, not a company. Short, plain, friendly and direct. Answer first. The full rules and her real examples are in `src/emailPlaybook.ts`; public pages follow the same voice.

Words she does not use: seamless, leverage, solution, streamline, "I hope this finds you well", "Thanks for reaching out!". No more than one exclamation mark.

## Writing to Rebecca

- Lead with what happened or what you need from her.
- Use measured numbers and say where they came from. If you did not check, say so.
- Report failures as plainly as successes.
