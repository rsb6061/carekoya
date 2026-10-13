import { useEffect, useState } from 'react';
import { MAX_SCREENING_QUESTIONS, type ScreeningAnswers, type ScreeningQuestion } from './applicantScreening';
import type { ApplicantView } from './applicants';

type Loaded={questions:ScreeningQuestion[];isDefault:boolean;updatedBy:string;updatedAt:string};
type Draft=ScreeningQuestion&{key:number};

async function call<T>(url:string,init?:RequestInit):Promise<T>{
  const res=await fetch(url,{credentials:'include',...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json().catch(()=>({})) as T&{error?:string};
  if(!res.ok)throw new Error(body.error||'Something went wrong. Try again.');
  return body;
}

let nextKey=1;
const drafts=(qs:ScreeningQuestion[]):Draft[]=>qs.map(q=>({...q,key:nextKey++}));

/** The agency's screening questions: the caregiver default until someone saves their own. */
export function ScreeningQuestionsCard({url,questions,onSaved}:{url:string;questions:Loaded|null;onSaved:(l:Loaded)=>void}){
  const [open,setOpen]=useState(false);
  const [list,setList]=useState<Draft[]>([]);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{text:string;tone:'ok'|'error'}|null>(null);
  useEffect(()=>{if(questions)setList(drafts(questions.questions))},[questions]);
  if(!questions)return null;

  const set=(key:number,patch:Partial<ScreeningQuestion>)=>setList(l=>l.map(q=>q.key===key?{...q,...patch}:q));
  async function save(){
    setBusy(true);setNotice(null);
    try{
      const r=await call<Loaded>(url,{method:'POST',body:JSON.stringify({questions:list.map(({key:_,...q})=>q)})});
      onSaved(r);setNotice({text:'Questions saved.',tone:'ok'});
    }catch(e){setNotice({text:(e as Error).message,tone:'error'})}
    finally{setBusy(false)}
  }

  return <div className="settings-card screening-questions">
    <div className="admin-subheading"><h3>Screening questions</h3>
      <button type="button" className="button secondary" onClick={()=>setOpen(o=>!o)}>{open?'Hide questions':'Edit questions'}</button></div>
    <p className="job-meta">{questions.questions.length} questions asked on every screening call{questions.isDefault?', from the CareJoys starting list':''}. {questions.questions.filter(q=>q.knockout).length} rule an applicant out.</p>
    {open&&<>
      {notice&&<div className={'alert-status'+(notice.tone==='ok'?'':' alert-error')} role="status">{notice.text}</div>}
      <ol className="screening-question-list">{list.map(q=><li key={q.key}>
        <input value={q.label} maxLength={200} onChange={e=>set(q.key,{label:e.target.value})} aria-label="Question" placeholder="Question"/>
        <select className="pipeline-select" value={q.type} aria-label="Answer type" onChange={e=>set(q.key,{type:e.target.value as ScreeningQuestion['type'],knockout:undefined})}>
          <option value="yes_no">Yes or no</option><option value="text">Short answer</option>
        </select>
        {q.type==='yes_no'&&<select className="pipeline-select" value={q.knockout||''} aria-label="Rules out on" onChange={e=>set(q.key,{knockout:(e.target.value||undefined) as ScreeningQuestion['knockout']})}>
          <option value="">Doesn’t rule out</option><option value="no">Rules out on No</option><option value="yes">Rules out on Yes</option>
        </select>}
        <button type="button" className="button secondary" aria-label={'Remove '+q.label} onClick={()=>setList(l=>l.filter(x=>x.key!==q.key))}>Remove</button>
      </li>)}</ol>
      <div className="inline-form">
        <button type="button" className="button secondary" disabled={list.length>=MAX_SCREENING_QUESTIONS} onClick={()=>setList(l=>[...l,{key:nextKey++,id:'',label:'',type:'yes_no'}])}>Add a question</button>
        <button type="button" className="button" disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save questions'}</button>
      </div>
      <p className="job-meta">Answers already saved stay with each applicant when a question changes.</p>
    </>}
  </div>;
}

const OUTCOME_LABELS:Record<string,string>={showed:'Showed up',no_show:'No-show',rescheduled:'Rescheduled'};
const RETENTION_LABELS:Record<string,string>={working:'Still working',left:'Left'};
// "2026-10-15T14:00" or "2026-10-15 14:00:00" → what a datetime-local input takes.
const localInput=(v:string)=>v?v.replace(' ','T').slice(0,16):'';

/** One line for the table: what the screen and show-up tracking say so far. */
export function showUpText(a:ApplicantView){
  const s=a.showUp;
  if(s.day90)return 'Day 90: '+RETENTION_LABELS[s.day90];
  if(s.day30)return 'Day 30: '+RETENTION_LABELS[s.day30];
  if(s.startDate)return 'Starts '+new Date(s.startDate+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
  if(s.interviewOutcome)return 'Interview: '+OUTCOME_LABELS[s.interviewOutcome];
  if(s.interviewAt)return 'Interview '+new Date(localInput(s.interviewAt)).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return '';
}

/** Under an applicant's row: the screening call checklist, then interview, start date and day 30/90. */
export function ApplicantDetail({applicant:a,questions,save}:{applicant:ApplicantView;questions:ScreeningQuestion[];
  save:(patch:Record<string,unknown>)=>Promise<boolean>}){
  const [answers,setAnswers]=useState<ScreeningAnswers>(a.screening.answers);
  const [show,setShow]=useState({interviewAt:localInput(a.showUp.interviewAt),interviewOutcome:a.showUp.interviewOutcome,startDate:a.showUp.startDate,day30:a.showUp.day30,day90:a.showUp.day90});
  const [busy,setBusy]=useState('');
  const [saved,setSaved]=useState('');
  // Answers to questions the agency has since removed, kept on the applicant.
  const old=Object.entries(a.screening.answers).filter(([id])=>!questions.some(q=>q.id===id));
  const showChanged=show.interviewAt!==localInput(a.showUp.interviewAt)||show.interviewOutcome!==a.showUp.interviewOutcome||show.startDate!==a.showUp.startDate||show.day30!==a.showUp.day30||show.day90!==a.showUp.day90;

  async function run(kind:string,patch:Record<string,unknown>){
    setBusy(kind);setSaved('');
    if(await save(patch))setSaved(kind);
    setBusy('');
  }

  return <div className="applicant-detail">
    <div>
      <h4>Screening call</h4>
      {a.screening.knockouts.length>0&&<p className="applicant-knockout">Ruled out: {a.screening.knockouts.join('; ')}</p>}
      <div className="screening-answers">{questions.map(q=>q.type==='yes_no'
        ?<div key={q.id} className="screening-field" role="group" aria-label={q.label}>
          <span>{q.label}{q.knockout&&<small> (rules out on {q.knockout==='no'?'No':'Yes'})</small>}</span>
          <span className="yes-no">{(['yes','no'] as const).map(v=><button type="button" key={v} aria-pressed={answers[q.id]===v}
            className={'button secondary'+(answers[q.id]===v?' selected':'')} onClick={()=>setAnswers(x=>({...x,[q.id]:x[q.id]===v?'':v}))}>{v==='yes'?'Yes':'No'}</button>)}</span>
        </div>
        :<label key={q.id} className="screening-field">{q.label}
          <input value={answers[q.id]||''} maxLength={300} onChange={e=>setAnswers(x=>({...x,[q.id]:e.target.value}))}/></label>)}</div>
      {old.length>0&&<p className="job-meta">Earlier answers: {old.map(([id,v])=>`${id}: ${v}`).join(' · ')}</p>}
      <div className="inline-form">
        <button type="button" className="button" disabled={!!busy} onClick={()=>void run('screen',{screeningAnswers:answers})}>{busy==='screen'?'Saving…':'Save screen'}</button>
        {saved==='screen'&&<span className="job-meta" role="status">✓ Saved{a.screening.screenedBy?` by ${a.screening.screenedBy}`:''}</span>}
      </div>
    </div>
    <div>
      <h4>Interview and start</h4>
      <div className="screening-answers">
        <label className="screening-field">Interview<input type="datetime-local" value={show.interviewAt} onChange={e=>setShow(s=>({...s,interviewAt:e.target.value}))}/></label>
        <label className="screening-field">Did they come?<select className="pipeline-select" value={show.interviewOutcome} onChange={e=>setShow(s=>({...s,interviewOutcome:e.target.value}))}>
          <option value="">Not yet</option>{Object.entries(OUTCOME_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label className="screening-field">Start date<input type="date" value={show.startDate} onChange={e=>setShow(s=>({...s,startDate:e.target.value}))}/></label>
        <label className="screening-field">Day 30<select className="pipeline-select" value={show.day30} onChange={e=>setShow(s=>({...s,day30:e.target.value}))}>
          <option value="">Not yet</option>{Object.entries(RETENTION_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label className="screening-field">Day 90<select className="pipeline-select" value={show.day90} onChange={e=>setShow(s=>({...s,day90:e.target.value}))}>
          <option value="">Not yet</option>{Object.entries(RETENTION_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <div className="inline-form">
        <button type="button" className="button" disabled={!!busy||!showChanged} onClick={()=>void run('show',show)}>{busy==='show'?'Saving…':'Save'}</button>
        {saved==='show'&&<span className="job-meta" role="status">✓ Saved</span>}
      </div>
      <p className="job-meta">An interview time moves them to Interview, and a start date to Hired.</p>
    </div>
  </div>;
}
