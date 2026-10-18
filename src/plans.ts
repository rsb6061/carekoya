// What CareJoys sells, in one place so the pricing page and the workspace say the same thing.
// The amounts charged are the Stripe prices (STRIPE_PRICE_ID, STRIPE_PRICE_ID_OPERATED); keep these labels in step.

/** Applicant follow-up, the operated service: CareJoys works the agency's own applicants. Per location, per month. */
export const OPERATED_PRICE='$99';
export const OPERATED_APPLICANT_LIMIT=75;
/** Caregiver introductions from CareJoys, after the free ones. Per location, per month. */
export const HIRING_PRICE='$99';
export const HIRING_YEARLY_PRICE='$990';
export type Plan='hiring'|'operated';
