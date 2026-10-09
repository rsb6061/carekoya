// What home-care agencies and assisted living communities check first, answered yes by the caregiver.
// Stored as comma-separated keys in caregivers.checklist; an unchecked item means "not answered", never "no".
export const CHECKLIST=[
  ['over18','18 or older'],
  ['work_authorized','Authorized to work in the US'],
  ['diploma','High school diploma or GED'],
  ['drivers_license','Valid driver’s license'],
  ['background_check','Agrees to a background check'],
  ['can_lift','Can help lift and transfer clients']
] as const;
export type ChecklistKey=typeof CHECKLIST[number][0];
const KEYS=new Set<string>(CHECKLIST.map(([k])=>k));

export function parseChecklist(value:unknown):ChecklistKey[]{
  const raw=Array.isArray(value)?value:typeof value==='string'?value.split(','):[];
  return [...new Set(raw.map(x=>String(x).trim()).filter(x=>KEYS.has(x)))] as ChecklistKey[];
}
