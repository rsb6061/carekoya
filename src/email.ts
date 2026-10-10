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

export function loginLinkEmail(link: string) {
  const url=esc(link);
  return {
    subject:'Your CareJoys sign-in link',
    html:shell('Sign in to CareJoys',`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi there,</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Use this secure link to sign in to CareJoys. It expires in 60 minutes and can only be used once.</p>
      <p style="margin:26px 0"><a href="${url}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">Sign in to CareJoys</a></p>
      <p style="font-size:14px;line-height:1.6;color:#6e6882">If you did not request this link, you can ignore this email.</p>`),
    text:`Hi there,\n\nUse this secure link to sign in to CareJoys. It expires in 60 minutes and can only be used once:\n\n${link}\n\nIf you did not request this link, ignore this email.\n\nCareJoys · carejoys.com`
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

/** Second and last reactivation email, for legacy caregivers who got the first one and haven't confirmed. */
export function caregiverActivationReminderEmail(firstName: string, link: string) {
  const name=esc(firstName||'there');
  const url=esc(link);
  return {
    subject:'Still looking for caregiver work? Confirm your CareJoys profile',
    html:shell('Your caregiver profile is waiting',`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${name},</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">A quick reminder: your CareKoya caregiver profile is now on CareJoys, and it still shows your availability as <strong>unconfirmed</strong>.</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">CareJoys now lists more than 1,500 caregiver jobs from home care agencies, and once your profile is confirmed you can apply in one click. It takes about a minute.</p>
      <p style="margin:26px 0"><a href="${url}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">Confirm my availability</a></p>
      <p style="font-size:14px;line-height:1.6;color:#6e6882">Not looking right now? Use the same link to tell us, and we'll remove your profile from employer search. This link replaces the one we sent in September.</p>`),
    text:`Hi ${firstName||'there'},\n\nA quick reminder: your CareKoya caregiver profile is now on CareJoys, and it still shows your availability as unconfirmed. CareJoys now lists more than 1,500 caregiver jobs from home care agencies, and once your profile is confirmed you can apply in one click.\n\nConfirm or update your availability:\n${link}\n\nNot looking right now? Use the same link to tell us, and we'll remove your profile from employer search. This link replaces the one we sent in September.\n\nCareJoys · carejoys.com`
  };
}

export function caregiverJobInviteEmail(input:{
  firstName:string; company:string; title:string; role:string; location:string; pay:string; shift:string; link:string;
  /** The employer's own words about working there, from their workspace settings. */
  about?:string; benefits?:string;
}) {
  const aboutHtml=input.about||input.benefits?`<div style="margin:20px 0;color:#4f4962;line-height:1.7">${input.about?`<p style="margin:0 0 8px"><strong>About ${esc(input.company)}:</strong> ${esc(input.about)}</p>`:''}${input.benefits?`<p style="margin:0"><strong>Benefits:</strong> ${esc(input.benefits)}</p>`:''}</div>`:'';
  const aboutText=[input.about?`About ${input.company}: ${input.about}`:'',input.benefits?`Benefits: ${input.benefits}`:''].filter(Boolean).join('\n');
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
      </div>${aboutHtml}
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Tap below to see the details and tell CareJoys whether you’re interested. If you are, you can choose an available interview time if the employer has added one.</p>
      <p style="margin:26px 0"><a href="${url}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">View job and respond</a></p>`),
    text:`Hi ${input.firstName||'there'},\n\n${input.company} is hiring for ${input.title}.\n${input.location}\n${input.pay}\n${input.shift}${aboutText?'\n\n'+aboutText:''}\n\nView the job and respond here:\n${input.link}\n\nCareJoys · carejoys.com`
  };
}

export function employerCandidateInterestedEmail(input:{
  recipientName:string; caregiverName:string; caregiverEmail:string; title:string; location:string; appLink:string; hasInterviewSlots:boolean; locked?:boolean;
}) {
  if(input.locked)return {
    subject:`Interested candidate: ${input.caregiverName} — ${input.title}`,
    html:shell('A caregiver is interested',`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${esc(input.recipientName||'there')},</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972"><strong>${esc(input.caregiverName)}</strong> said they are interested in <strong>${esc(input.title)}</strong>${input.location?' in '+esc(input.location):''}.</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Your free introductions are used up. Upgrade in your workspace to see how to reach them.</p>
      <p style="margin:26px 0"><a href="${esc(input.appLink)}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">Open recruiting workspace</a></p>`),
    text:`Hi ${input.recipientName||'there'},\n\n${input.caregiverName} is interested in ${input.title}${input.location?' in '+input.location:''}.\n\nYour free introductions are used up. Upgrade in your workspace to see how to reach them.\n\n${input.appLink}\n\nCareJoys · carejoys.com`
  };
  return {
    subject:`Interested candidate: ${input.caregiverName} — ${input.title}`,
    html:shell('A caregiver is interested',`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${esc(input.recipientName||'there')},</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972"><strong>${esc(input.caregiverName)}</strong> said they are interested in <strong>${esc(input.title)}</strong>${input.location?' in '+esc(input.location):''}.</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">The caregiver confirmed interest in this job, so you can reach them at <a href="mailto:${esc(input.caregiverEmail)}">${esc(input.caregiverEmail)}</a>.</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">${input.hasInterviewSlots?'They can also choose one of your available interview times.':'You can follow up directly. Interview scheduling in CareJoys is optional.'}</p>
      <p style="margin:26px 0"><a href="${esc(input.appLink)}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">Open recruiting workspace</a></p>`),
    text:`Hi ${input.recipientName||'there'},\n\n${input.caregiverName} is interested in ${input.title}${input.location?' in '+input.location:''}.\n\nThe caregiver confirmed interest and can be reached at ${input.caregiverEmail}.\n\n${input.hasInterviewSlots?'They can also book one of your interview times.':'You can follow up directly; interview scheduling is optional.'}\n\n${input.appLink}\n\nCareJoys · carejoys.com`
  };
}

export function talentAlertEmail(input:{
  recipientName:string; label:string; count:number; people:{name:string;detail:string}[]; link:string; offLink:string;
}) {
  const more=input.count-input.people.length;
  const noun=input.count===1?'caregiver':'caregivers';
  return {
    subject:`${input.count} new ${noun} for your search: ${input.label}`,
    html:shell(`${input.count} new ${noun} near you`,`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${esc(input.recipientName||'there')},</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">New caregivers joined CareJoys who match your saved search <strong>${esc(input.label)}</strong>.</p>
      <div style="background:#f0edff;border:1px solid #d8d2ff;border-radius:18px;padding:12px 18px;margin:20px 0;color:#4f4962;line-height:1.6">
        ${input.people.map(p=>`<div style="padding:6px 0"><strong>${esc(p.name)}</strong><br>${esc(p.detail)}</div>`).join('')}
        ${more>0?`<div style="padding:6px 0">and ${more} more</div>`:''}
      </div>
      <p style="margin:26px 0"><a href="${esc(input.link)}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">See them in CareJoys</a></p>
      <p style="font-size:13px;line-height:1.6;color:#8a849b">Don't need this alert anymore? <a href="${esc(input.offLink)}" style="color:#8a849b">Turn it off</a>.</p>`),
    text:`Hi ${input.recipientName||'there'},\n\nNew caregivers joined CareJoys who match your saved search "${input.label}":\n\n${input.people.map(p=>`${p.name} - ${p.detail}`).join('\n')}${more>0?`\nand ${more} more`:''}\n\nSee them: ${input.link}\n\nTurn off this alert: ${input.offLink}\n\nCareJoys · carejoys.com`
  };
}

export function interviewConfirmedEmail(input:{
  recipientName:string; company:string; caregiverName:string; title:string; startsLabel:string; where?:string;
}) {
  return {
    subject:`Interview confirmed: ${input.title}`,
    html:shell('Your CareJoys interview is booked',`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${esc(input.recipientName||'there')},</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">The interview for <strong>${esc(input.title)}</strong> with <strong>${esc(input.company)}</strong> and <strong>${esc(input.caregiverName)}</strong> is confirmed.</p>
      <p style="font-size:18px;font-weight:700;margin:22px 0">${esc(input.startsLabel)}</p>
      ${input.where?`<p style="font-size:16px;line-height:1.6;color:#5f5972"><strong>Where:</strong> ${esc(input.where)}</p>`:''}
      <p style="font-size:14px;line-height:1.6;color:#6e6882">A calendar invite is attached.${input.where?'':' The employer should follow up directly with the interview format or meeting location.'}</p>`),
    text:`Hi ${input.recipientName||'there'},\n\nYour CareJoys interview for ${input.title} with ${input.company} and ${input.caregiverName} is confirmed for ${input.startsLabel}.${input.where?'\nWhere: '+input.where:''}\n\nA calendar invite is attached.\n\nCareJoys · carejoys.com`
  };
}

export function cloudflareEmailTest() {
  return {
    subject:'CareJoys Cloudflare email test',
    html:'<div style="font-family:Arial,Helvetica,sans-serif"><h2>CareJoys email is live.</h2><p>This message was sent directly from the CareJoys Cloudflare Worker using Cloudflare Email Service.</p></div>',
    text:'CareJoys email is live. This message was sent directly from the CareJoys Cloudflare Worker using Cloudflare Email Service.'
  };
}


export function agencyCandidateTeaserEmail(input:{
  contactName:string;
  agencyName:string;
  candidateCount:number;
  previews:Array<{role:string;area:string;experience:string;freshness:string}>;
  claimLink:string;
}) {
  const rows=input.previews.slice(0,3).map(p=>`
    <div style="background:#f6f3ff;border:1px solid #d8d2ff;border-radius:16px;padding:13px 15px;margin:9px 0">
      <div style="font-weight:700;color:#1b153c">${esc(p.role||'Caregiver')}</div>
      <div style="font-size:14px;line-height:1.5;color:#6e6882">${[p.area,p.experience,p.freshness].filter(Boolean).map(esc).join(' · ')}</div>
    </div>`).join('');
  return {
    subject:`CareJoys found ${input.candidateCount} caregiver match${input.candidateCount===1?'':'es'} for ${input.agencyName}`,
    html:shell(`Caregiver matches near ${input.agencyName}`,`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${esc(input.contactName||'there')},</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">CareJoys matched ${input.candidateCount} caregiver profile${input.candidateCount===1?'':'s'} to your agency based on location, caregiver role, and your provider profile.</p>
      ${rows}
      <p style="font-size:14px;line-height:1.6;color:#6e6882">These previews are intentionally de-identified. Claim your agency to review the matching profiles, confirm what you hire for, and contact interested caregivers through CareJoys.</p>
      <p style="margin:26px 0"><a href="${esc(input.claimLink)}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">Review caregiver matches</a></p>
      <p style="font-size:13px;line-height:1.6;color:#8a849b">CareJoys is free until you hire someone through it.</p>`),
    text:`Hi ${input.contactName||'there'},\n\nCareJoys matched ${input.candidateCount} caregiver profile${input.candidateCount===1?'':'s'} to ${input.agencyName} based on location, caregiver role, and your provider profile.\n\n${input.previews.slice(0,3).map(p=>[p.role,p.area,p.experience,p.freshness].filter(Boolean).join(' · ')).join('\n')}\n\nThe previews are de-identified. Claim your agency to review the matches and confirm your hiring profile:\n${input.claimLink}\n\nCareJoys is free until you hire someone through it.\n\nCareJoys · carejoys.com`
  };
}


export function schoolPlacementInviteEmail(input:{
  contactName:string;
  programName:string;
  claimLink:string;
}) {
  return {
    subject:`A free job page for ${input.programName} graduates`,
    html:shell('A free job page for your CNA/GNA graduates',`
      <p style="${P}">Hi ${esc(input.contactName||'there')},</p>
      <p style="${P}">CareJoys lists current caregiver, CNA and GNA jobs near your graduates in one place, with pay shown up front. Graduates can look at nearby jobs before they sign up, and they choose which employers see their profile.</p>
      <p style="${P}"><strong>It's free for your program and your graduates.</strong></p>
      <p style="${P}">${esc(input.programName)} already has its own CareJoys page. Share it with students, and set it up to see how many graduates find work:</p>
      <p style="margin:26px 0"><a href="${esc(input.claimLink)}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">See ${esc(input.programName)}'s page</a></p>
      <p style="${P}">One more ask: could you add the link to your website's career resources or "after graduation" page? Suggested line: <em>Find CNA and caregiver jobs near you: CareJoys (free)</em>, linking to ${esc(input.claimLink)}</p>`),
    text:`Hi ${input.contactName||'there'},\n\nCareJoys lists current caregiver, CNA and GNA jobs near your graduates in one place, with pay shown up front. Graduates can look at nearby jobs before they sign up, and they choose which employers see their profile. It's free for your program and your graduates.\n\n${input.programName} already has its own CareJoys page. Share it with students, and set it up to see how many graduates find work:\n${input.claimLink}\n\nOne more ask: could you add the link to your website's career resources or "after graduation" page? Suggested line: "Find CNA and caregiver jobs near you: CareJoys (free)", linking to ${input.claimLink}\n\nCareJoys · carejoys.com`
  };
}

export function schoolMagicLinkEmail(input:{contactName:string;programName:string;link:string}) {
  return {
    subject:'Your CareJoys school sign-in link',
    html:shell('Open your CareJoys placement dashboard',`
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Hi ${esc(input.contactName||'there')},</p>
      <p style="font-size:16px;line-height:1.6;color:#5f5972">Use this secure one-time link to open the CareJoys dashboard for <strong>${esc(input.programName)}</strong>. It expires in 15 minutes.</p>
      <p style="margin:26px 0"><a href="${esc(input.link)}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">Open placement dashboard</a></p>`),
    text:`Hi ${input.contactName||'there'},\n\nUse this secure one-time link to open the CareJoys placement dashboard for ${input.programName}. It expires in 15 minutes:\n\n${input.link}\n\nCareJoys · carejoys.com`
  };
}

type InterestPreview={label:string;detail:string};
const P='font-size:16px;line-height:1.6;color:#5f5972';
const BUTTON='display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700';
function interestRows(items:InterestPreview[]){
  return items.slice(0,5).map(p=>`
    <div style="background:#f6f3ff;border:1px solid #d8d2ff;border-radius:16px;padding:13px 15px;margin:9px 0">
      <div style="font-weight:700;color:#1b153c">${esc(p.label)}</div>
      <div style="font-size:14px;line-height:1.5;color:#6e6882">${esc(p.detail)}</div>
    </div>`).join('');
}

// To an agency that hasn't claimed its CareJoys listing: real caregivers asked to be sent to it.
// The previews stay de-identified until the agency verifies its address.
export function agencyInterestActivationEmail(input:{contactName:string;agencyName:string;items:InterestPreview[];count:number;link:string}) {
  const many=input.count===1?'A caregiver wants':`${input.count} caregivers want`;
  return {
    subject:`${many} to work with ${input.agencyName}`,
    html:shell(`${many} to work with you`,`
      <p style="${P}">Hi ${esc(input.contactName||'there')},</p>
      <p style="${P}">${input.count===1?'A caregiver':'Caregivers'} on CareJoys asked us to send ${input.count===1?'their profile':'their profiles'} to <strong>${esc(input.agencyName)}</strong>.</p>
      ${interestRows(input.items)}
      <p style="${P}">Verify your agency email to see ${input.count===1?'their':'each'} full profile and contact details. It's free.</p>
      <p style="margin:26px 0"><a href="${esc(input.link)}" style="${BUTTON}">View ${input.count===1?'caregiver':'caregivers'}</a></p>`),
    text:`Hi ${input.contactName||'there'},\n\n${input.count===1?'A caregiver':'Caregivers'} on CareJoys asked us to send ${input.count===1?'their profile':'their profiles'} to ${input.agencyName}.\n\n${input.items.slice(0,5).map(p=>p.label+' · '+p.detail).join('\n')}\n\nVerify your agency email to see the full profile and contact details. It's free:\n${input.link}\n\nCareJoys · carejoys.com`
  };
}

// To an agency that already claimed its listing: new caregivers in its Inbox.
export function agencyInterestNotifyEmail(input:{recipientName:string;agencyName:string;items:InterestPreview[];count:number;link:string}) {
  const subject=input.count===1?`New caregiver for ${input.agencyName}: ${input.items[0]?.label||'Caregiver'}`:`${input.count} new caregivers for ${input.agencyName}`;
  return {
    subject,
    html:shell(input.count===1?'A caregiver wants to work with you':`${input.count} caregivers want to work with you`,`
      <p style="${P}">Hi ${esc(input.recipientName||'there')},</p>
      <p style="${P}">${input.count===1?'This caregiver':'These caregivers'} asked CareJoys to send ${input.count===1?'their profile':'their profiles'} to ${esc(input.agencyName)}. Contact details are in your Inbox.</p>
      ${interestRows(input.items)}
      <p style="margin:26px 0"><a href="${esc(input.link)}" style="${BUTTON}">Open your Inbox</a></p>`),
    text:`Hi ${input.recipientName||'there'},\n\n${input.count===1?'This caregiver':'These caregivers'} asked CareJoys to send ${input.count===1?'their profile':'their profiles'} to ${input.agencyName}:\n\n${input.items.slice(0,5).map(p=>p.label+' · '+p.detail).join('\n')}\n\nOpen your Inbox:\n${input.link}\n\nCareJoys · carejoys.com`
  };
}

// To the caregiver: nothing is sent to an agency until they press Send on this link.
export function caregiverInterestConfirmEmail(input:{firstName:string;targets:InterestPreview[];link:string;viaAssistant:boolean}) {
  const one=input.targets.length===1;
  return {
    subject:one?`Send your CareJoys profile to ${input.targets[0].label}?`:`Send your CareJoys profile to ${input.targets.length} agencies?`,
    html:shell('Confirm where your profile goes',`
      <p style="${P}">Hi ${esc(input.firstName||'there')},</p>
      <p style="${P}">${input.viaAssistant?'Your AI assistant asked CareJoys':'You asked CareJoys'} to send your caregiver profile to:</p>
      ${interestRows(input.targets)}
      <p style="${P}">Nothing has been sent yet. Press the button to send it. The link works for 48 hours.</p>
      <p style="margin:26px 0"><a href="${esc(input.link)}" style="${BUTTON}">Review and send</a></p>
      <p style="font-size:14px;line-height:1.6;color:#6e6882">If this wasn't you, ignore this email and nothing will be sent.</p>`),
    text:`Hi ${input.firstName||'there'},\n\n${input.viaAssistant?'Your AI assistant asked CareJoys':'You asked CareJoys'} to send your caregiver profile to:\n\n${input.targets.map(p=>p.label+' · '+p.detail).join('\n')}\n\nNothing has been sent yet. Review and send (works for 48 hours):\n${input.link}\n\nIf this wasn't you, ignore this email and nothing will be sent.\n\nCareJoys · carejoys.com`
  };
}

/** Sent to a caregiver right after they apply with their CareJoys profile. */
export function caregiverApplicationEmail(input:{firstName:string;jobTitle:string;employerName:string;employerOnCareJoys:boolean;applicationUrl:string;dashboardLink:string;submittedOnEmployerSite?:boolean}) {
  const employer=input.employerName||'the employer';
  const next=input.submittedOnEmployerSite
    ?`CareJoys submitted your application on ${employer}'s own job site with your resume. They'll contact you directly.`
    :input.employerOnCareJoys
    ?`We sent your CareJoys profile to ${employer}. When they reply, you'll get an email and see it on your dashboard.`
    :`${employer} isn't on CareJoys yet, so they take applications on their own site. If you haven't already, finish there so they see you.`;
  const finishLink=!input.submittedOnEmployerSite&&!input.employerOnCareJoys&&input.applicationUrl;
  return {
    subject:`You applied: ${input.jobTitle} at ${employer}`,
    html:shell('Application saved',`
      <p style="${P}">Hi ${esc(input.firstName||'there')},</p>
      <p style="${P}">You applied to <strong>${esc(input.jobTitle)}</strong> at <strong>${esc(employer)}</strong> with your CareJoys profile.</p>
      <p style="${P}">${esc(next)}</p>
      ${finishLink?`<p style="margin:26px 0"><a href="${esc(input.applicationUrl)}" style="${BUTTON}">Finish on ${esc(employer)}'s site</a></p>`:''}
      <p style="${P}"><a href="${esc(input.dashboardLink)}" style="color:#4255ff">See your applications</a></p>`),
    text:`Hi ${input.firstName||'there'},\n\nYou applied to ${input.jobTitle} at ${employer} with your CareJoys profile.\n\n${next}\n\n${finishLink?'Finish on their site: '+input.applicationUrl+'\n\n':''}See your applications: ${input.dashboardLink}\n\nCareJoys · carejoys.com`
  };
}

/**
 * Outreach to an agency whose openings CareJoys already lists. It leads with what works on day one (its jobs are live,
 * applications land in one inbox, the widget is free); matching is promised only as caregivers near them join.
 */
export function agencyHiringNeedsEmail(input:{contactName:string;agencyName:string;jobCount:number;city:string;link:string}) {
  const P='font-size:16px;line-height:1.6;color:#5f5972';
  const near=input.city?`near ${input.city}`:'near you';
  const jobs=input.jobCount===1?'1 of your jobs is':input.jobCount+' of your jobs are';
  const lines=[
    `${jobs} already listed on CareJoys, taken from your careers page. Caregivers ${near} can apply in a minute, and every application lands in one free inbox for ${input.agencyName}.`,
    `You also get a free widget for your own careers page. It’s two lines of code and stays in sync with your listings.`,
    `As caregivers ${near} join CareJoys, we’ll also match you with the ones whose certifications and availability fit your openings.`
  ];
  return {
    subject:`${input.jobCount===1?'Your job is':'Your jobs are'} live on CareJoys, ${input.agencyName}`,
    html:shell('Your jobs are live on CareJoys',`
      <p style="${P}">Hi ${esc(input.contactName||'there')},</p>
      ${lines.map(l=>`<p style="${P}">${esc(l)}</p>`).join('\n      ')}
      <p style="margin:26px 0"><a href="${esc(input.link)}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">See your jobs and inbox</a></p>
      <p style="${P}">Rebecca<br>CareJoys</p>`),
    text:`Hi ${input.contactName||'there'},\n\n${lines.join('\n\n').replace(/’/g,"'")}\n\nSee your jobs and inbox: ${input.link}\n\nRebecca\nCareJoys`
  };
}

/** Adds a visible unsubscribe footer to a bulk/outreach email. Pair with `unsubscribeHeaders` from emailPreferences. */
export function withUnsubscribe<T extends {subject:string;html:string;text:string}>(message:T, unsubscribeLink:string):T {
  const url=esc(unsubscribeLink);
  const footer=`<p style="font-size:12px;line-height:1.6;color:#8a849b;text-align:center;margin:14px 0 0">Don't want these emails? <a href="${url}" style="color:#8a849b">Unsubscribe</a>.</p>`;
  const html=message.html.replace(/<\/div>\s*<\/div>\s*$/,`</div>${footer}</div>`);
  return {...message,html:html===message.html?message.html+footer:html,text:`${message.text}\n\nUnsubscribe: ${unsubscribeLink}`};
}

const p=(text:string)=>`<p style="font-size:16px;line-height:1.6;color:#5f5972">${text}</p>`;
const cta=(href:string,label:string)=>`<p style="margin:26px 0"><a href="${esc(href)}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">${esc(label)}</a></p>`;

/** One reminder, two days after an invitation the caregiver hasn't answered. */
export function caregiverInviteReminderEmail(input:{firstName:string;company:string;title:string;link:string}) {
  return {
    subject:`Still interested? ${input.company} is waiting to hear from you`,
    html:shell('Still thinking it over?',
      p(`Hi ${esc(input.firstName||'there')},`)+
      p(`<strong>${esc(input.company)}</strong> invited you to <strong>${esc(input.title)}</strong> a couple of days ago. One tap tells them yes or no, and either answer is fine.`)+
      cta(input.link,'See the job and answer')),
    text:`Hi ${input.firstName||'there'},\n\n${input.company} invited you to ${input.title} a couple of days ago. One tap tells them yes or no, and either answer is fine.\n\n${input.link}\n\nCareJoys · carejoys.com`
  };
}

/** One nudge, two days after a caregiver said yes and the employer hasn't done anything yet. */
export function employerInterestNudgeEmail(input:{recipientName:string;caregiverName:string;title:string;appLink:string}) {
  return {
    subject:`${input.caregiverName} is still waiting to hear from you`,
    html:shell(`${input.caregiverName} is waiting`,
      p(`Hi ${esc(input.recipientName||'there')},`)+
      p(`<strong>${esc(input.caregiverName)}</strong> said yes to <strong>${esc(input.title)}</strong> two days ago and hasn’t heard back yet.`)+
      p('Reach out, book an interview, or mark them not a fit so they can keep looking.')+
      cta(input.appLink,'Open their profile')),
    text:`Hi ${input.recipientName||'there'},\n\n${input.caregiverName} said yes to ${input.title} two days ago and hasn't heard back yet.\n\nReach out, book an interview, or mark them not a fit so they can keep looking.\n\n${input.appLink}\n\nCareJoys · carejoys.com`
  };
}

/** A kind close-out when the role is filled or the employer chose someone else. */
export function caregiverRoleClosedEmail(input:{firstName:string;company:string;title:string;filled:boolean;jobsLink:string}) {
  const line=input.filled
    ?`<strong>${esc(input.company)}</strong> has filled <strong>${esc(input.title)}</strong>. Thank you for saying you were interested.`
    :`<strong>${esc(input.company)}</strong> decided to go another way for <strong>${esc(input.title)}</strong>. Thank you for saying you were interested.`;
  return {
    subject:`Update on ${input.title}`,
    html:shell('An update on this job',
      p(`Hi ${esc(input.firstName||'there')},`)+p(line)+
      p('Your profile stays active, and CareJoys will keep matching you with jobs near you.')+
      cta(input.jobsLink,'See jobs near you')),
    text:`Hi ${input.firstName||'there'},\n\n${input.filled?`${input.company} has filled ${input.title}.`:`${input.company} decided to go another way for ${input.title}.`} Thank you for saying you were interested.\n\nYour profile stays active, and CareJoys will keep matching you with jobs near you.\n\n${input.jobsLink}\n\nCareJoys · carejoys.com`
  };
}

const button=(href:string,label:string)=>`<p style="margin:26px 0"><a href="${esc(href)}" style="display:inline-block;background:#4255ff;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">${esc(label)}</a></p>`;

export type DigestPerson={name:string;title:string;detail:string};
/** The morning email: who applied since yesterday, who is still waiting on a reply, and today's interviews. */
export function dailyDigestEmail(input:{company:string;fresh:DigestPerson[];waiting:DigestPerson[];interviews:DigestPerson[];link:string;settingsLink:string}){
  const total=input.fresh.length+input.waiting.length+input.interviews.length;
  const list=(heading:string,people:DigestPerson[])=>people.length?`<h2 style="font-size:17px;margin:22px 0 8px">${esc(heading)}</h2><ul style="${P};padding-left:20px;margin:0">${people.slice(0,10).map(p=>`<li><strong>${esc(p.name)}</strong>${p.title?' · '+esc(p.title):''}${p.detail?' · '+esc(p.detail):''}</li>`).join('')}</ul>${people.length>10?`<p style="${P}">and ${people.length-10} more</p>`:''}`:'';
  const textList=(heading:string,people:DigestPerson[])=>people.length?`${heading}\n${people.slice(0,10).map(p=>'- '+[p.name,p.title,p.detail].filter(Boolean).join(' · ')).join('\n')}\n\n`:'';
  const subject=[input.fresh.length?`${input.fresh.length} new`:'',input.waiting.length?`${input.waiting.length} waiting on you`:'',input.interviews.length?`${input.interviews.length} interview${input.interviews.length===1?'':'s'} today`:''].filter(Boolean).join(', ');
  return {
    subject:`${input.company}: ${subject||total+' caregivers'}`,
    html:shell('Your caregivers this morning',`
      ${list('New since yesterday',input.fresh)}
      ${list('Waiting on your reply',input.waiting)}
      ${list('Interviews today',input.interviews)}
      ${button(input.link,'Open your candidates')}
      <p style="font-size:13px;line-height:1.6;color:#8a849b">You get this email on mornings when something needs you. <a href="${esc(input.settingsLink)}" style="color:#8a849b">Turn it off in Settings</a>.</p>`),
    text:`Your caregivers this morning\n\n${textList('New since yesterday',input.fresh)}${textList('Waiting on your reply',input.waiting)}${textList('Interviews today',input.interviews)}${input.link}\n\nTurn this email off in Settings: ${input.settingsLink}\n\nCareJoys · carejoys.com`
  };
}

/** The first-of-the-month results: what CareJoys did for the employer last month. */
export function monthlyResultsEmail(input:{company:string;month:string;views:number;applied:number;invited:number;yes:number;hired:number;link:string}){
  const rows:[string,number][]=[['Caregivers who viewed your jobs',input.views],['Applied to you through CareJoys',input.applied],['Invited',input.invited],['Said yes',input.yes],['Hired',input.hired]];
  return {
    subject:`${input.company} on CareJoys in ${input.month}: ${input.applied+input.yes} caregiver${input.applied+input.yes===1?'':'s'} interested, ${input.hired} hired`,
    html:shell(`Your ${input.month} on CareJoys`,`
      <table style="width:100%;border-collapse:collapse;${P}">${rows.map(([label,n])=>`<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(label)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right"><strong>${n}</strong></td></tr>`).join('')}</table>
      ${button(input.link,'Open your workspace')}`),
    text:`Your ${input.month} on CareJoys\n\n${rows.map(([label,n])=>label+': '+n).join('\n')}\n\n${input.link}\n\nCareJoys · carejoys.com`
  };
}

/** One candidate sent to the agency's ATS or recruiting inbox, in a shape an ATS email parser can read. */
export function atsForwardEmail(input:{company:string;title:string;source:string;note:string;caregiver:{name:string;email:string;phone:string;city:string;state:string;zip:string;role:string;certifications:string};link:string}){
  const c=input.caregiver;
  const fields:[string,string][]=[['Name',c.name],['Email',c.email],['Phone',c.phone],['Location',[c.city,c.state,c.zip].filter(Boolean).join(', ')],['Role',c.role],['Certifications',c.certifications],['Position',input.title],['Source',input.source],['Note',input.note]];
  const shown=fields.filter(([,v])=>v);
  return {
    subject:`Candidate: ${c.name}${input.title?' — '+input.title:''} (CareJoys)`,
    html:shell(c.name,`
      <table style="width:100%;border-collapse:collapse;${P}">${shown.map(([k,v])=>`<tr><td style="padding:4px 12px 4px 0;vertical-align:top"><strong>${esc(k)}</strong></td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('')}</table>
      ${button(input.link,'See them on CareJoys')}`),
    text:`${shown.map(([k,v])=>k+': '+v).join('\n')}\n\nOn CareJoys: ${input.link}\n\nForwarded by CareJoys for ${input.company}.`
  };
}
