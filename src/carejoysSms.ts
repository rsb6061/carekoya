import { handleSmsInbound, handleSmsStatus, recordSmsConsent, sendSms, smsConsentStatus, smsReport, normalizePhone, type SendSmsInput, type SmsBrand, type SmsEnv } from './sms';

/**
 * CareJoys' use of the shared SMS module (src/sms.ts): candidates by text, agencies stay on email.
 * Nothing here sends on its own; screening texts will call sendCareJoysSms once the manual pilot shows what to say.
 */
export const CAREJOYS_SMS_BRAND = 'carejoys';
export const SMS_INBOUND_PATH = '/api/sms/inbound';
export const SMS_STATUS_PATH = '/api/sms/status';

const lastTenDigits = (phone: string) => phone.replace(/\D/g, '').slice(-10);
// caregivers.phone is stored as typed; compare on the last ten digits.
const CAREGIVER_PHONE_DIGITS = "substr(replace(replace(replace(replace(replace(replace(phone,'+',''),'-',''),' ',''),'(',''),')',''),'.',''),-10)";

function carejoysBrand(env: SmsEnv): SmsBrand {
  return {
    brand: CAREJOYS_SMS_BRAND,
    async onConsentChange(phone, status) {
      // A STOP also clears the profile flag, so nothing else in CareJoys treats the number as textable.
      if (status === 'opted_out' && env.DB)
        await env.DB.prepare(`UPDATE caregivers SET sms_consent=0,updated_at=CURRENT_TIMESTAMP WHERE sms_consent=1 AND ${CAREGIVER_PHONE_DIGITS}=?`).bind(lastTenDigits(phone)).run();
    },
    // Screening conversations hook in here: InboundSms.intent ("yes"/"no"/...) and inReplyTo.relatedType/relatedId
    // say which candidate and opening the reply is about. Until then replies are only logged.
    onInbound() {},
  };
}

export const sendCareJoysSms = (env: SmsEnv, input: SendSmsInput, origin = 'https://carejoys.com') =>
  sendSms(env, carejoysBrand(env), input, origin + SMS_STATUS_PATH);

export const handleCareJoysSmsInbound = (request: Request, env: SmsEnv) => handleSmsInbound(request, env, carejoysBrand(env));
export const handleCareJoysSmsStatus = (request: Request, env: SmsEnv) => handleSmsStatus(request, env);

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
    ip: request.headers.get('cf-connecting-ip'), userAgent: request.headers.get('user-agent'),
  });
  const result = await sendCareJoysSms(env, { to, body: 'CareJoys test text: your Twilio setup works. Reply YES to test replies. Reply STOP to opt out.', template: 'admin_test' }, new URL(request.url).origin);
  return Response.json(result, { status: result.ok ? 200 : result.reason === 'not_configured' || result.reason === 'disabled' ? 503 : 502 });
}
