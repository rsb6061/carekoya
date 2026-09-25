export type EmailSendResult = {
  messageId?: string;
};

export type EmailAttachment = {
  content: string | ArrayBuffer | ArrayBufferView;
  filename: string;
  type: string;
  disposition: 'attachment' | 'inline';
};

export type EmailBinding = {
  send(message: {
    from: string;
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
    attachments?: EmailAttachment[];
    headers?: Record<string,string>;
  }): Promise<EmailSendResult>;
};

const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
}[char] || char));

function shell(title:string, body:string) {
  return `<div style="background:#f7f0e6;padding:32px 18px;font-family:Arial,Helvetica,sans-serif;color:#1b153c">
    <div style="max-width:600px;margin:0 auto;background:#fffdf9;border:1px solid #d8d2ff;border-radius:24px;padding:32px">
      <div style="font-size:20px;font-weight:700;margin-bottom:28px">CareJoys</div>
      <h1 style="font-family:Georgia,serif;font-weight:400;font-size:34px;line-height:1.05;margin:0 0 18px">${esc(title)}</h1>
      ${body}
      <p style="font-size:13px;line-height:1.6;color:#8a849b;margin-top:28px">CareJoys · carejoys.com</p>
    </div>
  </div>`;
}

export function employerMagicLinkEmail(name:string, link:string) {
  const first=esc(name||'there');
  const url=esc(link);
  return {
    subject:'Your CareJoys sign-in link',
    html:shell('Sign in to CareJoys',`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${first},</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Use this secure link to open your CareJoys recruiting workspace. It expires in 15 minutes and can only be used once.</p>
      <p style="margin:26px 0"><a href="${url}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">Open my workspace</a></p>
      <p style="font-size:14px;line-height:1.6;color:#6e6882">If you did not request this link, you can ignore this email.</p>`),
    text:`Hi ${name||'there'},\n\nUse this secure link to sign in to your CareJoys recruiting workspace. It expires in 15 minutes and can only be used once:\n\n${link}\n\nIf you did not request this link, ignore this email.\n\nCareJoys · carejoys.com`
  };
}

export function caregiverActivationEmail(firstName: string, link: string) {
  const name=esc(firstName||'there');
  const url=esc(link);
  return {
    subject:'Your caregiver profile: confirm your availability',
    html:shell('Are you looking for caregiver work right now?',`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${name},</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">You previously created a caregiver profile on CareKoya. The caregiver network is now CareJoys.</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Your profile may be discoverable to care employers, but your availability is shown as <strong>unconfirmed</strong> until you refresh it. Confirm here if you are currently looking:</p>
      <p style="margin:26px 0"><a href="${url}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">Confirm my availability</a></p>
      <p style="font-size:14px;line-height:1.6;color:#6e6882">You can also tell us you are not looking, which will remove your profile from employer search.</p>`),
    text:`Hi ${firstName||'there'},\n\nYou previously created a caregiver profile on CareKoya. The caregiver network is now CareJoys. Your profile may be discoverable to care employers, but your availability is shown as unconfirmed until you refresh it.\n\nConfirm or update your availability:\n${link}\n\nCareJoys · carejoys.com`
  };
}

export function caregiverJobInviteEmail(input:{
  firstName:string; company:string; title:string; role:string; location:string; pay:string; shift:string; link:string;
}) {
  const location=esc(input.location||'Location provided by employer');
  const pay=esc(input.pay||'Pay discussed with employer');
  const shift=esc(input.shift||'Shift details provided by employer');
  const url=esc(input.link);
  return {
    subject:`${input.company}: interested in this ${input.role||'caregiver'} role?`,
    html:shell('A local employer wants to know if you’re interested',`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${esc(input.firstName||'there')},</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972"><strong>${esc(input.company)}</strong> is hiring for <strong>${esc(input.title)}</strong>.</p>
      <div style="background:#f0edff;border:1px solid #d8d2ff;border-radius:18px;padding:16px 18px;margin:20px 0;color:#4f4962;line-height:1.7">
        <div>${location}</div><div>${pay}</div><div>${shift}</div>
      </div>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Tap below to see the details and tell CareJoys whether you’re interested. If you are, you can choose an available interview time if the employer has added one.</p>
      <p style="margin:26px 0"><a href="${url}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">View job and respond</a></p>`),
    text:`Hi ${input.firstName||'there'},\n\n${input.company} is hiring for ${input.title}.\n${input.location}\n${input.pay}\n${input.shift}\n\nView the job and respond here:\n${input.link}\n\nCareJoys · carejoys.com`
  };
}

export function interviewConfirmedEmail(input:{
  recipientName:string; company:string; caregiverName:string; title:string; startsLabel:string;
}) {
  return {
    subject:`Interview confirmed: ${input.title}`,
    html:shell('Your CareJoys interview is booked',`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${esc(input.recipientName||'there')},</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">The interview for <strong>${esc(input.title)}</strong> with <strong>${esc(input.company)}</strong> and <strong>${esc(input.caregiverName)}</strong> is confirmed.</p>
      <p style="font-size:18px;font-weight:700;margin:22px 0">${esc(input.startsLabel)}</p>
      <p style="font-size:14px;line-height:1.6;color:#6e6882">A calendar invite is attached. The employer should follow up directly with the interview format or meeting location.</p>`),
    text:`Hi ${input.recipientName||'there'},\n\nYour CareJoys interview for ${input.title} with ${input.company} and ${input.caregiverName} is confirmed for ${input.startsLabel}.\n\nA calendar invite is attached.\n\nCareJoys · carejoys.com`
  };
}

export function cloudflareEmailTest() {
  return {
    subject:'CareJoys Cloudflare email test',
    html:'<div style="font-family:Arial,Helvetica,sans-serif"><h2>CareJoys email is live.</h2><p>This message was sent directly from the CareJoys Cloudflare Worker using Cloudflare Email Service.</p></div>',
    text:'CareJoys email is live. This message was sent directly from the CareJoys Cloudflare Worker using Cloudflare Email Service.'
  };
}
