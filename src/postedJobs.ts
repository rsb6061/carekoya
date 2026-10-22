import { TEST_JOB_REASON } from './agencyFeatures';
import { normalizeTitle } from './jobDiscovery';
import { payLabel } from './jobFormat';

// A job listing an agency creates in its CareJoys workspace becomes a public CareJoys job page (/jobs/<id>), so an
// agency that only posts on Indeed still has jobs on CareJoys. The page is an ordinary caregiver_jobs row with
// source_provider 'carejoys'; caregivers apply on CareJoys, and the application reaches the agency's Candidates
// like any other application to a claimed agency. Only agencies that claimed their CareJoys profile get pages,
// because a job page needs an agency_organizations row. Closing the listing takes the page down.

type Row=Record<string,unknown>;
type Statement={bind(...values:unknown[]):Statement;run():Promise<unknown>;first<T=Row>():Promise<T|null>;all<T=Row>():Promise<{results?:T[]}>};
type Db={prepare(query:string):Statement};

export const POSTED_PROVIDER='carejoys';
const ORIGIN='https://carejoys.com';
// The Always-on profile opening and openings started from a job CareJoys already found aren't separate jobs.
const NOT_POSTED_SOURCES=new Set(['agency_profile','agency_job']);
const clean=(v:unknown,max=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):typeof v==='number'?String(v):'';
const dedupeKey=(openingId:string)=>'carejoys-opening:'+openingId;
const shiftText=(raw:unknown)=>clean(raw,300).split(',').map(s=>s.trim().replace(/_/g,' ')).filter(Boolean).join(', ');

/** What the job page shows under "About this job": the agency's own details, as • bullets after a lead line. */
export function postedJobSummary(o:Row,employerName:string){
  const role=clean(o.role,80)||'caregiver';
  const place=[clean(o.city,120),clean(o.state,40)].filter(Boolean).join(', ');
  const pay=payLabel({payMin:o.pay_min,payMax:o.pay_max,payPeriod:'hour'});
  const bullets=[
    pay&&'Pay: '+pay,
    shiftText(o.shift_preferences)&&'Shifts: '+shiftText(o.shift_preferences),
    Number(o.transportation_required)===1&&'A reliable car is required.',
    Number(o.service_radius_miles||0)>0&&`Clients within ${Number(o.service_radius_miles)} miles.`,
    clean(o.requirements,1500),
  ].filter(Boolean) as string[];
  return [`${employerName} is hiring a ${role}${place?' in '+place:''}.`,...bullets].join(' • ');
}

/**
 * Creates, refreshes or takes down the public job page for one opening. Returns the job id when the page is live.
 * A page the agency hid stays hidden through edits.
 */
export async function syncPostedJob(db:Db,openingId:string){
  const o=await db.prepare(`SELECT o.*,ao.id AS org_id,ao.canonical_name,COALESCE(ao.is_test,0) AS org_is_test FROM openings o
      LEFT JOIN agency_organizations ao ON ao.claimed_employer_id=o.employer_id AND ao.is_active=1
    WHERE o.id=? LIMIT 1`).bind(openingId).first<Row>();
  if(!o||NOT_POSTED_SOURCES.has(clean(o.source,40)))return null;
  const key=dedupeKey(openingId);
  if(!o.org_id||clean(o.status,20)!=='open'){
    await db.prepare("UPDATE caregiver_jobs SET status='closed',is_published=0,updated_at=CURRENT_TIMESTAMP WHERE dedupe_key=? AND status='current'").bind(key).run();
    return null;
  }
  const existing=await db.prepare('SELECT id FROM caregiver_jobs WHERE dedupe_key=? LIMIT 1').bind(key).first<Row>();
  const id=clean(existing?.id,100)||crypto.randomUUID();
  const employerName=clean(o.canonical_name,220)||'Care employer';
  const role=clean(o.role,80)||'Caregiver';
  const title=clean(o.title,200)||role+' opening';
  const test=Number(o.org_is_test)===1;
  const summary=postedJobSummary(o,employerName);
  const hasPay=Number(o.pay_min||0)>0||Number(o.pay_max||0)>0;
  await db.prepare(`INSERT INTO caregiver_jobs (id,agency_organization_id,dedupe_key,source_provider,source_job_id,source_url,title,normalized_title,role,roles_json,
      employer_name,city,state,zip,location_source,pay_min,pay_max,pay_period,description_text,summary_text,summarized_at,classifier_reason,confidence,date_posted,
      status,is_published,publication_reason,first_seen_at,last_seen_at,last_checked_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'employer',?,?,?,?,?,CURRENT_TIMESTAMP,'posted_on_carejoys',100,date('now'),'current',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(dedupe_key) DO UPDATE SET agency_organization_id=excluded.agency_organization_id,title=excluded.title,normalized_title=excluded.normalized_title,role=excluded.role,
      roles_json=excluded.roles_json,employer_name=excluded.employer_name,city=excluded.city,state=excluded.state,zip=excluded.zip,pay_min=excluded.pay_min,pay_max=excluded.pay_max,
      pay_period=excluded.pay_period,description_text=excluded.description_text,summary_text=excluded.summary_text,summarized_at=CURRENT_TIMESTAMP,status='current',
      date_posted=CASE WHEN caregiver_jobs.status='current' THEN caregiver_jobs.date_posted ELSE excluded.date_posted END,
      is_published=CASE WHEN caregiver_jobs.publication_reason='hidden_by_employer' THEN 0 ELSE excluded.is_published END,
      publication_reason=CASE WHEN caregiver_jobs.publication_reason='hidden_by_employer' THEN 'hidden_by_employer' ELSE excluded.publication_reason END,
      last_seen_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
    .bind(id,clean(o.org_id,100),key,POSTED_PROVIDER,openingId,ORIGIN+'/jobs/'+id,title,normalizeTitle(title),role,JSON.stringify([role]),
      employerName,clean(o.city,120)||null,clean(o.state,40)||null,clean(o.zip,10).slice(0,5)||null,
      hasPay?Number(o.pay_min||0)||null:null,hasPay?Number(o.pay_max||0)||null:null,hasPay?'hour':null,summary,summary,
      test?0:1,test?TEST_JOB_REASON:'posted_on_carejoys').run();
  if(clean(o.caregiver_job_id,100)!==id)await db.prepare('UPDATE openings SET caregiver_job_id=? WHERE id=?').bind(id,openingId).run();
  return id;
}

/** After an agency claims its profile: its open job listings get pages. */
export async function syncPostedJobsForEmployer(db:Db,employerId:string){
  const rows=await db.prepare("SELECT id FROM openings WHERE employer_id=? AND status='open'").bind(employerId).all<Row>();
  for(const r of rows.results||[])await syncPostedJob(db,clean(r.id,100));
}

/**
 * Job pages show Google a validThrough 30 days after the listing was last confirmed live. A listing posted on
 * CareJoys is live for as long as its opening is open, so this re-confirms them once a day.
 */
export async function refreshPostedJobs(db:Db){
  await db.prepare(`UPDATE caregiver_jobs SET last_seen_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP
    WHERE source_provider='carejoys' AND status='current' AND datetime(last_checked_at)<datetime('now','-20 hours')
      AND EXISTS (SELECT 1 FROM openings o WHERE o.id=caregiver_jobs.source_job_id AND o.status='open')`).run();
}
