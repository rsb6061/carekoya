export type EmailSendResult = {
  delivered?: string[];
  queued?: string[];
  permanent_bounces?: string[];
  suppressed_recipients?: string[];
  message_id?: string;
};

export type EmailBinding = {
  send(message: {
    from: string;
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
  }): Promise<EmailSendResult>;
};

export function caregiverActivationEmail(firstName: string, link: string) {
  const safe = (value: string) => value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char] || char));

  const name = safe(firstName || 'there');
  const url = safe(link);
  return {
    subject: 'Your caregiver profile: confirm your availability',
    html: `<div style="background:#f7f0e6;padding:32px 18px;font-family:Arial,Helvetica,sans-serif;color:#1b153c">
      <div style="max-width:600px;margin:0 auto;background:#fffdf9;border:1px solid #d8d2ff;border-radius:24px;padding:32px">
        <div style="font-size:20px;font-weight:700;margin-bottom:28px">CareJoys</div>
        <h1 style="font-family:Georgia,serif;font-weight:400;font-size:34px;line-height:1.05;margin:0 0 18px">Are you looking for caregiver work right now?</h1>
        <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${name},</p>
        <p style="font-size:16px;line-height:1.6;color:#5f5972">You previously created a caregiver profile on CareKoya. The caregiver network is now CareJoys, where local care employers can find caregivers who are actually available.</p>
        <p style="font-size:16px;line-height:1.6;color:#5f5972"><strong>We have not marked you as actively looking.</strong> If you want to be considered for caregiver jobs, confirm and refresh your profile here:</p>
        <p style="margin:26px 0"><a href="${url}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">Confirm my availability</a></p>
        <p style="font-size:14px;line-height:1.6;color:#6e6882">You can also tell us you are not looking right now. If you take no action, your profile stays unavailable to employers.</p>
        <p style="font-size:13px;line-height:1.6;color:#8a849b;margin-top:28px">CareJoys · carejoys.com</p>
      </div>
    </div>`,
    text: `Hi ${firstName || 'there'},

You previously created a caregiver profile on CareKoya. The caregiver network is now CareJoys.

We have not marked you as actively looking. If you want to be considered for caregiver jobs, confirm and refresh your profile here:

${link}

If you take no action, your profile stays unavailable to employers.

CareJoys · carejoys.com`
  };
}

export function cloudflareEmailTest() {
  return {
    subject: 'CareJoys Cloudflare email test',
    html: '<div style="font-family:Arial,Helvetica,sans-serif"><h2>CareJoys email is live.</h2><p>This message was sent directly from the CareJoys Cloudflare Worker using Cloudflare Email Service.</p></div>',
    text: 'CareJoys email is live. This message was sent directly from the CareJoys Cloudflare Worker using Cloudflare Email Service.'
  };
}
