import { useState, type FormEvent, type ReactNode } from 'react';

// The caregiver's full profile: what agencies match on beyond the resume. Shared by the dashboard checklist
// (what's missing) and the editor at /me/profile.

export const DAYS=[['mon','Mon'],['tue','Tue'],['wed','Wed'],['thu','Thu'],['fri','Fri'],['sat','Sat'],['sun','Sun']] as const;
export const BLOCKS=[['morning','Mornings','7am–3pm'],['afternoon','Afternoons','11am–7pm'],['evening','Evenings','3pm–11pm'],['overnight','Overnights','11pm–7am']] as const;
const CERTIFICATIONS=['CNA','GNA','HHA','CMT / Med Tech','PCA','DSP','LPN','RN','CPR / First Aid','BLS'];
const SKILLS=['Dementia / Alzheimer’s','Bathing & personal care','Transfers & mobility','Hoyer lift','Medication reminders','Meal prep','Light housekeeping','Companionship','Hospice / end of life','Diabetes care','Catheter / ostomy care','Developmental disabilities','Pediatric care'];
const SETTINGS=['Home care','Assisted living','Nursing home','Hospital','Hospice','Group home'];
const LANGUAGES=['English','Spanish','French','Haitian Creole','Amharic','Tagalog','Yoruba','Igbo','Twi','Vietnamese','Korean','Chinese','Russian','Arabic'];

export type Availability={days:Record<string,string[]>;liveIn:boolean};
export type CaregiverProfileData={
  firstName?:string;lastName?:string;phone?:string;zip?:string;city?:string;state?:string;role?:string;
  certifications?:string;licenseNumber?:string;licenseState?:string;yearsExperience?:number|null;specialties?:string;careSettings?:string[];languages?:string;bio?:string;
  availability?:Availability;employmentTypes?:string[];startAvailability?:string;workConditions?:string[];
  desiredWage?:string;transportation?:string;travelMiles?:number|null;workStatus?:string;
};

const list=(v?:string|string[])=>(Array.isArray(v)?v:(v||'').split(',')).map(x=>x.trim()).filter(Boolean);
const hasAvailability=(a?:Availability)=>!!a&&(a.liveIn||Object.values(a.days||{}).some(b=>b.length>0));
const payNumber=(wage?:string)=>{const m=(wage||'').match(/\d+(\.\d+)?/);return m?m[0]:''};

/** What's still missing, in the order agencies care about it. */
export function profileGaps(c:CaregiverProfileData,hasResume:boolean){
  const gaps:{key:string;label:string}[]=[];
  if(!hasAvailability(c.availability))gaps.push({key:'availability',label:'Which days and shifts you can work'});
  if(!c.startAvailability)gaps.push({key:'start',label:'When you can start'});
  if(!list(c.employmentTypes).length)gaps.push({key:'hours',label:'Full-time, part-time or per diem'});
  if(!list(c.certifications).length)gaps.push({key:'certs',label:'Your certifications'});
  if(list(c.certifications).some(x=>/^(CNA|GNA|CMT|LPN|RN)/i.test(x))&&!c.licenseNumber)gaps.push({key:'license',label:'Your license number, so employers can verify it'});
  if(!list(c.specialties).length)gaps.push({key:'skills',label:'The care you’re experienced with'});
  if(!c.transportation)gaps.push({key:'transport',label:'How you get to work'});
  if(!payNumber(c.desiredWage))gaps.push({key:'pay',label:'Your minimum hourly pay'});
  if(!c.phone)gaps.push({key:'phone',label:'Your mobile number'});
  if(!hasResume)gaps.push({key:'resume',label:'Your resume file'});
  return gaps;
}
export const PROFILE_ITEMS=10;

function Chips({options,value,onChange}:{options:readonly string[];value:string[];onChange:(next:string[])=>void}){
  return <div className="chip-row">{options.map(o=>{
    const on=value.includes(o);
    return <button type="button" key={o} className={'chip'+(on?' on':'')} aria-pressed={on} onClick={()=>onChange(on?value.filter(v=>v!==o):[...value,o])}>{o}</button>;
  })}</div>;
}
function Section({title,hint,children}:{title:string;hint?:string;children:ReactNode}){
  return <section className="settings-card profile-section"><h3>{title}</h3>{hint&&<p className="job-meta">{hint}</p>}{children}</section>;
}

export function CaregiverProfileEditor({caregiver,save}:{caregiver:CaregiverProfileData;save:(body:Record<string,unknown>)=>Promise<void>}){
  const c=caregiver;
  const [days,setDays]=useState<Record<string,string[]>>(()=>Object.fromEntries(DAYS.map(([d])=>[d,c.availability?.days?.[d]||[]])));
  const [liveIn,setLiveIn]=useState(!!c.availability?.liveIn);
  const [certs,setCerts]=useState(list(c.certifications));
  const [skills,setSkills]=useState(list(c.specialties));
  const [settings,setSettings]=useState(list(c.careSettings));
  const [languages,setLanguages]=useState(list(c.languages).length?list(c.languages):['English']);
  const [hours,setHours]=useState(list(c.employmentTypes));
  const [conditions,setConditions]=useState(list(c.workConditions));
  const [looking,setLooking]=useState(c.workStatus!=='not_looking'&&c.workStatus!=='maybe_later');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');

  const toggle=(day:string,block:string)=>setDays(prev=>({...prev,[day]:prev[day].includes(block)?prev[day].filter(b=>b!==block):[...prev[day],block]}));
  const toggleRow=(block:string)=>{const all=DAYS.every(([d])=>days[d].includes(block));setDays(prev=>Object.fromEntries(DAYS.map(([d])=>[d,all?prev[d].filter(b=>b!==block):[...new Set([...prev[d],block])]])))};

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSaving(true);setError('');
    const fd=new FormData(e.currentTarget);
    const text=(k:string)=>String(fd.get(k)||'');
    try{
      await save({
        firstName:text('firstName'),lastName:text('lastName'),phone:text('phone'),zip:text('zip'),role:text('role'),
        certifications:certs,licenseNumber:text('licenseNumber'),licenseState:text('licenseState'),yearsExperience:Number(text('yearsExperience')||0),
        specialties:skills,careSettings:settings,languages,bio:text('bio'),
        availability:{days,liveIn},employmentTypes:hours,startAvailability:text('startAvailability'),workConditions:conditions,
        payMin:Number(text('payMin')||0),transportation:text('transportation'),travelMiles:Number(text('travelMiles')||0),
        workStatus:looking?'actively_looking':'not_looking'
      });
    }catch(err){setError(err instanceof Error?err.message:'Could not save your profile.')}
    finally{setSaving(false)}
  }

  return <form className="profile-editor intake-form" onSubmit={submit}>
    <Section title="When you can work" hint="Tap the shifts you can usually work. Employers match you to openings on these.">
      <div className="availability-grid" role="group" aria-label="Weekly availability">
        <span/>
        {DAYS.map(([d,label])=><span key={d} className="availability-day">{label}</span>)}
        {BLOCKS.map(([b,label,time])=><div className="availability-row" key={b} style={{display:'contents'}}>
          <button type="button" className="availability-block" onClick={()=>toggleRow(b)} title="Select the whole row"><strong>{label}</strong><small>{time}</small></button>
          {DAYS.map(([d,dayLabel])=>{const on=days[d].includes(b);return <button type="button" key={d} className={'availability-cell'+(on?' on':'')} aria-pressed={on} aria-label={dayLabel+' '+label} onClick={()=>toggle(d,b)}>{on?'✓':''}</button>})}
        </div>)}
      </div>
      <label className="check-row"><input type="checkbox" checked={liveIn} onChange={e=>setLiveIn(e.target.checked)}/><span>I’m open to live-in jobs</span></label>
      <div className="form-grid">
        <div className="chip-field"><span>Hours I want</span><Chips options={['Full-time','Part-time','Per diem']} value={hours.map(h=>({full_time:'Full-time',part_time:'Part-time',per_diem:'Per diem'} as Record<string,string>)[h]||h)} onChange={v=>setHours(v.map(x=>({'Full-time':'full_time','Part-time':'part_time','Per diem':'per_diem'} as Record<string,string>)[x]))}/></div>
        <label>I can start<select name="startAvailability" defaultValue={c.startAvailability||''}>
          <option value="">Select</option><option value="now">Right away</option><option value="2_weeks">Within 2 weeks</option><option value="1_month">Within a month</option><option value="later">Later than a month</option>
        </select></label>
      </div>
      <label className="check-row"><input type="checkbox" checked={looking} onChange={e=>setLooking(e.target.checked)}/><span>Show me to employers as looking for work</span></label>
    </Section>

    <Section title="Credentials and experience">
      <div className="form-grid">
        <label>Main role<select name="role" defaultValue={c.role||'Caregiver'}>{['CNA','GNA','HHA','PCA','DSP','CMT','Caregiver','Other'].map(r=><option key={r}>{r}</option>)}</select></label>
        <label>Years of experience<input name="yearsExperience" type="number" min="0" max="60" defaultValue={c.yearsExperience??''}/></label>
      </div>
      <div className="chip-field"><span>Certifications</span><Chips options={CERTIFICATIONS} value={certs} onChange={setCerts}/></div>
      <div className="form-grid">
        <label>License or certificate number<input name="licenseNumber" defaultValue={c.licenseNumber||''} placeholder="e.g. CNA license number"/></label>
        <label>Issuing state<input name="licenseState" defaultValue={c.licenseState||c.state||''} maxLength={2} placeholder="MD"/></label>
      </div>
      <div className="chip-field"><span>Care I’m experienced with</span><Chips options={SKILLS} value={skills} onChange={setSkills}/></div>
      <div className="chip-field"><span>Where I’ve worked</span><Chips options={SETTINGS} value={settings} onChange={setSettings}/></div>
      <div className="chip-field"><span>Languages I speak</span><Chips options={LANGUAGES} value={languages} onChange={setLanguages}/></div>
      <div className="chip-field"><span>I’m comfortable with</span><Chips options={['Pets in the home','Smokers in the home']} value={conditions.map(x=>x==='pets'?'Pets in the home':'Smokers in the home')} onChange={v=>setConditions(v.map(x=>x.startsWith('Pets')?'pets':'smokers'))}/></div>
    </Section>

    <Section title="Pay and travel">
      <div className="form-grid">
        <label>Minimum hourly pay<input name="payMin" type="number" min="0" max="200" step="0.5" defaultValue={payNumber(c.desiredWage)} placeholder="$18"/></label>
        <label>Getting to work<select name="transportation" defaultValue={c.transportation||''}><option value="">Select</option><option value="own_car">Own car</option><option value="reliable_transportation">Reliable transportation</option><option value="public_transit">Public transit</option><option value="other">Other</option></select></label>
      </div>
      <div className="form-grid">
        <label>Home ZIP<input name="zip" defaultValue={c.zip||''} inputMode="numeric" pattern="[0-9]{5}" required/></label>
        <label>Travel distance<select name="travelMiles" defaultValue={String(c.travelMiles||25)}>{[5,10,15,25,35,50].map(m=><option key={m} value={m}>{m} miles</option>)}</select></label>
      </div>
    </Section>

    <Section title="About you" hint="Your phone number is only shared with employers you apply to or accept.">
      <div className="form-grid">
        <label>First name<input name="firstName" defaultValue={c.firstName||''} required/></label>
        <label>Last name<input name="lastName" defaultValue={c.lastName||''} required/></label>
      </div>
      <label>Mobile phone<input name="phone" type="tel" autoComplete="tel" defaultValue={c.phone||''}/></label>
      <label>A few words for employers<textarea name="bio" rows={3} maxLength={1200} defaultValue={c.bio||''} placeholder="What you love about caregiving, the clients you work best with…"/></label>
    </Section>

    {error&&<div className="notice">{error}</div>}
    <div className="profile-save-bar"><button className="button" disabled={saving}>{saving?'Saving…':'Save my profile'}</button><a className="text-link" href="/me">Cancel</a></div>
  </form>;
}
