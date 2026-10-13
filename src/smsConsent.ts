// The text-message opt-in wording, shown next to each checkbox and stored word for word with each opt-in (src/carejoysSms.ts).

/** Caregivers: signup, profile and "Send my profile". */
export const SMS_CONSENT_TEXT = "Text me job invitations and interview reminders from CareJoys. Msg & data rates may apply. Up to 4 msgs/week. Reply STOP to opt out, HELP for help. Consent isn't required to use CareJoys.";
/** The caregiver wording split for display: the first sentence as the label, the rest as fine print. */
export const SMS_LABEL = SMS_CONSENT_TEXT.slice(0, SMS_CONSENT_TEXT.indexOf('. ') + 1);
export const SMS_FINE_PRINT = SMS_CONSENT_TEXT.slice(SMS_LABEL.length).trim();
/** Agencies: Settings. */
export const AGENCY_SMS_CONSENT_TEXT = 'Text me when a caregiver says yes to one of my jobs. Up to 4 msgs/week; later yeses that week still come by email. Msg & data rates may apply. Reply STOP to opt out, HELP for help.';
