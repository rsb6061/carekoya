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
