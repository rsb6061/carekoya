import { US_STATES } from './usStates';

// Display helpers for scraped job listings, shared by the job pages and the jobs hub.

const NAMED:Record<string,string>={
  amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',
  bull:'•',middot:'·',hellip:'…',mdash:'—',ndash:'–',trade:'™',reg:'®',copy:'©',deg:'°',
  rarr:'→',larr:'←',laquo:'«',raquo:'»',eacute:'é',egrave:'è',aacute:'á',ntilde:'ñ',uuml:'ü',ouml:'ö'
};

/** Turns HTML entities (&rsquo;, &bull;, &#39;, &#x2019; …) into the characters they stand for. */
export function decodeEntities(value:string){
  // Scraped text is often encoded twice ("&amp;rsquo;"), so unwrap &amp; first.
  return value.replace(/&amp;(?=#?[a-z0-9]+;)/gi,'&')
    .replace(/&#x([0-9a-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))
    .replace(/&#(\d+);/g,(_,num)=>String.fromCodePoint(parseInt(num,10)))
    .replace(/&([a-z]+);/gi,(m,name)=>NAMED[name.toLowerCase()]??m);
}

/** A job description split into readable paragraphs and bullet lists. */
export function descriptionBlocks(raw:string){
  const text=decodeEntities(raw).replace(/\s+/g,' ').trim();
  const [lead,...bullets]=text.split(/\s*[•▪●]\s*/);
  return {lead:lead.trim(),bullets:bullets.map(b=>b.trim()).filter(Boolean)};
}

const ACRONYMS=new Set(['cna','gna','hha','pca','dsp','cmt','lpn','rn','cna-i','pct','qmap','ma']);

/** "certified_nursing" → "Certified nursing"; role acronyms stay upper case ("CNA", not "Cna"). */
export function pillLabel(value:string){
  const normalized=value.replace(/[_]+/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
  if(!normalized)return '';
  if(ACRONYMS.has(normalized))return normalized.toUpperCase();
  return normalized.split(' ').map((w,i)=>ACRONYMS.has(w)?w.toUpperCase():i===0?w.charAt(0).toUpperCase()+w.slice(1):w).join(' ');
}

export type PayPeriod='hour'|'day'|'week'|'month'|'year';
export type Pay={min:number|null;max:number|null;period:PayPeriod|''};

// What each period plausibly pays a caregiver. A number outside its band is either mislabeled or wrong.
const PAY_BANDS:Record<PayPeriod,[number,number]>={hour:[7.25,100],day:[60,1200],week:[250,5000],month:[1000,20000],year:[15000,250000]};
const PERIODS=new Set<string>(Object.keys(PAY_BANDS));
const inBand=(n:number,period:PayPeriod)=>n>=PAY_BANDS[period][0]&&n<=PAY_BANDS[period][1];

/**
 * Cleans scraped pay before it is stored or shown. Careers pages often tag an hourly $17.99 as yearly,
 * or put a paycheck amount ($1104.57) under "hourly". An amount that fits only the hourly band becomes
 * hourly, one that fits only the yearly band becomes yearly, and anything still implausible is dropped
 * so caregivers never see a made-up number.
 */
export function normalizePay(minRaw:unknown,maxRaw:unknown,periodRaw:unknown):Pay{
  const num=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>0?Math.round(n*100)/100:null};
  let min=num(minRaw),max=num(maxRaw);
  if(min!==null&&max!==null&&min>max)[min,max]=[max,min];
  const top=max??min;
  if(top===null)return {min:null,max:null,period:''};
  const labeled=String(periodRaw||'').toLowerCase();
  let period:PayPeriod|''=PERIODS.has(labeled)?labeled as PayPeriod:'';
  if(!period||!inBand(top,period)){
    if(inBand(top,'hour'))period='hour';
    else if(inBand(top,'year'))period='year';
    else if(period&&min!==null&&inBand(min,period))max=null;  // "$18–$1800/hr": keep the believable floor
    else if(min!==null&&inBand(min,'hour')){period='hour';max=null}
    else return {min:null,max:null,period:''};
  }
  if(min!==null&&!inBand(min,period))min=null;
  if(max!==null&&!inBand(max,period))max=null;
  if(min!==null&&max!==null&&max>min*4)max=null;  // a 4x spread is two different jobs or a typo
  if(min===null&&max===null)return {min:null,max:null,period:''};
  return {min,max,period};
}

const SUFFIX:Record<string,string>={hour:'/hr',day:'/day',week:'/wk',month:'/mo',year:'/yr'};
const money=(n:number)=>'$'+(Number.isInteger(n)?n.toLocaleString('en-US'):n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));

/** "$16–$20/hr", "$18/hr", "Up to $20/hr". The one pay format for every job card, page, email and the MCP. */
export function payLabel(job:{payMin?:unknown;payMax?:unknown;payPeriod?:unknown}){
  const {min,max,period}=normalizePay(job.payMin,job.payMax,job.payPeriod);
  const suffix=SUFFIX[period]||'';
  if(min!==null&&max!==null)return min===max?money(min)+suffix:money(min)+'–'+money(max)+suffix;
  if(min!==null)return money(min)+suffix;
  if(max!==null)return 'Up to '+money(max)+suffix;
  return '';
}

const STATE_FIX=new Map(US_STATES.map(([,name])=>[name.toLowerCase(),name]));
const STATE_WORDS=new RegExp('\\b(?:'+US_STATES.map(([,name])=>name.replace(/ /g,'\\s+')).join('|')+')\\b','gi');
const SMALL=new Set(['a','an','and','at','for','in','of','on','or','the','to','with']);

/**
 * Repairs scraped title casing: "CNA Caregiver in MaryLand" → "Maryland", and SHOUTED or all lower case
 * titles become title case. Role acronyms stay upper case.
 */
export function tidyTitle(value:string){
  let t=value.replace(STATE_WORDS,w=>STATE_FIX.get(w.toLowerCase().replace(/\s+/g,' '))??w);
  const letters=t.replace(/[^a-z]/gi,'');
  if(letters.length>=4&&(letters===letters.toUpperCase()||letters===letters.toLowerCase())){
    t=t.toLowerCase().replace(/[a-z][a-z'-]*/g,(w,i:number)=>{
      if(ACRONYMS.has(w))return w.toUpperCase();
      if(i>0&&SMALL.has(w))return w;
      return w.charAt(0).toUpperCase()+w.slice(1);
    });
  }
  return t;
}

const DAY=86400000;
// D1's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker.
const parseStamp=(value:unknown)=>{
  const s=String(value??'').trim();
  if(!s)return null;
  const t=Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(s)?s.replace(' ','T')+'Z':s);
  return Number.isFinite(t)?new Date(t):null;
};

/**
 * When a job was posted. Career pages give dates in every shape: ISO, "10/20/2026", "October 12, 2026 at…",
 * and Workday's relative "Posted 10 Days Ago" or "Posted 30+ Days Ago", which only means something next to
 * the day CareJoys read it (`seenAt`). Returns null when nothing usable is stored.
 */
export function parsePostedDate(datePosted:unknown,seenAt?:unknown):Date|null{
  const raw=String(datePosted??'').trim();
  if(!raw)return null;
  const seen=parseStamp(seenAt)||new Date();
  const rel=raw.toLowerCase().replace(/^posted\s+/,'').replace(/^on\s+/,'');
  if(/^today$/.test(rel))return seen;
  if(/^yesterday$/.test(rel))return new Date(seen.getTime()-DAY);
  const ago=rel.match(/^(\d+)\+?\s*(day|week|month|hour|minute)s?\s*ago$/);
  if(ago){
    const n=Number(ago[1]);
    const unit=ago[2]==='week'?7*DAY:ago[2]==='month'?30*DAY:ago[2]==='day'?DAY:0;  // hours and minutes ago are today
    return new Date(seen.getTime()-n*unit);
  }
  const us=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(us)return new Date(Date.UTC(Number(us[3]),Number(us[1])-1,Number(us[2])));
  const parsed=parseStamp(raw.replace(/\s+at\s+.*$/i,''));
  if(!parsed)return null;
  // A date in the future or before the web existed is a scrape error, not a posting date.
  if(parsed.getTime()>seen.getTime()+DAY||parsed.getUTCFullYear()<2000)return null;
  return parsed;
}

export type JobDates={datePosted?:unknown;firstSeenAt?:unknown;lastSeenAt?:unknown;lastCheckedAt?:unknown};

/** The posted date (falling back to when CareJoys first saw the job) and when it was last confirmed live. */
export function jobDates(job:JobDates){
  const posted=parsePostedDate(job.datePosted,job.lastSeenAt)||parseStamp(job.firstSeenAt)||parseStamp(job.lastSeenAt);
  const checked=parseStamp(job.lastCheckedAt)||parseStamp(job.lastSeenAt);
  return {posted,checked};
}

/** "today", "yesterday", "3 days ago", "2 weeks ago", "3 months ago". */
export function agoLabel(date:Date,now=new Date()){
  const days=Math.max(0,Math.floor((now.getTime()-date.getTime())/DAY));
  if(days===0)return 'today';
  if(days===1)return 'yesterday';
  if(days<14)return days+' days ago';
  if(days<60)return Math.floor(days/7)+' weeks ago';
  if(days<365)return Math.floor(days/30)+' months ago';
  return 'over a year ago';
}

/** "Posted 3 days ago · Checked today": the line under every job card that says how fresh the listing is. */
export function freshnessLine(job:JobDates,now=new Date()){
  const {posted,checked}=jobDates(job);
  const parts:string[]=[];
  if(posted)parts.push('Posted '+agoLabel(posted,now));
  if(checked)parts.push('Checked '+agoLabel(checked,now));
  return parts.join(' · ');
}

/** The hours filter on the job pages: a stored employment_type like "Full time, Part time" matches each of its parts. */
export const HOURS_FILTERS=[
  {slug:'full-time',label:'Full-time',sql:'%full time%'},
  {slug:'part-time',label:'Part-time',sql:'%part time%'},
  {slug:'per-diem',label:'Per diem',sql:'%per diem%'},
] as const;
export type HoursFilter=typeof HOURS_FILTERS[number]['slug'];
export const hoursFilter=(value:unknown):HoursFilter|''=>HOURS_FILTERS.find(h=>h.slug===String(value||'').toLowerCase())?.slug||'';
