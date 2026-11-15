import { useEffect, useState } from 'react';

// Candidates › the last 30 days of applications as a funnel: applied, qualified, interview, hired, with the share that
// made it from each step to the next. The interview-times link shows until the agency lets applicants book themselves.
type Counts={applied:number;qualified:number;interview:number;hired:number};
const pct=(n:number,of:number)=>of?Math.round(n/of*100)+'% of '+(of===1?'1':of):'';

export function CandidateFunnel({counts,onInterviewTimes}:{counts:Counts;onInterviewTimes:()=>void}){
  const [booking,setBooking]=useState<boolean|null>(null);
  useEffect(()=>{fetch('/api/agency/interview-hours',{credentials:'include'}).then(r=>r.json()).then((b:{hours?:unknown})=>setBooking(!!b.hours)).catch(()=>setBooking(null))},[]);
  const steps:[string,number,string][]=[
    ['Applied',counts.applied,''],
    ['Qualified',counts.qualified,pct(counts.qualified,counts.applied)],
    ['Interview',counts.interview,pct(counts.interview,counts.qualified||counts.applied)],
    ['Hired',counts.hired,pct(counts.hired,counts.interview)]
  ];
  return <>
    <div className="candidate-funnel" aria-label="Applications in the last 30 days">
      {steps.map(([label,n,share])=><div key={label}><strong>{n}</strong><span>{label}</span>{share&&<em>{share}</em>}</div>)}
    </div>
    <div className="candidate-funnel-foot">
      <span>Applications in the last 30 days. Qualified applicants are listed first.</span>
      {booking===false&&<button type="button" className="text-button" onClick={onInterviewTimes}>Let applicants book interviews</button>}
    </div>
  </>;
}
