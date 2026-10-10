// Caregivers who applied to an employer's claimed agency (from a job page, the widget or an AI assistant). They are
// already in the employer's candidates, so matching, invitations and Find caregivers never offer them a second time.
type Statement={bind(...values:unknown[]):Statement;first<T=Record<string,unknown>>():Promise<T|null>;all<T=Record<string,unknown>>():Promise<{results?:T[]}>};
type DB={prepare(query:string):Statement};

/** SQL for "this caregiver (c.id) applied to the employer's agency"; bind the employer id. */
export const APPLIED_TO_EMPLOYER_SQL=`EXISTS (SELECT 1 FROM agency_interests ai JOIN agency_organizations ao ON ao.id=ai.organization_id
  WHERE ao.claimed_employer_id=? AND ai.caregiver_id=c.id)`;

export async function alreadyApplied(env:{DB?:DB},employerId:string,caregiverId:string){
  if(!env.DB)return false;
  const hit=await env.DB.prepare(`SELECT 1 AS hit FROM agency_interests ai JOIN agency_organizations ao ON ao.id=ai.organization_id
    WHERE ao.claimed_employer_id=? AND ai.caregiver_id=? LIMIT 1`).bind(employerId,caregiverId).first();
  return !!hit;
}

export async function appliedCaregiverIds(env:{DB?:DB},employerId:string){
  if(!env.DB)return new Set<string>();
  const rows=await env.DB.prepare(`SELECT DISTINCT ai.caregiver_id FROM agency_interests ai JOIN agency_organizations ao ON ao.id=ai.organization_id
    WHERE ao.claimed_employer_id=?`).bind(employerId).all<{caregiver_id:string}>();
  return new Set((rows.results||[]).map(r=>String(r.caregiver_id)));
}
