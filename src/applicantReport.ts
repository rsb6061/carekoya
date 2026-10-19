// The Monday applicant report: what happened to the agency's own applicants last week, the numbers the operated
// service is judged on. How fast each new applicant was reached, how many were screened, booked, came, and started.
// Shown on the Applicants page too, so the email and the page always agree.
import type { FeatureEnv } from './serverFeatures';
import type { ApplicantDb } from './applicants';
import { weeklyApplicantReportEmail } from './email';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const num=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
const ORIGIN='https://carejoys.com';
const FROM='CareJoys <hello@carejoys.com>';
const emailValid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const sqlTime=(d:Date)=>d.toISOString().replace('T',' ').slice(0,19);

/** Monday, at the hour the daily digest goes out. */
export const REPORT_UTC_DAY=1;
// Past applicants and CSV uploads were on the list long before they were added, so their wait isn't the agency's speed.
const LIVE_SOURCES="a.source NOT IN ('dead-pile','csv')";
export const FAST_MINUTES=30;

export type ApplicantWeek={from:string;to:string;received:number;live:number;contacted:number;medianMinutes:number|null;withinTarget:number;
  waiting:number;screened:number;booked:number;interviewsHeld:number;showed:number;noShow:number;started:number};

/** The seven days before `now`. Each number counts what happened in the window, whenever the applicant arrived. */
export async function applicantWeek(db:ApplicantDb,employerId:string,now=new Date()):Promise<ApplicantWeek>{
  const from=sqlTime(new Date(now.getTime()-7*86400000)),to=sqlTime(now);
  const within=(col:string)=>`datetime(${col})>=datetime(?) AND datetime(${col})<=datetime(?)`;
  const counts=await db.prepare(`SELECT
      SUM(CASE WHEN ${within('a.received_at')} AND a.source!='dead-pile' THEN 1 ELSE 0 END) AS received,
      SUM(CASE WHEN ${within('a.received_at')} AND ${LIVE_SOURCES} THEN 1 ELSE 0 END) AS live,
      SUM(CASE WHEN ${within('a.received_at')} AND ${LIVE_SOURCES} AND a.first_contact_at IS NULL AND a.stage='new' THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN ${within('a.screened_at')} THEN 1 ELSE 0 END) AS screened,
      SUM(CASE WHEN ${within('a.interview_booked_at')} THEN 1 ELSE 0 END) AS booked,
      SUM(CASE WHEN ${within('a.interview_at')} AND a.interview_outcome='showed' THEN 1 ELSE 0 END) AS showed,
      SUM(CASE WHEN ${within('a.interview_at')} AND a.interview_outcome='no_show' THEN 1 ELSE 0 END) AS no_show,
      SUM(CASE WHEN date(a.start_date)>=date(?) AND date(a.start_date)<=date(?) THEN 1 ELSE 0 END) AS started
    FROM agency_applicants a WHERE a.employer_id=?`)
    .bind(from,to,from,to,from,to,from,to,from,to,from,to,from,to,from,to,employerId).first<Row>();
  const waits=await db.prepare(`SELECT (julianday(a.first_contact_at)-julianday(a.received_at))*1440 AS minutes FROM agency_applicants a
      WHERE a.employer_id=? AND ${within('a.received_at')} AND ${LIVE_SOURCES} AND a.first_contact_at IS NOT NULL ORDER BY minutes`)
    .bind(employerId,from,to).all<Row>();
  const minutes=(waits.results||[]).map(r=>Math.max(0,num(r.minutes)));
  const mid=minutes.length>>1;
  const median=minutes.length?Math.round(minutes.length%2?minutes[mid]:(minutes[mid-1]+minutes[mid])/2):null;
  const showed=num(counts?.showed),noShow=num(counts?.no_show);
  return {from,to,received:num(counts?.received),live:num(counts?.live),contacted:minutes.length,medianMinutes:median,
    withinTarget:minutes.filter(m=>m<=FAST_MINUTES).length,waiting:num(counts?.waiting),screened:num(counts?.screened),booked:num(counts?.booked),
    interviewsHeld:showed+noShow,showed,noShow,started:num(counts?.started)};
}

const hadActivity=(w:ApplicantWeek)=>w.received+w.screened+w.booked+w.interviewsHeld+w.started>0;

/**
 * On Mondays, last week's report to every agency that had applicant activity. Claimed before sending so overlapping
 * runs never send twice; the daily-email setting turns it off too. Test accounts are skipped.
 */
export async function sendWeeklyApplicantReports(env:FeatureEnv&{EMAIL?:{send(m:Record<string,unknown>):Promise<unknown>}},now=new Date(),limit=100){
  if(!env.DB||!env.EMAIL||now.getUTCDay()!==REPORT_UTC_DAY)return {sent:0};
  const db=env.DB as unknown as ApplicantDb;
  const since=sqlTime(new Date(now.getTime()-7*86400000));
  const due=await db.prepare(`SELECT e.id,e.company_name,e.email FROM employer_leads e WHERE e.status!='disabled' AND COALESCE(e.is_test,0)=0 AND COALESCE(e.digest_enabled,1)=1
      AND (e.last_applicant_report_at IS NULL OR datetime(e.last_applicant_report_at)<=datetime(?,'-6 days'))
      AND EXISTS (SELECT 1 FROM agency_applicants a WHERE a.employer_id=e.id AND datetime(COALESCE(a.updated_at,a.received_at))>=datetime(?)) LIMIT ?`)
    .bind(sqlTime(now),since,limit).all<Row>();
  let sent=0;
  for(const e of due.results||[]){
    const id=clean(e.id,100);
    const week=await applicantWeek(db,id,now);
    if(!hadActivity(week))continue;
    const claimed=await db.prepare("UPDATE employer_leads SET last_applicant_report_at=? WHERE id=? AND (last_applicant_report_at IS NULL OR datetime(last_applicant_report_at)<=datetime(?,'-6 days'))")
      .bind(sqlTime(now),id,sqlTime(now)).run();
    if(Number(claimed.meta?.changes||0)!==1)continue;
    const to=clean(e.email,320).toLowerCase();
    if(!emailValid(to))continue;
    const mail=weeklyApplicantReportEmail({company:clean(e.company_name,200),week,link:ORIGIN+'/app?tab=candidates&source=posts',settingsLink:ORIGIN+'/app?tab=settings'});
    try{await env.EMAIL.send({from:FROM,to,subject:mail.subject,html:mail.html,text:mail.text});sent++}catch(error){console.error('applicant report failed',error)}
  }
  return {sent};
}
