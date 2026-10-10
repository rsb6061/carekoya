import type { FeatureEnv } from './serverFeatures';

// What a workspace tells caregivers about itself. Kept apart from the settings endpoints so invitation code can use it
// without a circular import.
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';

/** The agency's own words for caregivers, for invitations, /respond and job pages. */
export async function employerPitch(env:FeatureEnv,employerId:string){
  if(!env.DB||!employerId)return {about:'',benefits:''};
  const row=await env.DB.prepare('SELECT company_about,company_benefits FROM employer_leads WHERE id=?').bind(employerId).first<Record<string,unknown>>();
  return {about:clean(row?.company_about,1000),benefits:clean(row?.company_benefits,600)};
}
