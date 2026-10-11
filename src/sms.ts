/**
 * Shared two-way SMS over a Twilio Messaging Service. Brand-agnostic on purpose: it imports nothing from the
 * rest of the app, so another brand can copy this file and migrations/0062_sms.sql and run it with its own
 * Messaging Service (same Twilio account, a different TWILIO_MESSAGING_SERVICE_SID and brand name).
 *
 * - sendSms: sends only to numbers with a logged opt-in, never to an opted-out number, and logs every send.
 * - handleSmsInbound (Twilio "incoming message" webhook): logs the text, applies STOP/START/HELP to consent,
 *   links it to the last text we sent that number and hands it to the brand's onInbound hook, which can
 *   advance a conversation ("yes" counts like a button tap) and optionally answer.
 * - handleSmsStatus (Twilio status callback): records queued -> sent -> delivered/undelivered/failed with
 *   Twilio's error code, so "no reply" and "not delivered" read differently.
 *
 * Everything stays dormant until TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID exist;
 * sendSms additionally needs SMS_ENABLED="true". Webhooks reject any request without a valid Twilio signature.
 */

interface SmsStatement {
  bind(...values: unknown[]): SmsStatement;
  run(): Promise<{ success?: boolean; meta?: Record<string, unknown> }>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface SmsDatabase { prepare(query: string): SmsStatement }

export interface SmsEnv {
  DB?: SmsDatabase;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
  SMS_ENABLED?: string;
}

export type SmsIntent = 'yes' | 'no' | 'stop' | 'start' | 'help' | 'other';

export interface InboundSms {
  id: string;
  phone: string;
  body: string;
  intent: SmsIntent;
  /** The last text we sent this number, if any: what the reply is answering. */
  inReplyTo: { id: string; template: string | null; relatedType: string | null; relatedId: string | null } | null;
}

export interface SmsBrand {
  /** Stored on every row, e.g. "carejoys". */
  brand: string;
  /** Advance conversation state for a reply. Return text to answer in the same exchange, or nothing. */
  onInbound?(sms: InboundSms): Promise<string | void> | string | void;
  /** Mirror an opt-out or opt-in into the brand's own records (e.g. a profile flag). */
  onConsentChange?(phone: string, status: 'opted_in' | 'opted_out'): Promise<void> | void;
  fetch?: typeof fetch;
}

export interface SendSmsInput {
  to: string;
  body: string;
  /** Template name, so reply rates can be compared per message wording. */
  template?: string;
  /** What this text is about (e.g. "candidate_pipeline" + its id); replies inherit it. */
  relatedType?: string;
  relatedId?: string;
}

export type SendSmsResult =
  | { ok: true; id: string; sid: string; status: string }
  | { ok: false; id?: string; reason: 'not_configured' | 'disabled' | 'invalid_phone' | 'empty_body' | 'no_consent' | 'opted_out' | 'twilio_error'; error?: string };

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

export const smsConfigured = (env: SmsEnv) => Boolean(env.DB && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_MESSAGING_SERVICE_SID);
export const smsSendingEnabled = (env: SmsEnv) => smsConfigured(env) && String(env.SMS_ENABLED || '').toLowerCase() === 'true';

/** US numbers to E.164 (+1XXXXXXXXXX); other numbers must already start with "+". Null when it can't be a phone. */
export function normalizePhone(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? '+' + digits : null;
  if (digits.length === 10) return /^[2-9]\d{2}[2-9]/.test(digits) ? '+1' + digits : null;
  if (digits.length === 11 && digits.startsWith('1')) return /^1[2-9]\d{2}[2-9]/.test(digits) ? '+' + digits : null;
  return null;
}

// Twilio's default opt-out / opt-in / help keywords (Advanced Opt-Out). The Messaging Service answers these itself.
const STOP_WORDS = new Set(['stop', 'stopall', 'stop all', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt out', 'revoke']);
const START_WORDS = new Set(['start', 'unstop']);
const HELP_WORDS = new Set(['help', 'info']);
const YES_WORDS = new Set(['yes', 'y', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'interested', 'still interested', 'i am interested', 'im interested', "i'm interested"]);
const NO_WORDS = new Set(['no', 'n', 'nope', 'not interested', 'no thanks', 'no thank you']);

/** Reads a reply as yes/no/stop/start/help. Twilio's OptOutType parameter wins when present. */
export function classifySmsReply(body: unknown, optOutType?: string | null): SmsIntent {
  const type = String(optOutType || '').toUpperCase();
  if (type === 'STOP') return 'stop';
  if (type === 'START') return 'start';
  if (type === 'HELP') return 'help';
  const text = String(body ?? '').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (STOP_WORDS.has(text)) return 'stop';
  if (START_WORDS.has(text)) return 'start';
  if (HELP_WORDS.has(text)) return 'help';
  if (YES_WORDS.has(text) || /^yes\b/.test(text)) return 'yes';
  if (NO_WORDS.has(text) || /^no\b/.test(text)) return 'no';
  return 'other';
}

const randomId = (prefix: string) => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
const clip = (value: unknown, max: number) => String(value ?? '').slice(0, max);

/** Current consent for a number: 'opted_in', 'opted_out' or null (never asked). */
export async function smsConsentStatus(env: SmsEnv, brand: string, phone: string) {
  const e164 = normalizePhone(phone);
  if (!env.DB || !e164) return null;
  const row = await env.DB.prepare('SELECT status FROM sms_consents WHERE brand=? AND phone=?').bind(brand, e164).first<{ status: string }>();
  return (row?.status as 'opted_in' | 'opted_out' | undefined) || null;
}

/**
 * Logs consent with the exact wording the person agreed to (or a STOP/START/HELP). Call this where the
 * person ticks the box, e.g. claim or application, with the checkbox text as consentText.
 */
export async function recordSmsConsent(env: SmsEnv, input: { brand: string; phone: string; event: 'opt_in' | 'opt_out' | 'help'; source: string; consentText?: string; ip?: string | null; userAgent?: string | null; detail?: string }) {
  const e164 = normalizePhone(input.phone);
  if (!env.DB || !e164) return { ok: false as const };
  await env.DB.prepare('INSERT INTO sms_consent_events(id,brand,phone,event,source,consent_text,ip,user_agent,detail) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(randomId('smc_'), input.brand, e164, input.event, clip(input.source, 80), input.consentText ? clip(input.consentText, 2000) : null, input.ip ? clip(input.ip, 64) : null, input.userAgent ? clip(input.userAgent, 400) : null, input.detail ? clip(input.detail, 400) : null).run();
  if (input.event !== 'help') {
    const status = input.event === 'opt_in' ? 'opted_in' : 'opted_out';
    await env.DB.prepare(`INSERT INTO sms_consents(brand,phone,status,source,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(brand,phone) DO UPDATE SET status=excluded.status,source=excluded.source,updated_at=CURRENT_TIMESTAMP`)
      .bind(input.brand, e164, status, clip(input.source, 80)).run();
  }
  return { ok: true as const, phone: e164 };
}

/** Sends one text through the Messaging Service. Requires a logged opt-in; every attempt that reaches Twilio is logged. */
export async function sendSms(env: SmsEnv, brand: SmsBrand, input: SendSmsInput, statusCallbackUrl: string): Promise<SendSmsResult> {
  if (!smsConfigured(env)) return { ok: false, reason: 'not_configured' };
  if (!smsSendingEnabled(env)) return { ok: false, reason: 'disabled' };
  const to = normalizePhone(input.to);
  if (!to) return { ok: false, reason: 'invalid_phone' };
  const body = String(input.body ?? '').trim();
  if (!body) return { ok: false, reason: 'empty_body' };
  const consent = await smsConsentStatus(env, brand.brand, to);
  if (consent === 'opted_out') return { ok: false, reason: 'opted_out' };
  if (consent !== 'opted_in') return { ok: false, reason: 'no_consent' };

  const id = randomId('sms_');
  await env.DB!.prepare('INSERT INTO sms_messages(id,brand,direction,phone,body,template,related_type,related_id,status) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, brand.brand, 'outbound', to, clip(body, 1600), input.template || null, input.relatedType || null, input.relatedId || null, 'sending').run();
  const form = new URLSearchParams({ To: to, Body: body, MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID!, StatusCallback: statusCallbackUrl });
  let response: Response;
  try {
    response = await (brand.fetch || fetch)(`${TWILIO_API}/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID!)}/Messages.json`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`), 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  } catch (error) {
    await markFailed(env, id, null, String((error as Error)?.message || error));
    return { ok: false, id, reason: 'twilio_error', error: 'Could not reach Twilio' };
  }
  const data = await response.json().catch(() => ({})) as { sid?: string; status?: string; code?: number; message?: string };
  if (!response.ok || !data.sid) {
    // 21610: the number texted STOP to this Messaging Service; keep our records in step.
    if (data.code === 21610) await applyConsent(env, brand, to, 'opt_out', 'twilio_21610');
    await markFailed(env, id, data.code ?? response.status, data.message || 'Twilio rejected the message');
    return { ok: false, id, reason: data.code === 21610 ? 'opted_out' : 'twilio_error', error: data.message };
  }
  const status = data.status || 'queued';
  await env.DB!.prepare('UPDATE sms_messages SET twilio_sid=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(data.sid, status, id).run();
  return { ok: true, id, sid: data.sid, status };
}

async function markFailed(env: SmsEnv, id: string, code: unknown, message: string) {
  await env.DB!.prepare("UPDATE sms_messages SET status='failed',error_code=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(code == null ? null : String(code), clip(message, 400), id).run();
}

async function applyConsent(env: SmsEnv, brand: SmsBrand, phone: string, event: 'opt_in' | 'opt_out' | 'help', source: string, detail?: string) {
  await recordSmsConsent(env, { brand: brand.brand, phone, event, source, detail });
  if (event !== 'help') await brand.onConsentChange?.(phone, event === 'opt_in' ? 'opted_in' : 'opted_out');
}

/** Twilio's request signature: base64 HMAC-SHA1 over the full URL plus every POST field (sorted by name) as name+value. */
export async function twilioSignature(authToken: string, url: string, params: Iterable<[string, string]>) {
  const sorted = [...params].sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const payload = url + sorted.map(([k, v]) => k + v).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return btoa(String.fromCharCode(...mac));
}

export async function verifyTwilioSignature(authToken: string, url: string, params: Iterable<[string, string]>, signature: string) {
  if (!authToken || !signature) return false;
  const expected = await twilioSignature(authToken, url, params);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

const xmlEscape = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] || ch));
const twiml = (reply?: string | void) => new Response(
  `<?xml version="1.0" encoding="UTF-8"?><Response>${reply ? `<Message>${xmlEscape(reply)}</Message>` : ''}</Response>`,
  { headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' } },
);

/** Parses and authenticates a Twilio webhook: the form fields, or the response to send back when it isn't one. */
async function twilioWebhook(request: Request, env: SmsEnv): Promise<{ error: Response } | { params: URLSearchParams }> {
  if (!smsConfigured(env)) return { error: new Response('SMS is not configured', { status: 503 }) };
  if (request.method !== 'POST') return { error: new Response('Method not allowed', { status: 405 }) };
  const params = new URLSearchParams(await request.text());
  if (!(await verifyTwilioSignature(env.TWILIO_AUTH_TOKEN!, request.url, params, request.headers.get('x-twilio-signature') || '')))
    return { error: new Response('Invalid signature', { status: 403 }) };
  if (params.get('AccountSid') !== env.TWILIO_ACCOUNT_SID) return { error: new Response('Wrong account', { status: 403 }) };
  return { params };
}

/** Twilio "A message comes in" webhook for the brand's Messaging Service. */
export async function handleSmsInbound(request: Request, env: SmsEnv, brand: SmsBrand) {
  const parsed = await twilioWebhook(request, env);
  if ('error' in parsed) return parsed.error;
  const p = parsed.params;
  const phone = normalizePhone(p.get('From'));
  const sid = clip(p.get('MessageSid') || p.get('SmsSid'), 64);
  if (!phone || !sid) return twiml();
  // Twilio retries webhooks; a repeat of a message already logged changes nothing.
  const seen = await env.DB!.prepare('SELECT id FROM sms_messages WHERE twilio_sid=?').bind(sid).first();
  if (seen) return twiml();

  const body = clip(p.get('Body'), 1600);
  const intent = classifySmsReply(body, p.get('OptOutType'));
  const last = await env.DB!.prepare("SELECT id,template,related_type,related_id FROM sms_messages WHERE brand=? AND phone=? AND direction='outbound' ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .bind(brand.brand, phone).first<{ id: string; template: string | null; related_type: string | null; related_id: string | null }>();
  const id = randomId('sms_');
  await env.DB!.prepare('INSERT INTO sms_messages(id,brand,direction,phone,body,template,related_type,related_id,twilio_sid,status,intent,in_reply_to) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, brand.brand, 'inbound', phone, body, last?.template ?? null, last?.related_type ?? null, last?.related_id ?? null, sid, 'received', intent, last?.id ?? null).run();

  // The Messaging Service already answers STOP/START/HELP; we only record them and stay quiet.
  if (intent === 'stop') { await applyConsent(env, brand, phone, 'opt_out', 'sms_keyword', body); return twiml(); }
  if (intent === 'start') { await applyConsent(env, brand, phone, 'opt_in', 'sms_keyword', body); return twiml(); }
  if (intent === 'help') { await applyConsent(env, brand, phone, 'help', 'sms_keyword', body); return twiml(); }

  const reply = await brand.onInbound?.({
    id, phone, body, intent,
    inReplyTo: last ? { id: last.id, template: last.template, relatedType: last.related_type, relatedId: last.related_id } : null,
  });
  return twiml(reply);
}

// Status callbacks can arrive out of order; never move a message backwards (e.g. "sent" after "delivered").
const STATUS_RANK: Record<string, number> = { accepted: 0, scheduled: 0, queued: 1, sending: 2, sent: 3, delivered: 4, undelivered: 4, failed: 4, canceled: 4, read: 5 };

/** Twilio status callback: records delivery outcome per outbound message. */
export async function handleSmsStatus(request: Request, env: SmsEnv) {
  const parsed = await twilioWebhook(request, env);
  if ('error' in parsed) return parsed.error;
  const p = parsed.params;
  const sid = clip(p.get('MessageSid') || p.get('SmsSid'), 64);
  const status = clip(p.get('MessageStatus') || p.get('SmsStatus'), 30).toLowerCase();
  if (!sid || !(status in STATUS_RANK)) return new Response(null, { status: 204 });
  const row = await env.DB!.prepare('SELECT status FROM sms_messages WHERE twilio_sid=?').bind(sid).first<{ status: string }>();
  if (row && (STATUS_RANK[row.status] ?? -1) < STATUS_RANK[status]) {
    const code = p.get('ErrorCode');
    await env.DB!.prepare(`UPDATE sms_messages SET status=?,error_code=COALESCE(?,error_code),error_message=COALESCE(?,error_message),
      delivered_at=CASE WHEN ?='delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END,updated_at=CURRENT_TIMESTAMP WHERE twilio_sid=?`)
      .bind(status, code || null, code ? twilioErrorText(code) : null, status, sid).run();
  }
  return new Response(null, { status: 204 });
}

// The delivery errors worth reading in plain words; anything else keeps just its code.
const TWILIO_ERRORS: Record<string, string> = {
  '30003': 'Phone unreachable or off',
  '30004': 'Message blocked by the recipient or carrier',
  '30005': 'Unknown or inactive number',
  '30006': 'Landline or unreachable carrier',
  '30007': 'Filtered by the carrier (check toll-free verification or 10DLC registration)',
  '30008': 'Unknown delivery error',
  '30032': 'Toll-free number is not verified yet',
  '30034': 'Number is not registered for 10DLC yet',
  '21610': 'Recipient replied STOP',
};
export const twilioErrorText = (code: string) => TWILIO_ERRORS[code] || `Twilio error ${code}`;

/** Delivery and reply counts per template, plus the latest texts, for an admin view. */
export async function smsReport(env: SmsEnv, brand: string, limit = 100) {
  if (!env.DB) return { configured: false, sendingEnabled: false, totals: [], recent: [] };
  const totals = await env.DB.prepare(`SELECT COALESCE(o.template,'') AS template, COUNT(*) AS sent,
      SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN o.status IN ('undelivered','failed') THEN 1 ELSE 0 END) AS not_delivered,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM sms_messages i WHERE i.in_reply_to=o.id AND i.direction='inbound') THEN 1 ELSE 0 END) AS replied
    FROM sms_messages o WHERE o.brand=? AND o.direction='outbound' GROUP BY COALESCE(o.template,'') ORDER BY sent DESC`).bind(brand).all();
  const recent = await env.DB.prepare(`SELECT id,direction,phone,body,template,related_type,related_id,status,error_code,error_message,intent,in_reply_to,created_at,delivered_at
    FROM sms_messages WHERE brand=? ORDER BY created_at DESC, rowid DESC LIMIT ?`).bind(brand, Math.max(1, Math.min(500, limit))).all();
  return { configured: smsConfigured(env), sendingEnabled: smsSendingEnabled(env), totals: totals.results || [], recent: recent.results || [] };
}
