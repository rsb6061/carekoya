import { useEffect, useState, type FormEvent } from 'react';
import type { ReferrerView, RewardView } from './applicantReferrals';

type Data={rewardCents:number;referrers:ReferrerView[];rewards:RewardView[]};

async function call<T>(url:string,init?:RequestInit):Promise<T>{
  const res=await fetch(url,{credentials:'include',...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json().catch(()=>({})) as T&{error?:string};
  if(!res.ok)throw new Error(body.error||'Something went wrong. Try again.');
  return body;
}

const dollars=(cents:number)=>'$'+(cents/100).toFixed(cents%100?2:0);
const day=(iso:string)=>iso?new Date(iso.includes('T')?iso:iso.replace(' ','T')+'Z').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
const REWARD_LABELS:Record<string,string>={earned:'Earned, waiting for approval',approved:'Approved, not paid yet',paid:'Paid',denied:'Not paid'};

/**
 * Referral links: add a referrer, copy their link, and see who they brought in and what they've earned.
 * `url` is /api/workspace/applicant-referrers, or the admin one with ?employer=. `rewardsUrl` (admin only) lets a
 * CareJoys operator approve each reward and mark it paid.
 */
export function ReferralsCard({url,rewardsUrl,version}:{url:string;rewardsUrl?:(applicantId:string)=>string;version:number}){
  const [data,setData]=useState<Data|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{text:string;tone:'ok'|'error'}|null>(null);
  const [copied,setCopied]=useState('');

  useEffect(()=>{setData(null);call<Data>(url).then(setData).catch(e=>setNotice({text:e.message,tone:'error'}))},[url]);
  // Recount when the applicant list reloads, e.g. after a screening earns a reward.
  useEffect(()=>{if(version>1)call<Data>(url).then(setData).catch(()=>{})},[version]);

  async function add(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=e.currentTarget;
    const f=new FormData(form);
    setBusy(true);setNotice(null);
    try{
      const d=await call<Data>(url,{method:'POST',body:JSON.stringify({name:f.get('name'),phone:f.get('phone'),email:f.get('email')})});
      setData(d);form.reset();
      setNotice({text:'Referral link added. Copy it below and send it to them.',tone:'ok'});
    }catch(err){setNotice({text:(err as Error).message,tone:'error'})}
    finally{setBusy(false)}
  }
  async function setReward(applicantId:string,status:string){
    if(!rewardsUrl)return;
    setBusy(true);setNotice(null);
    try{setData(await call<Data>(rewardsUrl(applicantId),{method:'POST',body:JSON.stringify({status})}))}
    catch(err){setNotice({text:(err as Error).message,tone:'error'})}
    finally{setBusy(false)}
  }
  async function copy(link:string){
    try{await navigator.clipboard.writeText(link);setCopied(link)}catch{setCopied('')}
  }

  const reward=dollars(data?.rewardCents||2500);
  const open=(data?.rewards||[]).filter(r=>r.status==='earned'||r.status==='approved');
  return <div className="settings-card referrals-card">
    <h3>Referral links</h3>
    <p className="job-meta">Give a caregiver their own link to share. Anyone who applies through it lands on this list as a referral. The referrer earns {reward} when the person they referred is screened with no knockout answer; CareJoys pays it. No reward for referring themselves or someone already on the list.</p>
    {notice&&<div className={'alert-status workspace-alert'+(notice.tone==='ok'?'':' alert-error')} role="status">{notice.tone==='ok'?'✓ ':''}{notice.text}</div>}
    <form className="intake-form referrer-form" onSubmit={add}>
      <label>Referrer’s name<input name="name" maxLength={120} required placeholder="Ana Lopez"/></label>
      <label>Phone<input name="phone" type="tel" maxLength={40} placeholder="410-555-0123"/></label>
      <label>Email<input name="email" type="email" maxLength={320} placeholder="ana@example.com"/></label>
      <button className="button" disabled={busy}>{busy?'Saving…':'Add referral link'}</button>
    </form>
    <p className="job-meta">A phone or email is needed, so they can be paid.</p>

    {data===null?<p className="job-meta">Loading…</p>:data.referrers.length>0&&<div className="admin-table-scroll">
      <table className="admin-data-table">
        <thead><tr><th>Referrer</th><th>Link</th><th>Referred</th><th>Earned</th></tr></thead>
        <tbody>{data.referrers.map(r=><tr key={r.id}>
          <td><strong>{r.name}</strong><small>{[r.phone,r.email].filter(Boolean).join(' · ')}</small></td>
          <td><code className="referral-link">{r.link}</code>
            <button type="button" className="text-link" onClick={()=>void copy(r.link)}>{copied===r.link?'Copied':'Copy link'}</button></td>
          <td>{r.referred}{r.screened>0&&<small>{r.screened} screened</small>}</td>
          <td>{dollars(r.earnedCents)}{r.paidCents>0&&<small>{dollars(r.paidCents)} paid</small>}</td>
        </tr>)}</tbody>
      </table>
    </div>}

    {data&&data.rewards.length>0&&<>
      <h4>Rewards{open.length>0&&` · ${open.length} to pay`}</h4>
      <div className="admin-table-scroll">
        <table className="admin-data-table">
          <thead><tr><th>Referred</th><th>Referrer</th><th>Amount</th><th>Status</th>{rewardsUrl&&<th></th>}</tr></thead>
          <tbody>{data.rewards.map(w=><tr key={w.applicantId}>
            <td>{w.applicantName}<small>Screened {day(w.earnedAt)}</small></td>
            <td>{w.referrerName}</td>
            <td>{dollars(w.amountCents)}</td>
            <td>{REWARD_LABELS[w.status]||w.status}{w.status==='paid'&&w.paidAt&&<small>{day(w.paidAt)}{w.paidBy?' · '+w.paidBy:''}</small>}
              {w.status==='approved'&&w.approvedAt&&<small>{day(w.approvedAt)}{w.approvedBy?' · '+w.approvedBy:''}</small>}</td>
            {rewardsUrl&&<td className="reward-actions">
              {w.status==='earned'&&<><button type="button" className="button secondary" disabled={busy} onClick={()=>void setReward(w.applicantId,'approved')}>Approve</button>
                <button type="button" className="text-link" disabled={busy} onClick={()=>void setReward(w.applicantId,'denied')}>Deny</button></>}
              {w.status==='approved'&&<><button type="button" className="button secondary" disabled={busy} onClick={()=>void setReward(w.applicantId,'paid')}>Mark paid</button>
                <button type="button" className="text-link" disabled={busy} onClick={()=>void setReward(w.applicantId,'denied')}>Deny</button></>}
              {w.status==='denied'&&<button type="button" className="text-link" disabled={busy} onClick={()=>void setReward(w.applicantId,'approved')}>Approve instead</button>}
            </td>}
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </div>;
}
