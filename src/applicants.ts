// An agency's own applicants, brought into CareJoys so they can be worked for the agency: from a CSV the agency
// exports (Indeed, CareerPlug, a spreadsheet of last quarter's applicants), and from forwarded emails.
// They stay the agency's: never written to `caregivers`, never matched or shown to anyone else.
import { normalizePhone } from './sms';
import { cleanAnswers, knockoutsFor, screeningQuestions, type ScreeningAnswers } from './applicantScreening';

type Row=Record<string,unknown>;
type RunResult={success:boolean;meta?:Record<string,unknown>};
type Statement={bind(...values:unknown[]):Statement;run():Promise<RunResult>;all<T=Row>():Promise<{results?:T[]}>;first<T=Row>():Promise<T|null>};
export type ApplicantDb={prepare(query:string):Statement;batch?(statements:Statement[]):Promise<RunResult[]>};
type Db=ApplicantDb;

/** Which channel brought each applicant in. Stored on every row from the start so cost per channel can be worked out later. */
export const APPLICANT_SOURCES=['indeed-forward','csv','dead-pile','referral','school','ad'] as const;
export type ApplicantSource=typeof APPLICANT_SOURCES[number];
export const APPLICANT_SOURCE_LABELS:Record<ApplicantSource,string>={
  'indeed-forward':'Forwarded email',csv:'CSV upload','dead-pile':'Past applicants',referral:'Referral',school:'School',ad:'Ad'
};
export const APPLICANT_STAGES=['new','contacted','screened','interview','hired','not_fit'] as const;
export type ApplicantStage=typeof APPLICANT_STAGES[number];

/** What a referrer earns when the person they referred is screened with no knockout (src/applicantReferrals.ts). */
export const REFERRAL_REWARD_CENTS=2500;
export type ReferralRewardStatus='earned'|'approved'|'paid'|'denied';

export const MAX_IMPORT_ROWS=5000;
export const MAX_IMPORT_BYTES=3_000_000;

export type ParsedApplicant={firstName:string;lastName:string;email:string;phone:string;city:string;state:string;zip:string;position:string;appliedAt:string|null;dedupeKey:string};

const clean=(v:unknown,max=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):typeof v==='number'?String(v).slice(0,max):'';

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, a leading BOM. */
export function parseCsv(text:string):string[][]{
  const rows:string[][]=[];
  let row:string[]=[],field='',quoted=false;
  const s=text.replace(/^﻿/,'');
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(quoted){
      if(ch==='"'){if(s[i+1]==='"'){field+='"';i++}else quoted=false}
      else field+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===','){row.push(field);field=''}
    else if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&s[i+1]==='\n')i++;
      row.push(field);field='';
      if(row.some(f=>f.trim()))rows.push(row);
      row=[];
    }else field+=ch;
  }
  row.push(field);
  if(row.some(f=>f.trim()))rows.push(row);
  return rows;
}

const key=(h:string)=>h.toLowerCase().replace(/[^a-z]/g,'');
// Header names seen in Indeed and CareerPlug exports and hand-made spreadsheets. Exact matches win over partial ones.
const COLUMNS:Record<string,{exact:string[];partial?:RegExp}>={
  name:{exact:['name','fullname','candidatename','applicantname','candidate','applicant']},
  firstName:{exact:['firstname','first','givenname','candidatefirstname','applicantfirstname']},
  lastName:{exact:['lastname','last','surname','familyname','candidatelastname','applicantlastname']},
  email:{exact:['email','emailaddress','candidateemail','applicantemail'],partial:/email/},
  phone:{exact:['phone','phonenumber','mobile','mobilephone','cell','cellphone','candidatephone','applicantphone'],partial:/phone|mobile|cell/},
  location:{exact:['location','candidatelocation','applicantlocation','address','citystate','citystatezip']},
  city:{exact:['city']},
  state:{exact:['state','province','region']},
  zip:{exact:['zip','zipcode','postalcode','postcode','postal']},
  position:{exact:['job','jobtitle','position','jobposition','appliedfor','jobappliedfor','jobapplied','posting','jobposting','opening','role'],partial:/^job|position/},
  appliedAt:{exact:['date','dateapplied','applied','applieddate','appliedon','applicationdate','datecreated','created','submitted','datesubmitted']},
};

/** Which column holds which field; -1 when the file has none. */
export function mapColumns(header:string[]){
  const keys=header.map(key);
  const used=new Set<number>();
  const out:Record<string,number>={};
  for(const [field,spec] of Object.entries(COLUMNS)){
    let at=keys.findIndex((k,i)=>!used.has(i)&&spec.exact.includes(k));
    if(at<0&&spec.partial)at=keys.findIndex((k,i)=>!used.has(i)&&spec.partial!.test(k));
    out[field]=at;
    if(at>=0)used.add(at);
  }
  return out as Record<keyof typeof COLUMNS,number>;
}

/** "Baltimore, MD 21201", "Baltimore, MD" or "21201". */
export function splitLocation(value:string){
  const v=clean(value,160);
  const zip=v.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1]||'';
  const rest=v.replace(/\b\d{5}(?:-\d{4})?\b/,'').replace(/,?\s*(US|USA|United States)$/i,'').trim().replace(/,$/,'');
  const m=rest.match(/^(.*?),\s*([A-Za-z]{2})$/);
  return m?{city:clean(m[1],120),state:m[2].toUpperCase(),zip}:{city:rest&&!/^[A-Za-z]{2}$/.test(rest)?clean(rest,120):'',state:/^[A-Za-z]{2}$/.test(rest)?rest.toUpperCase():'',zip};
}

function dateOf(value:string){
  const v=clean(value,40);
  if(!v)return null;
  const t=Date.parse(v);
  return Number.isFinite(t)?new Date(t).toISOString():null;
}

/** People from an uploaded CSV. A row needs a phone or an email to be worth keeping; repeats in the file are dropped. */
export function applicantsFromCsv(text:string){
  const table=parseCsv(text);
  if(table.length<2)return {applicants:[] as ParsedApplicant[],skipped:0,total:0,error:'The file needs a header row and at least one applicant.'};
  const cols=mapColumns(table[0]);
  if(cols.phone<0&&cols.email<0)return {applicants:[] as ParsedApplicant[],skipped:0,total:table.length-1,error:'Couldn’t find a phone or email column. Name the columns Name, Phone and Email.'};
  const body=table.slice(1,MAX_IMPORT_ROWS+1);
  const get=(r:string[],c:number,max=200)=>c>=0?clean(r[c],max):'';
  const seen=new Set<string>();
  const applicants:ParsedApplicant[]=[];
  let skipped=0;
  for(const r of body){
    let first=get(r,cols.firstName,80),last=get(r,cols.lastName,80);
    if(!first&&!last){
      const parts=get(r,cols.name,160).split(' ').filter(Boolean);
      first=parts.shift()||'';last=parts.join(' ');
    }
    const rawEmail=get(r,cols.email,320).toLowerCase();
    const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)?rawEmail:'';
    const phone=normalizePhone(get(r,cols.phone,40))||'';
    const dedupeKey=phone||email;
    if(!dedupeKey||seen.has(dedupeKey)){skipped++;continue}
    seen.add(dedupeKey);
    const loc=cols.location>=0?splitLocation(get(r,cols.location,160)):{city:'',state:'',zip:''};
    applicants.push({firstName:first,lastName:last,email,phone,
      city:get(r,cols.city,120)||loc.city,state:(get(r,cols.state,20)||loc.state).toUpperCase().slice(0,20),zip:(get(r,cols.zip,10).match(/\d{5}/)?.[0])||loc.zip,
      position:get(r,cols.position,200),appliedAt:dateOf(get(r,cols.appliedAt,40)),dedupeKey});
  }
  return {applicants,skipped:skipped+Math.max(0,table.length-1-MAX_IMPORT_ROWS),total:table.length-1,error:''};
}

// ---------- Storage ----------

export type ImportInput={csv:unknown;source:unknown;filename?:unknown;sourceDetail?:unknown};

/** Adds a CSV of applicants to one agency's list. Someone already on the list is left as is (counted as a duplicate). */
export async function importApplicants(db:Db,employerId:string,input:ImportInput,importedBy:string){
  const source=clean(input.source,40) as ApplicantSource;
  if(!(APPLICANT_SOURCES as readonly string[]).includes(source))return {ok:false as const,error:'Choose where these applicants came from.'};
  const csv=typeof input.csv==='string'?input.csv:'';
  if(!csv.trim())return {ok:false as const,error:'Choose a CSV file.'};
  if(csv.length>MAX_IMPORT_BYTES)return {ok:false as const,error:'That file is too big. Split it into files under 3 MB.'};
  const parsed=applicantsFromCsv(csv);
  if(parsed.error)return {ok:false as const,error:parsed.error};
  const filename=clean(input.filename,200);
  const detail=clean(input.sourceDetail,200)||filename||null;
  const importId=crypto.randomUUID();
  let added=0;
  // D1 caps statements per batch; 50 rows a batch keeps each well inside it.
  for(let i=0;i<parsed.applicants.length;i+=50){
    const statements=parsed.applicants.slice(i,i+50).map(a=>db.prepare(`INSERT INTO agency_applicants
        (id,employer_id,dedupe_key,first_name,last_name,email,phone,city,state,zip,position,source,source_detail,applied_at,import_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(employer_id,dedupe_key) DO NOTHING`)
      .bind(crypto.randomUUID(),employerId,a.dedupeKey,a.firstName||null,a.lastName||null,a.email||null,a.phone||null,a.city||null,a.state||null,a.zip||null,
        a.position||null,source,detail,a.appliedAt,importId));
    const results=db.batch?await db.batch(statements):await Promise.all(statements.map(st=>st.run()));
    added+=results.reduce((n,r)=>n+Number(r.meta?.changes||0),0);
  }
  const summary={total:parsed.total,added,duplicate:parsed.applicants.length-added,skipped:parsed.skipped};
  await db.prepare(`INSERT INTO agency_applicant_imports(id,employer_id,source,filename,rows_total,rows_added,rows_duplicate,rows_skipped,imported_by) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(importId,employerId,source,filename||null,summary.total,summary.added,summary.duplicate,summary.skipped,clean(importedBy,320)||null).run();
  return {ok:true as const,importId,...summary};
}

export type ApplicantView={id:string;name:string;firstName:string;lastName:string;email:string;phone:string;city:string;state:string;zip:string;position:string;
  source:ApplicantSource;sourceDetail:string;stage:ApplicantStage;notes:string;appliedAt:string;receivedAt:string;firstContactAt:string;screenedAt:string;poolOptIn:boolean;
  /** The dead-pile "still looking?" email: when it went, and the applicant's yes or no. */
  reactivation:{sentAt:string;status:string;response:string;respondedAt:string;replyPhone:string};
  /** Answers to the agency's screening questions, and the questions whose answer ruled them out. */
  screening:{answers:ScreeningAnswers;knockouts:string[];screenedBy:string};
  /** Whether they came to the interview, started, and were still working at day 30 and day 90. */
  showUp:{interviewAt:string;interviewOutcome:string;startDate:string;day30:string;day90:string};
  /** Who referred them through a referral link, and where that referrer's reward stands. */
  referral:{referrerId:string;referrerName:string;rewardStatus:ReferralRewardStatus|'';rewardCents:number};
  /** The interview booking link (src/applicantBooking.ts): when it was made, and when the applicant booked through it. */
  booking:{sentAt:string;bookedAt:string;slotId:string}};

/** "12 min", "3 hr 5 min", "2 days". */
export function waitText(minutes:number|null){
  if(minutes===null)return '';
  if(minutes<60)return `${minutes} min`;
  if(minutes<48*60){const h=Math.floor(minutes/60),m=minutes%60;return `${h} hr${m?` ${m} min`:''}`}
  return `${Math.round(minutes/1440)} days`;
}

export const INTERVIEW_OUTCOMES=['showed','no_show','rescheduled'] as const;
export const RETENTION_STATUSES=['working','left'] as const;

function answersOf(json:unknown):ScreeningAnswers{
  try{const v=JSON.parse(String(json||'{}'));return v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,a])=>[k,String(a)])):{}}catch{return {}}
}

function view(r:Row):ApplicantView{
  const firstName=clean(r.first_name,80),lastName=clean(r.last_name,80);
  return {id:clean(r.id,100),name:[firstName,lastName].filter(Boolean).join(' ')||clean(r.email,320)||clean(r.phone,20),firstName,lastName,
    email:clean(r.email,320),phone:clean(r.phone,20),city:clean(r.city,120),state:clean(r.state,20),zip:clean(r.zip,10),position:clean(r.position,200),
    source:clean(r.source,40) as ApplicantSource,sourceDetail:clean(r.source_detail,200),stage:clean(r.stage,20) as ApplicantStage,notes:clean(r.notes,2000),
    appliedAt:clean(r.applied_at,40),receivedAt:clean(r.received_at,40),firstContactAt:clean(r.first_contact_at,40),screenedAt:clean(r.screened_at,40),poolOptIn:Number(r.pool_opt_in)===1,
    reactivation:{sentAt:clean(r.reactivation_sent_at,40),status:clean(r.reactivation_status,20),response:clean(r.reactivation_response,10),respondedAt:clean(r.reactivation_responded_at,40),replyPhone:clean(r.reply_phone,20)},
    screening:{answers:answersOf(r.screening_answers_json),knockouts:clean(r.screening_knockouts,2000).split('|').filter(Boolean),screenedBy:clean(r.screened_by,320)},
    showUp:{interviewAt:clean(r.interview_at,40),interviewOutcome:clean(r.interview_outcome,20),startDate:clean(r.start_date,20),day30:clean(r.day30_status,20),day90:clean(r.day90_status,20)},
    referral:{referrerId:clean(r.referrer_id,100),referrerName:clean(r.referrer_name,120),rewardStatus:clean(r.reward_status,20) as ReferralRewardStatus|'',rewardCents:Number(r.reward_cents||0)},
    booking:{sentAt:clean(r.booking_sent_at,40),bookedAt:clean(r.interview_booked_at,40),slotId:clean(r.interview_slot_id,100)}};
}

// Every applicant query reads through this, so each row carries its referrer's name and reward.
const SELECT_APPLICANTS=`SELECT a.*,r.name AS referrer_name,w.status AS reward_status,w.amount_cents AS reward_cents FROM agency_applicants a
  LEFT JOIN agency_referrers r ON r.id=a.referrer_id LEFT JOIN agency_referral_rewards w ON w.applicant_id=a.id`;

/**
 * After screening answers are saved: a referred applicant with no knockout earns their referrer the reward. If a later
 * edit adds a knockout before an operator approves it, the reward is taken back.
 */
async function syncReferralReward(db:Db,employerId:string,applicantId:string,knockouts:string[]){
  const row=await db.prepare('SELECT referrer_id FROM agency_applicants WHERE id=? AND employer_id=?').bind(applicantId,employerId).first<Row>();
  const referrerId=clean(row?.referrer_id,100);
  if(!referrerId)return;
  if(knockouts.length){
    await db.prepare("DELETE FROM agency_referral_rewards WHERE applicant_id=? AND status='earned'").bind(applicantId).run();
    return;
  }
  await db.prepare('INSERT INTO agency_referral_rewards(applicant_id,employer_id,referrer_id,amount_cents) VALUES (?,?,?,?) ON CONFLICT(applicant_id) DO NOTHING')
    .bind(applicantId,employerId,referrerId,REFERRAL_REWARD_CENTS).run();
}

export async function listApplicants(db:Db,employerId:string){
  const rows=await db.prepare(SELECT_APPLICANTS+' WHERE a.employer_id=? ORDER BY COALESCE(a.applied_at,a.received_at) DESC LIMIT 2000').bind(employerId).all<Row>();
  const imports=await db.prepare('SELECT id,source,filename,rows_total,rows_added,rows_duplicate,rows_skipped,imported_by,created_at FROM agency_applicant_imports WHERE employer_id=? ORDER BY created_at DESC LIMIT 20').bind(employerId).all<Row>();
  return {applicants:(rows.results||[]).map(view),
    imports:(imports.results||[]).map(r=>({id:clean(r.id,100),source:clean(r.source,40),filename:clean(r.filename,200),total:Number(r.rows_total||0),added:Number(r.rows_added||0),
      duplicate:Number(r.rows_duplicate||0),skipped:Number(r.rows_skipped||0),importedBy:clean(r.imported_by,320),createdAt:clean(r.created_at,40)}))};
}

// Stages in order; a screen, an interview time or a start date moves an applicant forward to its stage, never back.
const STAGE_ORDER=['new','contacted','screened','interview','hired'];
const advanceTo=(stage:string)=>`stage=CASE WHEN stage IN (${STAGE_ORDER.slice(0,STAGE_ORDER.indexOf(stage)).map(s=>`'${s}'`).join(',')}) THEN '${stage}' ELSE stage END`;

/**
 * Moves an applicant along, saves a note, screening answers, or show-up details. The first move out of "new" stamps
 * first contact; reaching "screened" stamps the screen. Saving answers screens a new or contacted applicant, a
 * interview time moves them to Interview, and a start date to Hired, unless they're already further along.
 * An explicit `stage` in the same request wins.
 */
export async function updateApplicant(db:Db,employerId:string,id:string,data:Row,actor=''){
  const sets:string[]=[];const args:unknown[]=[];
  let implied='';
  let knockouts:string[]|null=null;
  if(data.screeningAnswers!==undefined){
    const {questions}=await screeningQuestions(db,employerId);
    const answers=cleanAnswers(questions,data.screeningAnswers);
    knockouts=knockoutsFor(questions,answers);
    sets.push('screening_answers_json=?','screening_knockouts=?','screened_by=?','screened_at=COALESCE(screened_at,CURRENT_TIMESTAMP)','first_contact_at=COALESCE(first_contact_at,CURRENT_TIMESTAMP)');
    args.push(JSON.stringify(answers),knockouts.join('|')||null,clean(actor,320)||null);
    implied='screened';
  }
  if(data.interviewAt!==undefined){
    const at=clean(data.interviewAt,40);
    if(at&&!Number.isFinite(Date.parse(at)))return {ok:false as const,error:'Enter the interview date and time.'};
    sets.push('interview_at=?');args.push(at||null);
    if(at){implied='interview';sets.push('interview_booked_at=COALESCE(interview_booked_at,CURRENT_TIMESTAMP)')}
  }
  if(data.interviewOutcome!==undefined){
    const v=clean(data.interviewOutcome,20);
    if(v&&!(INTERVIEW_OUTCOMES as readonly string[]).includes(v))return {ok:false as const,error:'Unknown interview outcome.'};
    sets.push('interview_outcome=?');args.push(v||null);
  }
  if(data.startDate!==undefined){
    const d=clean(data.startDate,20);
    if(d&&!/^\d{4}-\d{2}-\d{2}$/.test(d))return {ok:false as const,error:'Enter the start date.'};
    sets.push('start_date=?');args.push(d||null);
    if(d)implied='hired';
  }
  for(const [field,col] of [['day30','day30_status'],['day90','day90_status']] as const){
    if(data[field]===undefined)continue;
    const v=clean(data[field],20);
    if(v&&!(RETENTION_STATUSES as readonly string[]).includes(v))return {ok:false as const,error:'Choose working or left.'};
    sets.push(col+'=?');args.push(v||null);
  }
  if(data.stage!==undefined){
    const stage=clean(data.stage,20);
    if(!(APPLICANT_STAGES as readonly string[]).includes(stage))return {ok:false as const,error:'Unknown stage.'};
    sets.push('stage=?');args.push(stage);
    if(stage!=='new')sets.push('first_contact_at=COALESCE(first_contact_at,CURRENT_TIMESTAMP)');
    if(['screened','interview','hired'].includes(stage))sets.push('screened_at=COALESCE(screened_at,CURRENT_TIMESTAMP)');
  }
  if(implied&&data.stage===undefined)sets.push(advanceTo(implied));
  if(data.notes!==undefined){sets.push('notes=?');args.push(clean(data.notes,2000)||null)}
  if(!sets.length)return {ok:false as const,error:'Nothing to save.'};
  const res=await db.prepare(`UPDATE agency_applicants SET ${sets.join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=? AND employer_id=?`).bind(...args,id,employerId).run();
  if(!res.meta?.changes)return {ok:false as const,error:'Applicant not found.'};
  if(knockouts)await syncReferralReward(db,employerId,id,knockouts);
  const row=await db.prepare(SELECT_APPLICANTS+' WHERE a.id=?').bind(id).first<Row>();
  return {ok:true as const,applicant:view(row!)};
}
