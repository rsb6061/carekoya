import type { FeatureEnv } from './serverFeatures';

// Who hears about a workspace's caregivers, and what the workspace tells caregivers about itself. Kept apart from the
// settings endpoints so notification and invitation code can use it without a circular import.
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const emailValid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Everyone who should hear about the workspace's caregivers: the owner and every teammate. */
export async function teamEmails(env:FeatureEnv,employerId:string):Promise<string[]>{
  if(!env.DB||!employerId)return [];
  const rows=await env.DB.prepare(`SELECT email FROM employer_leads WHERE id=? AND status!='disabled'
    UNION SELECT m.email FROM employer_members m JOIN employer_leads e ON e.id=m.employer_id WHERE m.employer_id=? AND e.status!='disabled'`)
    .bind(employerId,employerId).all<Record<string,unknown>>();
  return [...new Set((rows.results||[]).map(r=>clean(r.email,320).toLowerCase()).filter(emailValid))];
}


/** The agency's own words for caregivers, for invitations, /respond and job pages. */
export async function employerPitch(env:FeatureEnv,employerId:string){
  if(!env.DB||!employerId)return {about:'',benefits:''};
  const row=await env.DB.prepare('SELECT company_about,company_benefits FROM employer_leads WHERE id=?').bind(employerId).first<Record<string,unknown>>();
  return {about:clean(row?.company_about,1000),benefits:clean(row?.company_benefits,600)};
}

/** The `to` for a team email: one address as a plain string (most workspaces), else the list. Falls back to the owner's address. */
export async function teamRecipients(env:FeatureEnv,employerId:string,fallback:string):Promise<string|string[]>{
  const team=await teamEmails(env,employerId);
  return team.length>1?team:team[0]||fallback;
}
