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

/** "$16–$20/hr". Scraped pay periods are sometimes wrong (an hourly $17.99 tagged as yearly), so the amount wins. */
export function payLabel(job:{payMin?:number|null;payMax?:number|null;payPeriod?:string}){
  const min=Number(job.payMin||0),max=Number(job.payMax||0);
  const top=Math.max(min,max);
  let period=job.payPeriod||'';
  if(top&&top<200&&(period==='year'||period==='month'||period==='week'))period='hour';
  if(top>=10000&&period==='hour')period='year';
  const suffix=period==='year'?'/yr':period==='week'?'/wk':period==='day'?'/day':period==='month'?'/mo':period==='hour'?'/hr':'';
  const money=(n:number)=>'$'+(Number.isInteger(n)?n:n.toFixed(2)).toLocaleString();
  if(min&&max&&min!==max)return money(min)+'–'+money(max)+suffix;
  if(min||max)return (min&&max?'':min?'From ':'Up to ')+money(min||max)+suffix;
  return '';
}
