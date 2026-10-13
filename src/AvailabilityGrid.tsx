import './availability.css';

export const DAYS=[['mon','Mon'],['tue','Tue'],['wed','Wed'],['thu','Thu'],['fri','Fri'],['sat','Sat'],['sun','Sun']] as const;
export const BLOCKS=[['morning','Mornings','7am–3pm'],['afternoon','Afternoons','11am–7pm'],['evening','Evenings','3pm–11pm'],['overnight','Overnights','11pm–7am']] as const;
export type Availability={days:Record<string,string[]>;liveIn:boolean};
export const emptyDays=(from?:Record<string,string[]>)=>Object.fromEntries(DAYS.map(([d])=>[d,from?.[d]||[]])) as Record<string,string[]>;
export const hasAvailability=(a?:Availability|null)=>!!a&&(a.liveIn||Object.values(a.days||{}).some(b=>b.length>0));

/** Which shifts of which days a caregiver can work, Mon–Sun: tap a cell, or a row label for every day. */
export function AvailabilityGrid({days,setDays}:{days:Record<string,string[]>;setDays:(update:(prev:Record<string,string[]>)=>Record<string,string[]>)=>void}){
  const toggle=(day:string,block:string)=>setDays(prev=>({...prev,[day]:prev[day].includes(block)?prev[day].filter(b=>b!==block):[...prev[day],block]}));
  const toggleRow=(block:string)=>{const all=DAYS.every(([d])=>days[d].includes(block));setDays(prev=>Object.fromEntries(DAYS.map(([d])=>[d,all?prev[d].filter(b=>b!==block):[...new Set([...prev[d],block])]])))};
  return <div className="availability-grid" role="group" aria-label="Weekly availability">
    <span/>
    {DAYS.map(([d,label])=><span key={d} className="availability-day">{label}</span>)}
    {BLOCKS.map(([b,label,time])=><div className="availability-row" key={b} style={{display:'contents'}}>
      <button type="button" className="availability-block" onClick={()=>toggleRow(b)} title="Select the whole row"><strong>{label}</strong><small>{time}</small></button>
      {DAYS.map(([d,dayLabel])=>{const on=days[d].includes(b);return <button type="button" key={d} className={'availability-cell'+(on?' on':'')} aria-pressed={on} aria-label={dayLabel+' '+label} onClick={()=>toggle(d,b)}>{on?'✓':''}</button>})}
    </div>)}
  </div>;
}
