import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ReactivationCard } from './ReactivationCard';
import { ReferralsCard } from './ReferralsCard';
import { ApplicantDetail, ScreeningQuestionsCard, showUpText } from './ScreeningPanel';
import type { ScreeningQuestion } from './applicantScreening';
import { APPLICANT_SOURCE_LABELS, APPLICANT_SOURCES, waitText, REFERRAL_REWARD_CENTS, type ApplicantSource, type ApplicantStage, type ApplicantView } from './applicants';

type ImportRun={id:string;source:string;filename:string;total:number;added:number;duplicate:number;skipped:number;importedBy:string;createdAt:string};
type ImportResult={total:number;added:number;duplicate:number;skipped:number};
type Intake={address:string;lastReceivedAt:string;unread:{subject:string;snippet:string;receivedAt:string}|null};
type Week={received:number;live:number;contacted:number;medianMinutes:number|null;withinTarget:number;waiting:number;screened:number;booked:number;interviewsHeld:number;showed:number;noShow:number;started:number};

const STAGE_LABELS:Record<ApplicantStage,string>={new:'New',contacted:'Contacted',screened:'Screened',interview:'Interview',hired:'Hired',not_fit:'Not a fit'};
// Forwarded emails arrive on their own at the agency's address; an upload is one of the others.
const UPLOAD_SOURCES=APPLICANT_SOURCES.filter(s=>s!=='indeed-forward');
const UPLOAD_HELP:Partial<Record<ApplicantSource,string>>={
  csv:'New applicants exported from Indeed, CareerPlug or another job board.',
  'dead-pile':'Past applicants who weren’t hired, to reach out to again for the agency.'
};
// +14105550101 → (410) 555-0101; anything else as stored.
const phoneText=(p:string)=>{const m=p.match(/^\+1(\d{3})(\d{3})(\d{4})$/);return m?`(${m[1]}) ${m[2]}-${m[3]}`:p};
const day=(iso:string)=>iso?new Date(iso.includes('T')?iso:iso.replace(' ','T')+'Z').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';

/** What came of the "still looking?" email, for under the stage. */
function replyText(a:ApplicantView){
  const r=a.reactivation;
  if(r.response==='yes')return 'Said yes, still looking'+(r.replyPhone?` · ${phoneText(r.replyPhone)}`:'')+(a.poolOptIn?' · wants other CareJoys jobs':'');
  if(r.response==='no')return 'Said not looking right now';
  if(r.status==='failed')return 'Email failed';
  return r.sentAt?`Emailed ${day(r.sentAt)}`:'';
}

/** Where the referrer's reward for this applicant stands, for under the source. */
function rewardText(a:ApplicantView){
  const r=a.referral;
  if(!r.referrerId)return '';
  const amount='$'+Math.round((r.rewardCents||REFERRAL_REWARD_CENTS)/100);
  return {earned:`${amount} referral earned`,approved:`${amount} referral approved`,paid:`${amount} referral paid`,denied:'Referral not paid'}[r.rewardStatus as string]||`${amount} referral once screened`;
}

function summary(r:ImportResult){
  const parts=[`Added ${r.added} applicant${r.added===1?'':'s'}.`];
  if(r.duplicate)parts.push(`${r.duplicate} ${r.duplicate===1?'was':'were'} already on the list.`);
  if(r.skipped)parts.push(`${r.skipped} row${r.skipped===1?'':'s'} skipped (no phone or email, or repeated in the file).`);
  return parts.join(' ');
}

async function copyText(text:string){
  try{await navigator.clipboard.writeText(text);return true}catch{return false}
}

/** The agency's forwarding address, and how to point Indeed or CareerPlug at it. */
function ForwardingCard({intake}:{intake:Intake}){
  const [copied,setCopied]=useState(false);
  return <div className="settings-card">
    <h3>Forward new applicants</h3>
    <p className="job-meta">Send Indeed, CareerPlug or any job board’s “new applicant” emails to this address and each applicant is added here the moment they arrive.</p>
    <div className="inline-form"><code className="intake-address">{intake.address}</code>
      <button type="button" className="button secondary" onClick={()=>void copyText(intake.address).then(setCopied)}>{copied?'Copied':'Copy'}</button></div>
    <p className="job-meta">In Indeed: Employer settings → Notifications, add this address for new applicants. In CareerPlug: Account → Notifications. Or set a Gmail or Outlook filter that forwards those emails here.</p>
    {intake.lastReceivedAt&&<p className="job-meta">Last applicant email read {day(intake.lastReceivedAt)}.</p>}
    {intake.unread&&<div className="alert-status alert-info" role="status"><strong>We got an email here we couldn’t read as an applicant</strong> ({day(intake.unread.receivedAt)}): {intake.unread.subject||'no subject'}.
      {intake.unread.snippet&&<small> {intake.unread.snippet.slice(0,300)}</small>} If it’s a forwarding confirmation code, use the code above to finish setting up forwarding.</div>}
  </div>;
}

/** The first screen after an agency claims: the three things that make the applicant list work, each ticked off as it's done. */
function SetupCard({intake,openTimes,listingsLink}:{intake:Intake;openTimes:number;listingsLink:string}){
  const [copied,setCopied]=useState(false);
  const forwarded=!!intake.lastReceivedAt;
  const Step=({n,done,title,children}:{n:number;done:boolean;title:string;children:ReactNode})=><li className={'setup-step'+(done?' done':'')}>
    <span className="setup-step-mark" aria-hidden="true">{done?'✓':n}</span>
    <div><strong>{title}{done?<small> · done</small>:null}</strong>{children}</div>
  </li>;
  return <div className="settings-card setup-card">
    <h3>Let’s get your applicants answered</h3>
    <p className="job-meta">Three steps, about five minutes. Nothing changes on Indeed or CareerPlug.</p>
    <ol className="setup-steps">
      <Step n={1} done={forwarded} title="Forward applicants here">
        <div className="inline-form"><code className="intake-address">{intake.address}</code>
          <button type="button" className="button secondary" onClick={()=>void copyText(intake.address).then(setCopied)}>{copied?'Copied':'Copy'}</button></div>
        <p className="job-meta">In Indeed: Employer settings → Notifications, add this address for new applicants. In CareerPlug: Account → Notifications. Or set a Gmail or Outlook filter that forwards those emails here. New applicants show up below within minutes.</p>
        {intake.unread&&<div className="alert-status alert-info" role="status"><strong>We got an email here we couldn’t read as an applicant</strong> ({day(intake.unread.receivedAt)}): {intake.unread.subject||'no subject'}.
          {intake.unread.snippet&&<small> {intake.unread.snippet.slice(0,300)}</small>} If it’s a forwarding confirmation code, use the code above to finish setting up forwarding.</div>}
      </Step>
      <Step n={2} done={openTimes>0} title="Add interview times">
        <p className="job-meta">Pick a few 30-minute slots each week on a job listing. Applicants book themselves and both of you get the calendar invite.{listingsLink&&<> <a className="text-link" href={listingsLink}>Open job listings</a></>}</p>
      </Step>
      <Step n={3} done={false} title="Your Monday report">
        <p className="job-meta">Every Monday: applicants, time to first contact, interviews booked and who showed. It starts the first week an applicant lands.</p>
      </Step>
    </ol>
  </div>;
}

/** The last seven days, the same numbers as the Monday email. */
function WeekCard({week}:{week:Week}){
  const items:[string,string][]=[['New applicants',String(week.received)],
    ...(week.live?[['Typical time to first contact',waitText(week.medianMinutes)||'—'],['Reached within 30 minutes',`${week.withinTarget} of ${week.live}`]] as [string,string][]:[]),
    ['Screened',String(week.screened)],['Interviews booked',String(week.booked)],['Came to their interview',week.interviewsHeld?`${week.showed} of ${week.interviewsHeld}`:'0'],['Started work',String(week.started)]];
  return <div className="settings-card">
    <h3>Last 7 days</h3>
    {week.waiting>0&&<p className="applicant-knockout">{week.waiting} new applicant{week.waiting===1?' is':'s are'} still waiting for a first call.</p>}
    <div className="opportunity-summary">{items.map(([k,v])=><div key={k}><strong>{v}</strong><span>{k}</span></div>)}</div>
    <p className="job-meta">The owner gets these numbers by email every Monday.</p>
  </div>;
}

/** A link the applicant uses to pick one of the agency's interview times. */
function BookingLink({applicant:a,openTimes,make}:{applicant:ApplicantView;openTimes:number;make:(send:boolean)=>Promise<{url:string;emailed?:boolean}|null>}){
  const [url,setUrl]=useState('');
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false);
  async function run(send:boolean){
    setBusy(true);setNote('');
    const r=await make(send);
    setBusy(false);
    if(!r)return;
    setUrl(r.url);
    setNote(r.emailed?`Emailed to ${a.email}.`:(await copyText(r.url))?'Link copied. Text it to them.':'Copy the link below and text it to them.');
  }
  return <div className="booking-link">
    <h4>Interview booking link</h4>
    {a.booking.bookedAt&&a.showUp.interviewAt?<p className="job-meta">Booked an interview through the link {day(a.booking.bookedAt)}.</p>
      :a.booking.sentAt?<p className="job-meta">Link made {day(a.booking.sentAt)}, not booked yet.</p>:null}
    {openTimes===0?<p className="job-meta">Add interview times to one of your job listings first, so the link has times to offer.</p>:<>
      <p className="job-meta">They pick one of your {openTimes} open interview time{openTimes===1?'':'s'}, and you both get a calendar invite. A new link replaces the old one.</p>
      <div className="inline-form">
        <button type="button" className="button secondary" disabled={busy} onClick={()=>void run(false)}>Copy booking link</button>
        {a.email&&<button type="button" className="button" disabled={busy} onClick={()=>void run(true)}>Email it to them</button>}
      </div></>}
    {note&&<p className="job-meta" role="status">{note}</p>}
    {url&&<input className="pipeline-select" readOnly value={url} aria-label="Booking link" onFocus={e=>e.target.select()}/>}
  </div>;
}

/**
 * The agency's own applicants: upload a CSV, see who came from where, and move each one along.
 * `base` is /api/workspace/applicants for the agency, or /api/admin/applicants with `employerId` for a CareJoys operator.
 */
export function ApplicantIntake({base,employerId='',title='Applicants',reactivation}:{base:string;employerId?:string;title?:string;
  /** Admin only: where the "still looking?" email to past applicants is sent from. */
  reactivation?:{url:string;agencyName:string;testTo:string}}){
  const query=employerId?'?employer='+encodeURIComponent(employerId):'';
  const [applicants,setApplicants]=useState<ApplicantView[]|null>(null);
  const [imports,setImports]=useState<ImportRun[]>([]);
  const [notice,setNotice]=useState<{text:string;tone:'ok'|'error'}|null>(null);
  const [busy,setBusy]=useState(false);
  const [source,setSource]=useState<ApplicantSource>('csv');
  const [sourceFilter,setSourceFilter]=useState('');
  const [stageFilter,setStageFilter]=useState('');
  const [replyFilter,setReplyFilter]=useState('');
  // Bumped on every reload, so the email card recounts who's ready after an upload.
  const [version,setVersion]=useState(0);
  const [screening,setScreening]=useState<{questions:ScreeningQuestion[];isDefault:boolean;updatedBy:string;updatedAt:string}|null>(null);
  const [openId,setOpenId]=useState('');
  const [intake,setIntake]=useState<Intake|null>(null);
  const [week,setWeek]=useState<Week|null>(null);
  const [openTimes,setOpenTimes]=useState(0);
  const screeningUrl=base.replace(/applicants$/,'applicant-screening')+query;
  const referrersUrl=base.replace(/applicants$/,'applicant-referrers')+query;
  // Only a CareJoys operator approves and pays referral rewards.
  const rewardsUrl=employerId?(applicantId:string)=>'/api/admin/applicant-referral-rewards/'+encodeURIComponent(applicantId)+query:undefined;

  async function api<T>(path:string,init?:RequestInit):Promise<T>{
    const res=await fetch(base+path+query,{credentials:'include',...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
    const body=await res.json().catch(()=>({})) as T&{error?:string};
    if(!res.ok)throw new Error(body.error||'Something went wrong. Try again.');
    return body;
  }
  async function load(){
    try{
      const d=await api<{applicants:ApplicantView[];imports:ImportRun[];intake?:Intake;week?:Week;openInterviewTimes?:number}>('');
      setApplicants(d.applicants);setImports(d.imports);setIntake(d.intake||null);setWeek(d.week||null);setOpenTimes(d.openInterviewTimes||0);setVersion(v=>v+1);
    }
    catch(e){setNotice({text:(e as Error).message,tone:'error'})}
  }
  useEffect(()=>{
    setApplicants(null);setScreening(null);setOpenId('');void load();
    fetch(screeningUrl,{credentials:'include'}).then(r=>r.ok?r.json():null).then(d=>{if(d)setScreening(d)}).catch(()=>{});
  },[base,employerId]);

  async function upload(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=e.currentTarget;
    const file=(form.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if(!file){setNotice({text:'Choose a CSV file.',tone:'error'});return}
    setBusy(true);setNotice(null);
    try{
      const csv=await file.text();
      const sourceDetail=String(new FormData(form).get('sourceDetail')||'').trim();
      const r=await api<ImportResult>('',{method:'POST',body:JSON.stringify({csv,source,filename:file.name,sourceDetail})});
      setNotice({text:summary(r),tone:'ok'});form.reset();
      await load();
    }catch(err){setNotice({text:(err as Error).message,tone:'error'})}
    finally{setBusy(false)}
  }
  async function update(id:string,patch:Record<string,unknown>){
    try{
      const d=await api<{applicant:ApplicantView}>('/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify(patch)});
      setApplicants(list=>(list||[]).map(a=>a.id===id?d.applicant:a));
      return true;
    }catch(err){setNotice({text:(err as Error).message,tone:'error'});return false}
  }

  async function bookingLink(id:string,send:boolean){
    try{
      const r=await api<{url:string;emailed?:boolean}>('/'+encodeURIComponent(id)+'/booking-link',{method:'POST',body:JSON.stringify({send})});
      await load();
      return r;
    }catch(err){setNotice({text:(err as Error).message,tone:'error'});return null}
  }

  const list=applicants||[];
  const replyOf=(a:ApplicantView)=>a.reactivation.response||(a.reactivation.status==='sent'?'waiting':'');
  const shown=list.filter(a=>(!sourceFilter||a.source===sourceFilter)&&(!stageFilter||a.stage===stageFilter)&&(!replyFilter||replyOf(a)===replyFilter));
  const emailed=list.some(a=>a.reactivation.sentAt);
  const bySource=APPLICANT_SOURCES.map(s=>({s,n:list.filter(a=>a.source===s).length})).filter(x=>x.n);

  return <section className="section-block applicant-intake">
    <div className="section-heading"><h2>{title}</h2>
      <p>Applicants from the agency’s own job posts and past applicant lists. They stay the agency’s: they aren’t added to CareJoys caregiver matching.</p></div>
    {notice&&<div className={'alert-status workspace-alert'+(notice.tone==='ok'?'':' alert-error')} role="status">{notice.tone==='ok'?'✓ ':''}{notice.text}</div>}

    {week&&applicants&&applicants.length>0&&<WeekCard week={week}/>}

    {intake?.address&&(applicants&&applicants.length===0?<SetupCard intake={intake} openTimes={openTimes} listingsLink={employerId?'':'/app?tab=openings'}/>:<ForwardingCard intake={intake}/>)}

    <div className="settings-card">
      <h3>Upload applicants</h3>
      <form className="intake-form" onSubmit={upload}>
        <label>Where they came from
          <select className="pipeline-select" value={source} onChange={e=>setSource(e.target.value as ApplicantSource)}>
            {UPLOAD_SOURCES.map(s=><option key={s} value={s}>{APPLICANT_SOURCE_LABELS[s]}</option>)}
          </select>
        </label>
        {UPLOAD_HELP[source]&&<p className="job-meta">{UPLOAD_HELP[source]}</p>}
        <label>CSV file<input type="file" name="file" accept=".csv,text/csv" required/></label>
        <label>Details (optional)<input name="sourceDetail" maxLength={200} placeholder="Indeed export, Sept 1–30"/></label>
        <p className="job-meta">Columns we read: name (or first and last name), phone, email, location or city/state/ZIP, job title, and date applied. Each row needs a phone or an email.</p>
        <button className="button" disabled={busy}>{busy?'Uploading…':'Upload'}</button>
      </form>
      {imports.length>0&&<p className="job-meta">Last upload: {imports[0].filename||'CSV'}, {APPLICANT_SOURCE_LABELS[imports[0].source as ApplicantSource]||imports[0].source}, {day(imports[0].createdAt)}. {imports[0].added} added of {imports[0].total} rows.</p>}
    </div>

    <ScreeningQuestionsCard url={screeningUrl} questions={screening} onSaved={setScreening}/>

    <ReferralsCard url={referrersUrl} rewardsUrl={rewardsUrl} version={version}/>

    {reactivation&&<ReactivationCard url={reactivation.url} agencyName={reactivation.agencyName} defaultTestTo={reactivation.testTo} version={version} onSent={()=>void load()}/>}

    {applicants===null?<p className="job-meta">Loading…</p>:list.length===0?<div className="settings-card"><strong>No applicants yet.</strong><p className="job-meta">The first one lands here the moment Indeed forwards it. Or upload a CSV to start the list.</p></div>:<>
      <div className="admin-subheading">
        <h3>{shown.length} of {list.length} applicant{list.length===1?'':'s'}</h3>
        <select className="pipeline-select" value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} aria-label="Filter by source">
          <option value="">All sources</option>
          {bySource.map(({s,n})=><option key={s} value={s}>{APPLICANT_SOURCE_LABELS[s]} ({n})</option>)}
        </select>
        <select className="pipeline-select" value={stageFilter} onChange={e=>setStageFilter(e.target.value)} aria-label="Filter by stage">
          <option value="">All stages</option>
          {(Object.keys(STAGE_LABELS) as ApplicantStage[]).map(s=><option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        {emailed&&<select className="pipeline-select" value={replyFilter} onChange={e=>setReplyFilter(e.target.value)} aria-label="Filter by reply">
          <option value="">All replies</option><option value="yes">Said yes</option><option value="no">Said no</option><option value="waiting">Emailed, no answer</option>
        </select>}
      </div>
      <p className="job-meta">Open an applicant’s name to fill in the screening call, the interview, and whether they started and stayed.</p>
      <div className="settings-card admin-table-scroll">
        <table className="admin-data-table">
          <thead><tr><th>Applicant</th><th>Contact</th><th>Job</th><th>Source</th><th>Applied</th><th>Stage</th><th>Notes</th></tr></thead>
          <tbody>{shown.map(a=><Fragment key={a.id}><tr className={openId===a.id?'is-open':''}>
            <td><button type="button" className="text-link applicant-toggle" aria-expanded={openId===a.id} onClick={()=>setOpenId(o=>o===a.id?'':a.id)}><strong>{a.name}</strong></button>
              <small>{[a.city,a.state,a.zip].filter(Boolean).join(', ')}</small>
              {a.screening.knockouts.length>0&&<small className="applicant-knockout">Ruled out: {a.screening.knockouts.join('; ')}</small>}</td>
            <td>{a.phone&&<a className="text-link" href={'tel:'+a.phone}>{phoneText(a.phone)}</a>}{a.email&&<small><a className="text-link" href={'mailto:'+a.email}>{a.email}</a></small>}</td>
            <td>{a.position||'—'}</td>
            <td>{APPLICANT_SOURCE_LABELS[a.source]||a.source}{a.sourceDetail&&<small>{a.sourceDetail}</small>}{rewardText(a)&&<small>{rewardText(a)}</small>}</td>
            <td>{day(a.appliedAt)||'—'}<small>Received {day(a.receivedAt)}</small></td>
            <td><select className="pipeline-select" value={a.stage} onChange={e=>void update(a.id,{stage:e.target.value as ApplicantStage})} aria-label={'Stage for '+a.name}>
              {(Object.keys(STAGE_LABELS) as ApplicantStage[]).map(s=><option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>{replyText(a)&&<small>{replyText(a)}</small>}{showUpText(a)&&<small>{showUpText(a)}</small>}</td>
            <td><input className="pipeline-select" defaultValue={a.notes} maxLength={2000} aria-label={'Notes for '+a.name} placeholder="Add a note"
              onBlur={e=>{if(e.target.value!==a.notes)void update(a.id,{notes:e.target.value})}}/></td>
          </tr>
          {openId===a.id&&<tr className="applicant-detail-row"><td colSpan={7}>
            <ApplicantDetail applicant={a} questions={screening?.questions||[]} save={patch=>update(a.id,patch)}/>
            <BookingLink applicant={a} openTimes={openTimes} make={send=>bookingLink(a.id,send)}/></td></tr>}
          </Fragment>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
