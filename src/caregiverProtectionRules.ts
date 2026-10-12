// Pure pieces of caregiver protection: the invitation and browsing limits, scrubbing contact details out of a bio,
// and the plain-words notices. No database or email imports, so the browser bundle can use it too.

/** New invitations one caregiver can get per rolling 7 days, across all agencies. */
export const CAREGIVER_WEEKLY_INVITES=3;
/** Invitations a workspace can send per rolling 7 days: unpaid (or billing switched off), and on the paid plan. */
export const FREE_WEEKLY_INVITES=15;
export const PAID_WEEKLY_INVITES=75;
/** Unanswered invitations an unpaid workspace may have out, per free introduction it has left. */
export const PENDING_PER_FREE_INTRO=3;
/** Talent searches and profile views per workspace per day. */
export const DAILY_TALENT_SEARCHES=100;
export const DAILY_PROFILE_VIEWS=300;
/** How long "Pause invitations" lasts. */
export const INVITE_PAUSE_DAYS=14;

const EMAIL=/[\w.+-]+\s*(?:@|\(at\)|\[at\])\s*[\w-]+(?:(?:\.|\s*[([]dot[)\]]\s*)[\w-]+)+/gi;
const URL_LIKE=/\b(?:https?:\/\/|www\.)\S+/gi;
const DOMAIN=/\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|co|me|us|info|biz|ly|app|page|site|link)\b(?:\/\S*)?/gi;
const PHONE=/(?:\+?1[\s.-]*)?(?:\(\d{3}\)|\b\d{3})[\s.-]*\d{3}[\s.-]*\d{4}\b|\b\d{3}[\s.-]\d{4}\b/g;
const HANDLE=/(^|[\s(])@[\w.]{2,}/g;

/** A caregiver's bio without emails, phone numbers, links or @handles, so agencies can't reach them before a yes. */
export function scrubBio(value:unknown){
  const text=typeof value==='string'?value:'';
  if(!text)return '';
  return text.replace(EMAIL,'').replace(URL_LIKE,'').replace(DOMAIN,'').replace(PHONE,'').replace(HANDLE,'$1')
    .replace(/\(\s*\)|\[\s*\]/g,'')
    .split('\n').map(line=>line.replace(/[ \t]{2,}/g,' ').replace(/ +([.,;:!?])/g,'$1').replace(/([.,;:!?])\1+/g,'$1').trim()).join('\n')
    .replace(/\n{3,}/g,'\n\n').trim();
}

/** What a caregiver hears after saying yes to an employer that has to upgrade before it can see them. */
export function lockedYesText(company:unknown){
  const name=typeof company==='string'&&company.trim()?company.trim():'This employer';
  return `Thanks! ${name} will see your answer once they upgrade their CareJoys plan. We'll let you know if they reach out.`;
}

export type HeldBack={caregiverWeekly:number;pendingFromYou:number;weeklyLimit:number;freeLimit:number};
const people=(n:number)=>n===1?'1 caregiver':n+' caregivers';

/** One plain sentence per reason invitations were held back, or '' when none were. */
export function heldBackNotice(held:HeldBack,weeklyLimit:number){
  const parts:string[]=[];
  if(held.caregiverWeekly)parts.push(`${people(held.caregiverWeekly)} already ${held.caregiverWeekly===1?'has':'have'} enough invitations this week. Try them again next week.`);
  if(held.pendingFromYou)parts.push(`${people(held.pendingFromYou)} already ${held.pendingFromYou===1?'has':'have'} an invitation from you waiting for an answer.`);
  if(held.weeklyLimit)parts.push(`You can send ${weeklyLimit} invitations a week, so ${people(held.weeklyLimit)} ${held.weeklyLimit===1?'wasn’t':'weren’t'} invited. Try again next week.`);
  if(held.freeLimit)parts.push(`${people(held.freeLimit)} ${held.freeLimit===1?'wasn’t':'weren’t'} invited because enough of your invitations are waiting for answers for the free introductions you have left. Upgrade to invite more.`);
  return parts.join(' ');
}
