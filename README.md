# CareKoya

CareKoya is a caregiver workforce network for home-care and senior-care employers.

> **Caregivers ready to work. Interviews ready for you.**

This repository is the canonical source for the post-Floot rebuild.

## Product thesis

Most recruiting products optimize for applicant volume. CareKoya is designed around a harder question: **who is reachable, qualified enough for this opening, and interested now?**

The long-term asset is a persistent caregiver workforce graph: location, role, credentials, shift preferences, wage expectations, commute radius, availability freshness, response history, interview outcomes, and later retention.

## Current MVP

- Employer-first B2B landing page
- Caregiver workforce positioning
- School / new-graduate acquisition channel
- Freshness-driven candidate model
- GitHub CI
- Vite + React static build, ready for Cloudflare

## Next infrastructure step

Connect this repository to Cloudflare Workers/Pages for automatic deploys from `main`. The application backend and caregiver-data migration will be added after the Cloudflare project/database is provisioned.

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
