// One email to an agency that claimed its CareJoys profile but hasn't posted a job, two days after the claim.
// A posted opening becomes a public job page (src/postedJobs.ts), the only way an agency that posts only on Indeed
// gets CareJoys jobs. Sends while FIRST_JOB_NUDGE_ENABLED=true (Rebecca approved 2026-10-23); each agency gets it once (agency_outreach_events
// 'first_job_nudge'), and the first send is copied to hello@carejoys.com.
import { firstJobNudgeEmail, withUnsubscribe } from './email';
import { unsubscribeLink } from './emailPreferences';
import { friendlyAgencyName } from './agencyFeatures';

import type { FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
export type FirstJobNudgeEnv=FeatureEnv&{FIRST_JOB_NUDGE_ENABLED?:string};

const FROM='CareJoys <hello@carejoys.com>';
const LINK='https://carejoys.com/hiring?tab=openings&new=1';
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';

export async function sendFirstJobNudges(env:FirstJobNudgeEnv,limit=10){
  if(String(env.FIRST_JOB_NUDGE_ENABLED||'').toLowerCase()!=='true'||!env.DB||!env.EMAIL)return {sent:0,failed:0};
  const rows=(await env.DB.prepare(`SELECT ao.id,ao.canonical_name,ao.city,e.email,e.contact_name,
      (SELECT COUNT(*) FROM caregiver_jobs j WHERE j.agency_organization_id=ao.id AND j.status='current' AND j.is_published=1) AS listed_jobs
    FROM agency_organizations ao JOIN employer_leads e ON e.id=ao.claimed_employer_id
    WHERE COALESCE(ao.is_test,0)=0 AND COALESCE(e.is_test,0)=0 AND e.email LIKE '%@%'
      AND EXISTS (SELECT 1 FROM agency_outreach_events v WHERE v.organization_id=ao.id AND v.event_type='agency_claim_verified' AND datetime(v.created_at)<=datetime('now','-2 days'))
      AND NOT EXISTS (SELECT 1 FROM agency_outreach_events n WHERE n.organization_id=ao.id AND n.event_type IN ('first_job_nudge','first_job_nudge_failed'))
      AND NOT EXISTS (SELECT 1 FROM openings o WHERE o.employer_id=ao.claimed_employer_id AND COALESCE(o.source,'') NOT IN ('agency_profile','agency_job'))
      AND NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE lower(s.email)=lower(e.email))
    LIMIT ?`).bind(limit).all<Row>()).results||[];
  const firstEver=!(await env.DB.prepare("SELECT 1 FROM agency_outreach_events WHERE event_type='first_job_nudge' LIMIT 1").first());
  let sent=0,failed=0,copyTo=firstEver?'hello@carejoys.com':'';
  for(const r of rows){
    const email=clean(r.email,320).toLowerCase();
    const input={contactName:clean(r.contact_name,120).split(/\s+/)[0]||'',agencyName:friendlyAgencyName(clean(r.canonical_name,180)),
      city:clean(r.city,100),listedJobs:Number(r.listed_jobs||0),link:LINK};
    const unsubscribe=await unsubscribeLink(env.DB,email,'first_job_nudge');
    const body=withUnsubscribe(firstJobNudgeEmail(input),unsubscribe.link);
    try{
      const result=await env.EMAIL.send({from:FROM,to:email,subject:body.subject,html:body.html,text:body.text,headers:unsubscribe.headers});
      await env.DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,provider_message_id) VALUES (?,?,'first_job_nudge',?,?)")
        .bind(crypto.randomUUID(),r.id,email,result.messageId||null).run();
      if(copyTo){
        const copy=firstJobNudgeEmail(input);
        await env.EMAIL.send({from:FROM,to:copyTo,subject:'[Copy of email sent to '+email+'] '+copy.subject,html:copy.html,text:copy.text}).catch(()=>null);
        copyTo='';
      }
      sent++;
    }catch(error){
      await env.DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,payload) VALUES (?,?,'first_job_nudge_failed',?,?)")
        .bind(crypto.randomUUID(),r.id,email,JSON.stringify({error:error instanceof Error?error.message:'send failed'})).run();
      failed++;
    }
  }
  return {sent,failed};
}
