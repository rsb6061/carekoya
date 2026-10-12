import { handleSmsInbound, handleSmsStatus, recordSmsConsent, sendSms, sendQueuedSms, smsConsentStatus, smsReport, smsSendingEnabled, normalizePhone, type InboundSms, type SendSmsInput, type SmsBrand, type SmsEnv } from './sms';
import { respondToInviteForCaregiver, type FeatureEnv } from './serverFeatures';
import { lockedIntroductions, type BillingEnv } from './billing';
import { stateForZipPrefix } from './usStates';
import { AGENCY_SMS_CONSENT_TEXT, SMS_CONSENT_TEXT } from './smsConsent';

/**
 * CareJoys' use of the shared SMS module (src/sms.ts). Every text is a template; there is no free-form texting.
 * - Caregivers who ticked the consent box (signup, profile, "Send my profile") get: the invitation text next to the
 *   invite email, the 2-day reminder instead of a second email, and interview reminders the day before and 2 hours before.
 * - A YES/NO reply answers their latest open invitation exactly like the email's buttons.
 * - Agencies stay on email unless they turn on "Text me when a caregiver says yes" in Settings.
 * Nothing sends unless SMS_ENABLED="true" and the Twilio secrets are set; legacy imports are never texted without the box.
 */
export const CAREJOYS_SMS_BRAND = 'carejoys';
export const SMS_INBOUND_PATH = '/api/sms/inbound';
export const SMS_STATUS_PATH = '/api/sms/status';
const ORIGIN = 'https://carejoys.com';

export { SMS_CONSENT_TEXT, AGENCY_SMS_CONSENT_TEXT };

type Row = Record<string, unknown>;
const clean = (v: unknown, max = 500) => typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '';
const lastTenDigits = (phone: string) => phone.replace(/\D/g, '').slice(-10);
// caregivers.phone is stored as typed; compare on the last ten digits.
const CAREGIVER_PHONE_DIGITS = "substr(replace(replace(replace(replace(replace(replace(phone,'+',''),'-',''),' ',''),'(',''),')',''),'.',''),-10)";
const shortLink = (code: string) => 'carejoys.com/r/' + code;
const displayPhone = (phone: string) => { const d = lastTenDigits(phone); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone; };

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Time zone by state; a few ZIP prefixes sit across a time-zone line from the rest of their state.
const ZONES: Record<string, string> = {
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago', IA: 'America/Chicago', KS: 'America/Chicago', LA: 'America/Chicago', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', NE: 'America/Chicago', ND: 'America/Chicago', OK: 'America/Chicago', SD: 'America/Chicago', TN: 'America/Chicago',
  TX: 'America/Chicago', WI: 'America/Chicago', CO: 'America/Denver', ID: 'America/Boise', MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver',
  WY: 'America/Denver', AZ: 'America/Phoenix', CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};
const ZIP3_ZONES: Array<[number, number, string]> = [
  [324, 325, 'America/Chicago'], [373, 374, 'America/New_York'], [376, 379, 'America/New_York'], [420, 424, 'America/Chicago'],
  [463, 464, 'America/Chicago'], [476, 477, 'America/Chicago'], [498, 499, 'America/Chicago'], [577, 577, 'America/Denver'],
  [690, 693, 'America/Denver'], [798, 799, 'America/Denver'], [885, 885, 'America/Denver'], [838, 838, 'America/Los_Angeles'], [979, 979, 'America/Boise'],
];
/** The recipient's time zone from their ZIP and state; Eastern when neither says. */
export function timeZoneFor(state: unknown, zip: unknown) {
  const z = clean(zip, 10).match(/^\d{5}/)?.[0];
  if (z) { const n = Number(z.slice(0, 3)); const hit = ZIP3_ZONES.find(([a, b]) => n >= a && n <= b); if (hit) return hit[2]; }
  const s = (clean(state, 2) || stateForZipPrefix(z)).toUpperCase();
  return ZONES[s] || 'America/New_York';
}

function carejoysBrand(env: SmsEnv): SmsBrand {
  return {
    brand: CAREJOYS_SMS_BRAND,
    async onConsentChange(phone, status) {
      // A STOP also clears the profile flag, so nothing else in CareJoys treats the number as textable.
      // A START does not set it back: automatic texts wait until they tick the box again.
      if (status === 'opted_out' && env.DB) {
        await env.DB.prepare(`UPDATE caregivers SET sms_consent=0,updated_at=CURRENT_TIMESTAMP WHERE sms_consent=1 AND ${CAREGIVER_PHONE_DIGITS}=?`).bind(lastTenDigits(phone)).run();
        await env.DB.prepare(`UPDATE employer_leads SET sms_alerts_enabled=0,updated_at=CURRENT_TIMESTAMP WHERE sms_alerts_enabled=1 AND sms_alert_phone=?`).bind(normalizePhone(phone)).run();
      }
    },
    onInbound: sms => answerReply(env, sms),
  };
}

export const sendCareJoysSms = (env: SmsEnv, input: SendSmsInput, origin = ORIGIN) =>
  sendSms(env, carejoysBrand(env), input, origin + SMS_STATUS_PATH);

export const handleCareJoysSmsInbound = (request: Request, env: SmsEnv) => handleSmsInbound(request, env, carejoysBrand(env));
export const handleCareJoysSmsStatus = (request: Request, env: SmsEnv) => handleSmsStatus(request, env);

// ---------- Consent ----------

const requestMeta = (request: Request) => ({ ip: request.headers.get('cf-connecting-ip'), userAgent: request.headers.get('user-agent') });
const ticked = (v: unknown) => v === true || v === 'true' || v === 1 || v === 'on';

/**
 * Applies the caregiver's text checkbox. Ticked: logs the opt-in with the exact wording, IP and browser, and sets
 * caregivers.sms_consent. Unticked where the box showed their current choice (the profile): revokes. `consent`
 * undefined leaves things as they are (a form where an unticked box just means "not now").
 */
export async function saveCaregiverSmsConsent(env: SmsEnv, request: Request, input: { caregiverId: string; consent: unknown; source: string; phone?: string; previousPhone?: string | null }) {
  if (!env.DB || input.consent === undefined || input.consent === null) return;
  const c = await env.DB.prepare('SELECT phone,sms_consent FROM caregivers WHERE id=?').bind(input.caregiverId).first<Row>();
  if (!c) return;
  const phone = normalizePhone(input.phone || c.phone);
  const previous = normalizePhone(input.previousPhone);
  const base = { brand: CAREJOYS_SMS_BRAND, source: input.source, ...requestMeta(request) };
  // A changed number: the old one stops getting texts.
  if (previous && previous !== phone && await smsConsentStatus(env, CAREJOYS_SMS_BRAND, previous) === 'opted_in')
    await recordSmsConsent(env, { ...base, phone: previous, event: 'opt_out', detail: 'Changed their mobile number' });
  if (ticked(input.consent)) {
    if (!phone) return;
    // Saving the profile again with the box still ticked is not a new opt-in.
    if (Number(c.sms_consent) === 1 && (!previous || previous === phone) && await smsConsentStatus(env, CAREJOYS_SMS_BRAND, phone) === 'opted_in') return;
    await recordSmsConsent(env, { ...base, phone, event: 'opt_in', consentText: SMS_CONSENT_TEXT });
    await env.DB.prepare('UPDATE caregivers SET sms_consent=1,sms_consent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(input.caregiverId).run();
  } else if (Number(c.sms_consent) === 1 || (phone && await smsConsentStatus(env, CAREJOYS_SMS_BRAND, phone) === 'opted_in')) {
    if (phone) await recordSmsConsent(env, { ...base, phone, event: 'opt_out', detail: 'Unticked the text checkbox' });
    await env.DB.prepare('UPDATE caregivers SET sms_consent=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(input.caregiverId).run();
  }
}

/** Settings: an agency turns "a caregiver said yes" texts on (with a mobile number) or off. Returns an error to show, or null. */
export async function saveAgencySmsAlerts(env: SmsEnv, request: Request, employerId: string, input: { enabled: unknown; phone: unknown }) {
  if (!env.DB) return 'Database not configured';
  const row = await env.DB.prepare('SELECT sms_alert_phone,sms_alerts_enabled FROM employer_leads WHERE id=?').bind(employerId).first<Row>();
  const base = { brand: CAREJOYS_SMS_BRAND, source: 'agency_settings', ...requestMeta(request), detail: 'employer ' + employerId };
  const old = normalizePhone(row?.sms_alert_phone);
  if (ticked(input.enabled)) {
    const phone = normalizePhone(input.phone);
    if (!phone) return 'Enter a 10-digit mobile number for the texts.';
    if (old && old !== phone && Number(row?.sms_alerts_enabled) === 1) await recordSmsConsent(env, { ...base, phone: old, event: 'opt_out' });
    await recordSmsConsent(env, { ...base, phone, event: 'opt_in', consentText: AGENCY_SMS_CONSENT_TEXT });
    await env.DB.prepare('UPDATE employer_leads SET sms_alert_phone=?,sms_alerts_enabled=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(phone, employerId).run();
  } else if (Number(row?.sms_alerts_enabled) === 1) {
    if (old) await recordSmsConsent(env, { ...base, phone: old, event: 'opt_out', detail: 'Turned off in Settings' });
    await env.DB.prepare('UPDATE employer_leads SET sms_alerts_enabled=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(employerId).run();
  }
  return null;
}

// ---------- Reply links ----------

/** A short carejoys.com/r/<code> link that opens the invitation like its emailed link. Only the code's hash is stored. */
async function responseLink(env: SmsEnv, pipelineId: string) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const code = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => alphabet[b % alphabet.length]).join('');
  await env.DB!.prepare('INSERT INTO sms_response_links(code_hash,pipeline_id) VALUES (?,?)').bind(await sha256Hex(code), pipelineId).run();
  return shortLink(code);
}

/** GET /r/<code>: on to the response page, where the code works as the token. */
export function responseLinkRedirect(code: string) {
  if (!/^[A-Za-z0-9]{6,20}$/.test(code)) return Response.redirect(ORIGIN + '/dashboard', 302);
  return new Response(null, { status: 302, headers: { location: '/respond?token=' + encodeURIComponent(code), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

// ---------- Caregiver texts ----------

const INVITE_SELECT = `SELECT cp.id,cp.caregiver_id,cp.response_expires_at,cp.sms_invited_at,c.phone,c.state,c.zip,c.sms_consent,
    o.title,o.role,o.city,o.state AS job_state,o.pay_min,o.pay_max,o.shift_preferences,o.status AS opening_status,e.company_name,COALESCE(e.is_test,0) AS is_test
  FROM candidate_pipeline cp JOIN caregivers c ON c.id=cp.caregiver_id JOIN openings o ON o.id=cp.opening_id JOIN employer_leads e ON e.id=o.employer_id WHERE cp.id=?`;
const textable = (r: Row | null): r is Row => !!r && Number(r.sms_consent) === 1 && !!normalizePhone(r.phone) && Number(r.is_test) !== 1;
const payText = (min: unknown, max: unknown) => {
  const a = Number(min) || 0, b = Number(max) || 0;
  return a && b && a !== b ? `$${a}–${b}/hr` : a || b ? `$${a || b}/hr` : '';
};
const article = (word: string) => /^(?:[aeiou]|hha\b|rn\b|lpn\b|lvn\b|ma\b)/i.test(word) ? 'an' : 'a';

/** "CareJoys: Bright Home Care has a CNA job in Towson, $19–22/hr, weekday days. Interested? Reply YES or NO. ..." under 300 characters. */
export function inviteText(o: { company: string; role: string; city: string; pay: string; shift: string; link: string }) {
  const build = (company: string, shift: string) => {
    const role = o.role || 'caregiver';
    const details = [`${role} job${o.city ? ' in ' + o.city : ''}`, o.pay, shift].filter(Boolean).join(', ');
    return `CareJoys: ${company} has ${article(role)} ${details}. Interested? Reply YES or NO. Details: ${o.link}. Reply STOP to opt out.`;
  };
  let text = build(o.company, o.shift.slice(0, 60));
  if (text.length > 300) text = build(o.company.slice(0, 40), o.shift.slice(0, 30));
  if (text.length > 300) text = build(o.company.slice(0, 40), '');
  return text;
}

/** The invitation by text, next to the invite email. Only when texts are on and the caregiver ticked the box. */
export async function textJobInvite(env: SmsEnv, pipelineId: string, now?: Date) {
  if (!smsSendingEnabled(env)) return null;
  const r = await env.DB!.prepare(INVITE_SELECT).bind(pipelineId).first<Row>();
  if (!textable(r) || r.sms_invited_at) return null;
  const claimed = await env.DB!.prepare('UPDATE candidate_pipeline SET sms_invited_at=CURRENT_TIMESTAMP WHERE id=? AND sms_invited_at IS NULL').bind(pipelineId).run();
  if (Number(claimed.meta?.changes || 0) !== 1) return null;
  const body = inviteText({ company: clean(r.company_name, 80) || 'An employer', role: clean(r.role, 40) || clean(r.title, 40), city: clean(r.city, 40),
    pay: payText(r.pay_min, r.pay_max), shift: clean(r.shift_preferences, 120), link: await responseLink(env, pipelineId) });
  return sendCareJoysSms(env, { to: clean(r.phone, 40), body, template: 'job_invite_v1', relatedType: 'candidate_pipeline', relatedId: pipelineId,
    timeZone: timeZoneFor(r.state, r.zip), expiresAt: clean(r.response_expires_at, 40) || undefined, now });
}

/** The 2-day reminder for an unanswered invitation, by text instead of a second email. False means send the email. */
export async function textInviteReminder(env: SmsEnv, pipelineId: string, now?: Date) {
  if (!smsSendingEnabled(env)) return false;
  const r = await env.DB!.prepare(INVITE_SELECT).bind(pipelineId).first<Row>();
  if (!textable(r)) return false;
  const body = `CareJoys: Still interested in the ${clean(r.title, 60) || 'job'} with ${clean(r.company_name, 60) || 'the employer'}? Reply YES or NO. Details: ${await responseLink(env, pipelineId)}. Reply STOP to opt out.`;
  const sent = await sendCareJoysSms(env, { to: clean(r.phone, 40), body, template: 'invite_reminder_v1', relatedType: 'candidate_pipeline', relatedId: pipelineId,
    timeZone: timeZoneFor(r.state, r.zip), expiresAt: clean(r.response_expires_at, 40) || undefined, now });
  return sent.ok;
}

const when = (iso: string, timeZone: string, withDay: boolean) => {
  try { return new Date(iso).toLocaleString('en-US', { timeZone: timeZone || 'America/New_York', ...(withDay ? { weekday: 'short', month: 'short', day: 'numeric' } : {}), hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); }
  catch { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); }
};

/** Booked interviews: one text the day before (24 to 3 hours ahead) and one about 2 hours before. Each goes once. */
export async function sendInterviewReminders(env: SmsEnv, now = new Date(), limit = 50) {
  let sent = 0;
  if (!smsSendingEnabled(env)) return sent;
  const nowIso = now.toISOString();
  const rows = await env.DB!.prepare(`SELECT cp.id,cp.interview_at,cp.sms_interview_day_at,cp.sms_interview_soon_at,c.phone,c.state,c.zip,c.sms_consent,
      o.title,e.company_name,COALESCE(e.is_test,0) AS is_test,s.location,s.timezone
    FROM candidate_pipeline cp JOIN caregivers c ON c.id=cp.caregiver_id JOIN openings o ON o.id=cp.opening_id JOIN employer_leads e ON e.id=o.employer_id
    LEFT JOIN interview_slots s ON s.id=cp.interview_slot_id
    WHERE cp.stage='interview' AND cp.interview_at IS NOT NULL AND c.sms_consent=1 AND (s.id IS NULL OR s.status='booked')
      AND datetime(cp.interview_at)>datetime(?,'+10 minutes') AND datetime(cp.interview_at)<=datetime(?,'+24 hours')
      AND (cp.sms_interview_day_at IS NULL OR cp.sms_interview_soon_at IS NULL)
    ORDER BY cp.interview_at LIMIT ?`).bind(nowIso, nowIso, limit).all<Row>();
  for (const r of rows.results || []) {
    if (!textable(r)) continue;
    const at = clean(r.interview_at, 40), ahead = Date.parse(at) - now.getTime();
    const soon = ahead <= 2 * 3600000;
    if (soon ? r.sms_interview_soon_at : r.sms_interview_day_at || ahead <= 3 * 3600000) continue;
    // Marking both for the 2-hour text means a late booking never gets a "day before" text afterwards.
    const claim = soon
      ? "UPDATE candidate_pipeline SET sms_interview_soon_at=CURRENT_TIMESTAMP,sms_interview_day_at=COALESCE(sms_interview_day_at,CURRENT_TIMESTAMP) WHERE id=? AND sms_interview_soon_at IS NULL"
      : 'UPDATE candidate_pipeline SET sms_interview_day_at=CURRENT_TIMESTAMP WHERE id=? AND sms_interview_day_at IS NULL';
    if (Number((await env.DB!.prepare(claim).bind(r.id).run()).meta?.changes || 0) !== 1) continue;
    const company = clean(r.company_name, 60) || 'the employer', where = clean(r.location, 80);
    const body = soon
      ? `CareJoys: Your interview with ${company} is today at ${when(at, clean(r.timezone, 60), false)}, in about 2 hours.${where ? ' Where: ' + where + '.' : ''} Reply STOP to opt out.`
      : `CareJoys reminder: your interview with ${company} for ${clean(r.title, 60) || 'the job'} is ${when(at, clean(r.timezone, 60), true)}.${where ? ' Where: ' + where + '.' : ''} Reply STOP to opt out.`;
    const result = await sendCareJoysSms(env, { to: clean(r.phone, 40), body, template: soon ? 'interview_soon_v1' : 'interview_day_v1', relatedType: 'candidate_pipeline',
      relatedId: clean(r.id, 100), timeZone: timeZoneFor(r.state, r.zip), expiresAt: at, now });
    if (result.ok) sent++;
  }
  return sent;
}

/** Cron: texts held for quiet hours, then interview reminders. Nothing runs while texts are off. */
export async function runCareJoysSmsJobs(env: SmsEnv, now = new Date()) {
  if (!smsSendingEnabled(env)) return null;
  const queued = await sendQueuedSms(env, carejoysBrand(env), ORIGIN + SMS_STATUS_PATH, now);
  const reminders = await sendInterviewReminders(env, now);
  return { queued, reminders };
}

// ---------- Agency alert ----------

/** "CareJoys: Maria said yes to CNA - Towson. Call them now: ..." to an agency that opted in. Never for a locked yes. */
export async function textAgencyYes(env: SmsEnv, pipelineId: string, now?: Date) {
  if (!smsSendingEnabled(env)) return null;
  const r = await env.DB!.prepare(`SELECT cp.id,cp.agency_texted_at,c.first_name,c.display_name,c.phone,c.email,o.title,e.id AS employer_id,e.zip,e.sms_alerts_enabled,e.sms_alert_phone,COALESCE(e.is_test,0) AS is_test
    FROM candidate_pipeline cp JOIN caregivers c ON c.id=cp.caregiver_id JOIN openings o ON o.id=cp.opening_id JOIN employer_leads e ON e.id=o.employer_id
    WHERE cp.id=? AND cp.response_value='interested'`).bind(pipelineId).first<Row>();
  if (!r || Number(r.sms_alerts_enabled) !== 1 || !normalizePhone(r.sms_alert_phone) || Number(r.is_test) === 1 || r.agency_texted_at) return null;
  // Past the free introductions the agency can't see who it is yet, so there's no one to call.
  if ((await lockedIntroductions(env as unknown as BillingEnv, clean(r.employer_id, 100))).has(pipelineId)) return null;
  const claimed = await env.DB!.prepare('UPDATE candidate_pipeline SET agency_texted_at=CURRENT_TIMESTAMP WHERE id=? AND agency_texted_at IS NULL').bind(pipelineId).run();
  if (Number(claimed.meta?.changes || 0) !== 1) return null;
  const name = clean(r.first_name, 40) || clean(r.display_name, 80).split(/\s+/)[0] || 'A caregiver';
  const phone = normalizePhone(r.phone);
  const reach = phone ? `Call them now: ${displayPhone(phone)}.` : `Email them now: ${clean(r.email, 120)}.`;
  return sendCareJoysSms(env, { to: clean(r.sms_alert_phone, 40), body: `CareJoys: ${name} said yes to ${clean(r.title, 80) || 'your job'}. ${reach} Reply STOP to opt out.`,
    template: 'agency_yes_v1', relatedType: 'candidate_pipeline', relatedId: pipelineId, timeZone: timeZoneFor('', r.zip), now });
}

// ---------- Replies ----------

const PENDING_INVITE = `SELECT cp.id,cp.caregiver_id,e.company_name FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id JOIN employer_leads e ON e.id=o.employer_id
  WHERE cp.contacted_at IS NOT NULL AND cp.stage='contacted' AND cp.response_value IS NULL AND o.status='open'
    AND (cp.response_expires_at IS NULL OR datetime(cp.response_expires_at)>datetime('now'))`;

/**
 * A caregiver's reply: YES or NO answers the invitation the text was about (else their latest open one), through
 * the same code as the email's buttons. Anything else gets the choices again.
 */
async function answerReply(env: SmsEnv, sms: InboundSms): Promise<string | void> {
  if (!env.DB) return;
  // Agency alerts are one-way; their replies are only logged.
  if (sms.inReplyTo?.template?.startsWith('agency_')) return;
  const people = (await env.DB.prepare(`SELECT id FROM caregivers WHERE ${CAREGIVER_PHONE_DIGITS}=?`).bind(lastTenDigits(sms.phone)).all<{ id: string }>()).results || [];
  const ids = people.map(p => p.id);
  let invite: Row | null = null;
  if (ids.length) {
    const mine = `AND cp.caregiver_id IN (${ids.map(() => '?').join(',')})`;
    if (sms.inReplyTo?.relatedType === 'candidate_pipeline' && sms.inReplyTo.relatedId)
      invite = await env.DB.prepare(`${PENDING_INVITE} ${mine} AND cp.id=? LIMIT 1`).bind(...ids, sms.inReplyTo.relatedId).first<Row>();
    invite ||= await env.DB.prepare(`${PENDING_INVITE} ${mine} ORDER BY cp.contacted_at DESC LIMIT 1`).bind(...ids).first<Row>();
  }
  if (!invite) return 'CareJoys: You have no open job invitations right now. We’ll text you when an employer invites you. See jobs near you: carejoys.com/dashboard';
  const pipelineId = clean(invite.id, 100), company = clean(invite.company_name, 80) || 'the employer';
  if (sms.intent !== 'yes' && sms.intent !== 'no') return `CareJoys: Reply YES or NO, or tap the link: ${await responseLink(env, pipelineId)}`;
  const res = await respondToInviteForCaregiver(env as unknown as FeatureEnv, clean(invite.caregiver_id, 100), pipelineId, sms.intent === 'yes' ? 'interested' : 'not_interested', 'sms');
  if (!res.ok) return `CareJoys: We couldn’t record that. Tap the link to answer: ${await responseLink(env, pipelineId)}`;
  return sms.intent === 'yes'
    ? `CareJoys: Thanks! We told ${company} you’re interested. They’ll contact you. Details and interview times: ${await responseLink(env, pipelineId)}`
    : `CareJoys: Got it. We told ${company} you’re not interested. We’ll keep sending jobs that fit you.`;
}

// ---------- Admin ----------

/** GET /api/admin/sms: delivery and reply counts per template and the latest texts. */
export async function adminSmsReport(env: SmsEnv) {
  return Response.json({ ok: true, ...await smsReport(env, CAREJOYS_SMS_BRAND) }, { headers: { 'cache-control': 'no-store' } });
}

/**
 * POST /api/admin/sms/test {to}: texts the admin's own phone to check the Twilio setup end to end.
 * The admin's request is logged as that number's opt-in, unless the number has texted STOP.
 */
export async function adminSmsTest(request: Request, env: SmsEnv, adminEmail: string) {
  const data = await request.json().catch(() => null) as { to?: string } | null;
  const to = normalizePhone(data?.to);
  if (!to) return Response.json({ ok: false, error: 'Enter a mobile number' }, { status: 400 });
  // An admin request never overrides a STOP; the phone's owner texts START to opt back in.
  if (await smsConsentStatus(env, CAREJOYS_SMS_BRAND, to) === 'opted_out') return Response.json({ ok: false, error: 'That number texted STOP. Text START to the CareJoys number first.' }, { status: 409 });
  await recordSmsConsent(env, {
    brand: CAREJOYS_SMS_BRAND, phone: to, event: 'opt_in', source: 'admin_test',
    consentText: `Admin ${adminEmail || '(token)'} requested a test text to this number.`,
    ...requestMeta(request),
  });
  // Asked for just now, so it goes straight away, outside the quiet hours and the weekly cap.
  const result = await sendCareJoysSms(env, { to, body: 'CareJoys test text: your Twilio setup works. Reply YES to test replies. Reply STOP to opt out.', template: 'admin_test', immediate: true }, new URL(request.url).origin);
  return Response.json(result, { status: result.ok ? 200 : result.reason === 'not_configured' || result.reason === 'disabled' ? 503 : 502 });
}
