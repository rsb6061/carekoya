import { type FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});

type DiscoveredJob={
  sourceProvider:string;
  sourceJobId:string;
  sourceUrl:string;
  sourceListingUrl:string;
  title:string;
  role:string;
  city:string;
  state:string;
  zip:string;
  employmentType:string;
  payMin:number|null;
  payMax:number|null;
  descriptionText:string;
  classifierReason:string;
  confidence:number;
  datePosted:string;
  validThrough:string;
  payPeriod?:string;
  roles?:string[];
  normalizedTitle?:string;
};

async function sha256Hex(value:string){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function fetchText(url:string,ms=7000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  try{
    const res=await fetch(url,{redirect:'follow',headers:{'user-agent':'CareJoysBot/1.0 (+https://carejoys.com)'},signal:controller.signal});
    if(!res.ok)return null;
    const type=res.headers.get('content-type')||'';
    if(!type.includes('text/html')&&!type.includes('text/plain'))return null;
    return {url:res.url,text:(await res.text()).slice(0,900000)};
  }catch{return null}finally{clearTimeout(timer)}
}
async function fetchAgencyRoot(org:Row,preferred:string){
  const candidates:string[]=[];
  const add=(url:string)=>{if(url&&!candidates.includes(url))candidates.push(url)};
  add(preferred);
  const domain=clean(org.primary_domain,240).replace(/^https?:\/\//,'').replace(/\/$/,'').replace(/^www\./,'');
  if(domain&&!/@/.test(domain)){
    add('https://'+domain+'/');
    add('https://www.'+domain+'/');
    add('http://'+domain+'/');
    add('http://www.'+domain+'/');
  }
  for(const url of candidates){
    const page=await fetchText(url,6500);
    if(page)return page;
  }
  return null;
}
async function fetchJson(url:string,ms=7000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  try{
    const res=await fetch(url,{redirect:'follow',headers:{'user-agent':'CareJoysBot/1.0 (+https://carejoys.com)','accept':'application/json,text/plain,*/*'},signal:controller.signal});
    if(!res.ok)return null;
    return await res.json() as unknown;
  }catch{return null}finally{clearTimeout(timer)}
}
async function fetchJsonPost(url:string,body:unknown,ms=8000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  try{
    const res=await fetch(url,{
      method:'POST',
      redirect:'follow',
      headers:{'user-agent':'CareJoysBot/1.0 (+https://carejoys.com)','accept':'application/json','content-type':'application/json'},
      body:JSON.stringify(body),
      signal:controller.signal
    });
    if(!res.ok)return null;
    return await res.json() as unknown;
  }catch{return null}finally{clearTimeout(timer)}
}
function decodeHtml(value:string){
  return value
    .replace(/&#x([0-9a-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))
    .replace(/&#(\d+);/g,(_,num)=>String.fromCodePoint(parseInt(num,10)))
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ');
}
function stripHtml(value:unknown,max=8000){
  return decodeHtml(clean(value,max*2))
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,max);
}
function htmlText(html:string){
  return stripHtml(html,12000);
}
function normalizeState(value:unknown){
  const s=clean(value,80);
  if(/^maryland$/i.test(s)||/^md$/i.test(s))return 'MD';
  return s.length===2?s.toUpperCase():s;
}
function normalizeCity(value:unknown){
  let s=decodeHtml(clean(value,140)).replace(/\s+/g,' ').replace(/\s*,?\s*(Maryland|MD)\s*$/i,'').trim();
  if(!s)return '';
  if(s===s.toUpperCase()||s===s.toLowerCase()){
    s=s.toLowerCase().replace(/\b[a-z]/g,ch=>ch.toUpperCase());
  }
  return s;
}
function mdZip(zip:string){
  const n=Number(zip.slice(0,3));
  return /^\d{5}/.test(zip)&&n>=206&&n<=219;
}
function escapeRegex(value:string){
  return value.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&');
}
function normalizeTitle(value:unknown){
  return decodeHtml(clean(value,320))
    .replace(/\u00a0/g,' ')
    .replace(/[‐‑‒–—]+/g,' – ')
    .replace(/\s*\+\s*/g,' + ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,220);
}
const ROLE_RULES:[string,RegExp][]=[
  ['GNA',/\b(gna|geriatric nursing assistant)\b/i],
  ['CNA',/\b(cna(?:-i)?|certified nursing assistant|nursing assistant)\b/i],
  ['HHA',/\b(hha|home health aide)\b/i],
  ['PCA',/\b(pca|personal care aide|personal care assistant)\b/i],
  ['DSP',/\b(dsp|direct support professional|direct care professional|direct care worker)\b/i],
  ['Caregiver',/\b(caregiver|care giver|companion(?: caregiver| care)?|companion care|personal\s*(?:&|and)\s*companion care|home care aide|homecare aide|private duty caregiver)\b/i],
  ['CMT',/\b(cmt|certified medication technician)\b/i],
  ['LPN',/\b(lpn|licensed practical nurse)\b/i],
  ['RN',/\b(rn|registered nurse)\b/i]
];
const TARGET_ROLES=new Set(['GNA','CNA','HHA','PCA','DSP','Caregiver']);
function roleClassification(title:string,description=''){
  const normalized=normalizeTitle(title);
  const matches:{role:string;index:number}[]=[];
  for(const [role,re] of ROLE_RULES){
    const m=normalized.match(re);
    if(m&&typeof m.index==='number')matches.push({role,index:m.index});
  }
  matches.sort((a,b)=>a.index-b.index);
  const titleRoles=Array.from(new Set(matches.map(m=>m.role)));
  const target=titleRoles.filter(r=>TARGET_ROLES.has(r));
  if(target.length)return {
    role:target[0],
    roles:titleRoles,
    confidence:96,
    reason:titleRoles.length>1?'mixed-role caregiver title: '+titleRoles.join(', '):target[0]+' title'
  };
  if(/\b(nurse practitioner|therapist|scheduler|coordinator|administrator|manager|director)\b/i.test(normalized))return null;
  if(/\b(rn|registered nurse|lpn|licensed practical nurse)\b/i.test(normalized))return null;
  const descRoles=ROLE_RULES.filter(([,re])=>re.test(description)).map(([role])=>role);
  const descTargets=Array.from(new Set(descRoles)).filter(r=>TARGET_ROLES.has(r));
  if(descTargets.length)return {
    role:descTargets[0],
    roles:Array.from(new Set(descRoles)),
    confidence:72,
    reason:'caregiver role appears only in job description'
  };
  return null;
}
function normalizeEmploymentType(raw:string,title='',description=''){
  const all=(raw+' '+title+' '+description).replace(/_/g,' ').toLowerCase();
  const out:string[]=[];
  const add=(v:string)=>{if(!out.includes(v))out.push(v)};
  if(/\bfull[\s-]*time\b/.test(all))add('Full time');
  if(/\bpart[\s-]*time\b/.test(all))add('Part time');
  if(/\bper[\s-]*diem\b|\bprn\b/.test(all))add('Per diem');
  if(/\btemporary\b|\btemp\b/.test(all))add('Temporary');
  if(/\bcontract\b/.test(all))add('Contract');
  if(/\bseasonal\b/.test(all))add('Seasonal');
  return out.join(', ');
}
function payPeriod(raw:unknown){
  const s=clean(raw,80).toLowerCase().replace(/_/g,' ');
  if(/\b(hour|hourly|hr)\b/.test(s))return 'hour';
  if(/\b(year|yearly|annual|yr)\b/.test(s))return 'year';
  if(/\b(week|weekly|wk)\b/.test(s))return 'week';
  if(/\b(day|daily)\b/.test(s))return 'day';
  if(/\b(month|monthly)\b/.test(s))return 'month';
  return '';
}
function payFromText(text:string){
  const normalized=text.replace(/,/g,' ');
  const range=normalized.match(/\$(\d{1,6}(?:\.\d{1,2})?)\s*(?:-|–|—|to)\s*\$?(\d{1,6}(?:\.\d{1,2})?)\s*(?:\/|per\s+)?(hour|hr|year|yr|week|wk|day|month)\b/i);
  if(range)return {min:Number(range[1]),max:Number(range[2]),period:payPeriod(range[3])};
  const single=normalized.match(/\$(\d{1,6}(?:\.\d{1,2})?)\s*(?:\/|per\s+)(hour|hr|year|yr|week|wk|day|month)\b/i);
  if(single)return {min:Number(single[1]),max:null,period:payPeriod(single[2])};
  return {min:null,max:null,period:''};
}
function rootHost(value:unknown){
  try{
    const parts=new URL(clean(value,1000)).hostname.toLowerCase().replace(/^www\./,'').split('.');
    return parts.slice(Math.max(0,parts.length-2)).join('.');
  }catch{return ''}
}
function sameOrgDomain(url:string,org:Row){
  const a=rootHost(url),b=rootHost(org.primary_website);
  return !!a&&!!b&&a===b;
}
function badCareerUrl(url:string){
  try{
    const h=new URL(url).hostname.toLowerCase();
    return /(google|bing|duckduckgo|indeed|glassdoor|ziprecruiter|linkedin|facebook|yahoo|juno)\.com$/.test(h);
  }catch{return true}
}
function salaryParts(value:any){
  let min:number|null=null,max:number|null=null,period='';
  const raw=value?.value??value;
  const unit=value?.unitText??raw?.unitText??raw?.unitCode;
  if(typeof raw==='number')min=max=raw;
  else if(raw&&typeof raw==='object'){
    const a=Number(raw.minValue??raw.value??0),b=Number(raw.maxValue??raw.value??0);
    if(Number.isFinite(a)&&a>0)min=a;
    if(Number.isFinite(b)&&b>0)max=b;
  }
  period=payPeriod(unit);
  return {min,max,period};
}
function locationParts(job:any){
  const loc=Array.isArray(job?.jobLocation)?job.jobLocation[0]:job?.jobLocation;
  const address=loc?.address||{};
  return {
    city:normalizeCity(address.addressLocality),
    state:normalizeState(address.addressRegion),
    zip:clean(address.postalCode,20).match(/\b\d{5}\b/)?.[0]||''
  };
}
function collectJobPostingObjects(value:unknown,out:any[]=[]){
  if(!value||typeof value!=='object')return out;
  if(Array.isArray(value)){for(const item of value)collectJobPostingObjects(item,out);return out}
  const obj=value as Record<string,unknown>;
  const type=obj['@type'];
  if(type==='JobPosting'||(Array.isArray(type)&&type.includes('JobPosting')))out.push(obj);
  for(const child of Object.values(obj))collectJobPostingObjects(child,out);
  return out;
}
function parseJsonLdJobs(html:string,pageUrl:string){
  const rawJobs:any[]=[];
  const re=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for(const match of html.matchAll(re)){
    const raw=match[1].trim();
    if(!raw)continue;
    try{collectJobPostingObjects(JSON.parse(raw),rawJobs)}catch{}
  }
  return rawJobs.map((job:any)=>{
    const title=clean(job.title||job.name,220);
    const description=stripHtml(job.description,8000);
    const cls=roleClassification(title,description);
    if(!cls)return null;
    const loc=locationParts(job);
    const salary=salaryParts(job.baseSalary);
    const identifier=job.identifier&&typeof job.identifier==='object'?job.identifier.value:job.identifier;
    return {
      sourceProvider:'jsonld',
      sourceJobId:clean(identifier,200),
      sourceUrl:clean(job.url,1000)||pageUrl,
      sourceListingUrl:pageUrl,
      title,role:cls.role,city:loc.city,state:loc.state,zip:loc.zip,
      employmentType:Array.isArray(job.employmentType)?job.employmentType.join(', '):clean(job.employmentType,120),
      payMin:salary.min,payMax:salary.max,payPeriod:salary.period,descriptionText:description,classifierReason:cls.reason,
      confidence:cls.confidence,datePosted:clean(job.datePosted,80),validThrough:clean(job.validThrough,80),
      roles:cls.roles,normalizedTitle:normalizeTitle(title).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
    } as DiscoveredJob;
  }).filter(Boolean) as DiscoveredJob[];
}
function atsInfo(url:string){
  try{
    const u=new URL(url);
    const host=u.hostname.toLowerCase();
    const parts=u.pathname.split('/').filter(Boolean);
    if(host.endsWith('greenhouse.io')){
      const board=parts[0]||'';
      return board?{provider:'greenhouse',account:board}:null;
    }
    if(host==='jobs.lever.co'){
      const account=parts[0]||'';
      return account?{provider:'lever',account}:null;
    }
    if(host==='jobs.ashbyhq.com'){
      const account=parts[0]||'';
      return account?{provider:'ashby',account}:null;
    }
    if(host.includes('myworkdayjobs.com')||host.includes('workday.com'))return {provider:'workday',account:''};
    if(host.includes('icims.com'))return {provider:'icims',account:''};
    if(host.includes('paylocity.com'))return {provider:'paylocity',account:''};
    if(host.includes('bamboohr.com'))return {provider:'bamboohr',account:''};
    if(host.includes('paycomonline.net'))return {provider:'paycom',account:''};
    if(host.includes('ultipro.com')||host.includes('ukg.com'))return {provider:'ukg',account:''};
    if(host.includes('jazz.co')||host.includes('applytojob.com'))return {provider:'jazzhr',account:''};
    if(host.includes('workable.com'))return {provider:'workable',account:''};
  }catch{}
  return null;
}
function locationStringParts(value:string){
  const s=clean(value,300);
  const zip=s.match(/\b(20[6-9]\d{2}|21\d{3})\b/)?.[1]||'';
  const state=/\bMaryland\b/i.test(s)||/\bMD\b/.test(s)?'MD':'';
  const city=state?normalizeCity(s.split(',')[0]):'';
  return {city,state,zip};
}
function downstreamAtsLinks(base:string,html:string){
  const out:{url:string;provider:string}[]=[];
  const seen=new Set<string>();
  const re=/\b(?:href|src|action|data-src|data-url)=["']([^"']+)["']/gi;
  for(const m of html.matchAll(re)){
    try{
      const url=new URL(decodeHtml(m[1]),base).toString();
      const ats=atsInfo(url);
      if(!ats||seen.has(url))continue;
      seen.add(url);
      out.push({url,provider:ats.provider});
    }catch{}
    if(out.length>=8)break;
  }
  const rawProviders=/(https?:\\?\/\\?\/[^"'<>\s]+(?:workday|myworkdayjobs|icims|paylocity|greenhouse|lever\.co|ashby|bamboohr|paycom|ultipro|ukg|applytojob|workable)[^"'<>\s]*)/gi;
  for(const m of html.matchAll(rawProviders)){
    try{
      const raw=m[1].replace(/\\\//g,'/');
      const url=new URL(raw,base).toString();
      const ats=atsInfo(url);
      if(!ats||seen.has(url))continue;
      seen.add(url);
      out.push({url,provider:ats.provider});
    }catch{}
    if(out.length>=8)break;
  }
  return out;
}
function careerPageLinks(base:string,html:string){
  const out:string[]=[];
  const seen=new Set<string>();
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for(const m of html.matchAll(re)){
    const href=decodeHtml(m[1]);
    const text=stripHtml(m[2],180);
    if(!/(career|jobs?|employment|join (our )?team|work with us|opportunit)/i.test(text+' '+href))continue;
    try{
      const url=new URL(href,base).toString();
      if(!/^https?:/i.test(url)||seen.has(url)||badCareerUrl(url))continue;
      seen.add(url);
      out.push(url);
    }catch{}
    if(out.length>=5)break;
  }
  return out;
}
async function probeCommonCareerPage(base:string){
  const paths=['/careers','/jobs','/employment','/join-our-team'];
  for(const path of paths){
    let url='';
    try{url=new URL(path,base).toString()}catch{continue}
    const page=await fetchText(url,5000);
    if(!page)continue;
    const text=htmlText(page.text);
    const hasCareerSignal=/(career|employment|job opportunit|open position|join our team|now hiring|apply (?:now|today))/i.test(text);
    if(!hasCareerSignal)continue;
    return page;
  }
  return null;
}
function providerJobLinks(base:string,html:string,provider:string){
  const out:{url:string;title:string}[]=[];
  const seen=new Set<string>();
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for(const m of html.matchAll(re)){
    const title=stripHtml(m[2],260);
    const href=decodeHtml(m[1]);
    const roleHit=!!roleClassification(title,'');
    const jobLike=/(\/jobs?\/|jobid=|job_id=|jobdetail|job-details|posting|position)/i.test(href);
    if(!roleHit&&!(provider!=='generic'&&jobLike))continue;
    try{
      const url=new URL(href,base).toString();
      if(!/^https?:/i.test(url)||seen.has(url)||url===base)continue;
      seen.add(url);
      out.push({url,title});
    }catch{}
    if(out.length>=18)break;
  }
  return out;
}
async function crawlHtmlBoard(listingUrl:string,provider:string,org:Row,originUrl:string){
  const page=await fetchText(listingUrl,8500);
  if(!page)return {jobs:[] as DiscoveredJob[],linksSeen:0,fetchFailed:true};
  const jobs:DiscoveredJob[]=[];
  jobs.push(...parseJsonLdJobs(page.text,page.url).map(j=>({...j,sourceProvider:provider==='generic'?j.sourceProvider:provider,sourceListingUrl:originUrl})));
  const links=providerJobLinks(page.url,page.text,provider);
  for(const link of links.slice(0,14)){
    const detail=await fetchText(link.url,6500);
    if(!detail)continue;
    const structured=parseJsonLdJobs(detail.text,detail.url);
    if(structured.length){
      jobs.push(...structured.map(j=>({...j,sourceProvider:provider==='generic'?j.sourceProvider:provider,sourceListingUrl:originUrl})));
      continue;
    }
    const generic=textJobFromPage(detail.url,link.title,detail.text,org);
    if(generic)jobs.push({...generic,sourceProvider:provider==='generic'?'generic_html':provider,sourceListingUrl:originUrl});
  }
  return {jobs,linksSeen:links.length,fetchFailed:false};
}
async function jobsFromAtsDestination(dest:{url:string;provider:string},org:Row,originUrl:string){
  const ats=atsInfo(dest.url);
  let jobs:DiscoveredJob[]=[];
  if(dest.provider==='greenhouse'&&ats?.account)jobs=await greenhouseJobs(ats.account,dest.url);
  else if(dest.provider==='lever'&&ats?.account)jobs=await leverJobs(ats.account,dest.url);
  else if(dest.provider==='ashby'&&ats?.account)jobs=await ashbyJobs(ats.account,dest.url);
  else if(dest.provider==='workday')jobs=await workdayJobs(dest.url);
  else return crawlHtmlBoard(dest.url,dest.provider,org,originUrl);
  return {jobs:jobs.map(j=>({...j,sourceListingUrl:originUrl})),linksSeen:0,fetchFailed:false};
}
function headingJobsFromCareersPage(pageUrl:string,html:string,org:Row){
  const pageText=htmlText(html).slice(0,15000);
  if(!/(apply|application|now hiring|we are hiring|join our team|employment opportunit|open position)/i.test(pageText))return [] as DiscoveredJob[];
  const headings:string[]=[];
  const re=/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  for(const m of html.matchAll(re)){
    const heading=stripHtml(m[1],220);
    const cls=roleClassification(heading,'');
    if(cls&&cls.confidence>=90&&!headings.includes(heading))headings.push(heading);
    if(headings.length>=8)break;
  }
  const jobs:DiscoveredJob[]=[];
  for(const heading of headings){
    const cls=roleClassification(heading,pageText);
    if(!cls)continue;
    const zip=pageText.match(/\b(20[6-9]\d{2}|21\d{3})\b/)?.[1]||clean(org.zip,20);
    const state=/\bMaryland\b/i.test(pageText)||/\bMD\b/.test(pageText)||mdZip(zip)?'MD':normalizeState(org.state);
    if(state!=='MD')continue;
    jobs.push({
      sourceProvider:'generic_html',
      sourceJobId:'',
      sourceUrl:pageUrl,
      sourceListingUrl:pageUrl,
      title:heading,
      role:cls.role,
      roles:cls.roles,
      normalizedTitle:normalizeTitle(heading).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),
      city:clean(org.city,120),
      state:'MD',
      zip,
      employmentType:normalizeEmploymentType('',heading,pageText),
      payMin:null,
      payMax:null,
      descriptionText:pageText.slice(0,8000),
      classifierReason:cls.reason+' + explicit hiring/application signal on agency careers page',
      confidence:94,
      datePosted:'',
      validThrough:''
    });
  }
  return jobs;
}

async function greenhouseJobs(account:string,listingUrl:string){
  const data=await fetchJson('https://boards-api.greenhouse.io/v1/boards/'+encodeURIComponent(account)+'/jobs?content=true',8000) as any;
  if(!Array.isArray(data?.jobs))return [] as DiscoveredJob[];
  return data.jobs.map((job:any)=>{
    const title=clean(job.title,220),description=stripHtml(job.content,8000),cls=roleClassification(title,description);
    if(!cls)return null;
    const loc=locationStringParts(clean(job.location?.name,300));
    return {sourceProvider:'greenhouse',sourceJobId:clean(job.id,120),sourceUrl:clean(job.absolute_url,1000),sourceListingUrl:listingUrl,title,role:cls.role,
      city:loc.city,state:loc.state,zip:loc.zip,employmentType:'',payMin:null,payMax:null,descriptionText:description,
      classifierReason:cls.reason,confidence:cls.confidence,datePosted:clean(job.updated_at,80),validThrough:''} as DiscoveredJob;
  }).filter(Boolean) as DiscoveredJob[];
}
async function leverJobs(account:string,listingUrl:string){
  const data=await fetchJson('https://api.lever.co/v0/postings/'+encodeURIComponent(account)+'?mode=json',8000) as any;
  if(!Array.isArray(data))return [] as DiscoveredJob[];
  return data.map((job:any)=>{
    const title=clean(job.text,220),description=stripHtml([job.descriptionPlain,job.description,job.additional].filter(Boolean).join(' '),8000),cls=roleClassification(title,description);
    if(!cls)return null;
    const loc=locationStringParts(clean(job.categories?.location,300));
    return {sourceProvider:'lever',sourceJobId:clean(job.id,120),sourceUrl:clean(job.hostedUrl||job.applyUrl,1000),sourceListingUrl:listingUrl,title,role:cls.role,
      city:loc.city,state:loc.state,zip:loc.zip,employmentType:clean(job.categories?.commitment,120),payMin:null,payMax:null,descriptionText:description,
      classifierReason:cls.reason,confidence:cls.confidence,datePosted:'',validThrough:''} as DiscoveredJob;
  }).filter(Boolean) as DiscoveredJob[];
}
async function ashbyJobs(account:string,listingUrl:string){
  const data=await fetchJson('https://api.ashbyhq.com/posting-api/job-board/'+encodeURIComponent(account),8000) as any;
  const rows=Array.isArray(data?.jobs)?data.jobs:[];
  return rows.map((job:any)=>{
    const title=clean(job.title,220),description=stripHtml(job.descriptionHtml||job.descriptionPlain||'',8000),cls=roleClassification(title,description);
    if(!cls)return null;
    const loc=locationStringParts(clean(job.location,300));
    return {sourceProvider:'ashby',sourceJobId:clean(job.id||job.jobId,120),sourceUrl:clean(job.jobUrl||job.applyUrl,1000),sourceListingUrl:listingUrl,title,role:cls.role,
      city:loc.city,state:loc.state,zip:loc.zip,employmentType:clean(job.employmentType,120),payMin:null,payMax:null,descriptionText:description,
      classifierReason:cls.reason,confidence:cls.confidence,datePosted:clean(job.publishedAt,80),validThrough:''} as DiscoveredJob;
  }).filter(Boolean) as DiscoveredJob[];
}
function workdayEndpoint(listingUrl:string){
  try{
    const u=new URL(listingUrl);
    const host=u.hostname;
    const parts=u.pathname.split('/').filter(Boolean);
    const tenant=host.split('.')[0];
    const site=parts.find(part=>!/^([a-z]{2}-[A-Z]{2}|[a-z]{2})$/.test(part))||'';
    if(!site||!tenant)return null;
    return {url:'https://'+host+'/wday/cxs/'+encodeURIComponent(tenant)+'/'+encodeURIComponent(site)+'/jobs',host};
  }catch{return null}
}
async function workdayJobs(listingUrl:string){
  const endpoint=workdayEndpoint(listingUrl);
  if(!endpoint)return [] as DiscoveredJob[];
  const data=await fetchJsonPost(endpoint.url,{appliedFacets:{},limit:100,offset:0,searchText:''},9000) as any;
  if(!Array.isArray(data?.jobPostings))return [] as DiscoveredJob[];
  return data.jobPostings.map((job:any)=>{
    const title=clean(job.title,220);
    const description=stripHtml(Array.isArray(job.bulletFields)?job.bulletFields.join(' '):'',4000);
    const cls=roleClassification(title,description);
    if(!cls)return null;
    const loc=locationStringParts(clean(job.locationsText,300));
    const externalPath=clean(job.externalPath,1000);
    const sourceUrl=externalPath?new URL(externalPath,'https://'+endpoint.host).toString():listingUrl;
    return {
      sourceProvider:'workday',
      sourceJobId:clean(job.jobReqId||job.id||externalPath,160),
      sourceUrl,sourceListingUrl:listingUrl,title,role:cls.role,
      city:loc.city,state:loc.state,zip:loc.zip,employmentType:'',
      payMin:null,payMax:null,descriptionText:description,classifierReason:cls.reason,
      confidence:cls.confidence,datePosted:clean(job.postedOn,80),validThrough:''
    } as DiscoveredJob;
  }).filter(Boolean) as DiscoveredJob[];
}

function jobLinks(base:string,html:string){
  const out:{url:string;title:string}[]=[];
  const seen=new Set<string>();
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for(const m of html.matchAll(re)){
    const title=stripHtml(m[2],240);
    if(!roleClassification(title,''))continue;
    try{
      const url=new URL(decodeHtml(m[1]),base).toString();
      if(!/^https?:/i.test(url)||seen.has(url))continue;
      seen.add(url);out.push({url,title});
    }catch{}
    if(out.length>=8)break;
  }
  return out;
}
function textJobFromPage(pageUrl:string,titleHint:string,html:string,org:Row){
  const text=htmlText(html).slice(0,12000);
  const h1=stripHtml(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'',220);
  const title=h1||titleHint;
  const cls=roleClassification(title,text);
  if(!cls||cls.confidence<90)return null;
  const zip=text.match(/\b(20[6-9]\d{2}|21\d{3})\b/)?.[1]||'';
  const orgCity=clean(org.city,120);
  const city=orgCity&&new RegExp('\\b'+escapeRegex(orgCity)+'\\b','i').test(text)?orgCity:'';
  const state=/\bMaryland\b/i.test(text)||/\bMD\b/.test(text)||mdZip(zip)?'MD':'';
  if(state!=='MD'&&normalizeState(org.state)!=='MD')return null;
  const locationPenalty=state==='MD'?0:-18;
  return {sourceProvider:'generic_html',sourceJobId:'',sourceUrl:pageUrl,sourceListingUrl:pageUrl,title,role:cls.role,city,state:state||'MD',zip,
    employmentType:/\bfull[- ]?time\b/i.test(text)?'Full-time':/\bpart[- ]?time\b/i.test(text)?'Part-time':'',
    payMin:null,payMax:null,descriptionText:text.slice(0,8000),classifierReason:cls.reason+(state==='MD'?' + Maryland location':' + Maryland agency fallback'),
    confidence:Math.max(0,cls.confidence+locationPenalty),datePosted:'',validThrough:''} as DiscoveredJob;
}
function publicationDecision(job:DiscoveredJob){
  const explicit=normalizeState(job.state)==='MD'||mdZip(job.zip);
  const notExpired=!job.validThrough||!Number.isFinite(Date.parse(job.validThrough))||Date.parse(job.validThrough)>=Date.now()-86400000;
  if(!job.sourceUrl||!job.title)return {publish:false,reason:'missing_source_or_title'};
  if(!notExpired)return {publish:false,reason:'expired'};
  if(job.confidence<88)return {publish:false,reason:'low_confidence'};
  if(!TARGET_ROLES.has(job.role))return {publish:false,reason:'non_target_role'};
  if(!explicit)return {publish:false,reason:'missing_maryland_evidence'};
  return {publish:true,reason:'explicit_maryland_location'};
}
async function dedupeKeyForJob(orgId:string,job:DiscoveredJob){
  const sourceIdentity=job.sourceJobId||(job.sourceUrl+'|'+normalizeTitle(job.title));
  const identity=[orgId,job.sourceProvider,sourceIdentity,job.city,job.state].join('|').toLowerCase();
  return sha256Hex(identity);
}
async function saveDiscoveredJob(env:FeatureEnv,org:Row,input:DiscoveredJob){
  if(!env.DB)return false;
  const title=normalizeTitle(input.title);
  const cls=roleClassification(title,input.descriptionText);
  if(!cls)return false;
  let city=normalizeCity(input.city);
  let state=normalizeState(input.state);
  let zip=clean(input.zip,20).match(/\b\d{5}\b/)?.[0]||'';
  let locationSource=state||zip?'source':'';
  if(!state&&mdZip(zip)){state='MD';locationSource='zip'}
  if(!state&&normalizeState(org.state)==='MD'&&sameOrgDomain(input.sourceListingUrl,org)){
    const explicitOther=/\b(VA|Virginia|DC|District of Columbia|PA|Pennsylvania|DE|Delaware|WV|West Virginia|NJ|New Jersey|NY|New York)\b/i.test(input.descriptionText);
    if(!explicitOther){
      state='MD';
      city=city||normalizeCity(org.city);
      zip=zip||clean(org.zip,20);
      locationSource='maryland_agency_careers_page';
    }
  }
  const employmentType=normalizeEmploymentType(input.employmentType,title,input.descriptionText);
  const textPay=payFromText(input.descriptionText);
  const payMin=input.payMin??textPay.min;
  const payMax=input.payMax??textPay.max;
  const payUnit=input.payPeriod||textPay.period;
  const roles=cls.roles||[cls.role];
  const normalizedTitle=title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const fingerprint=await sha256Hex([clean(org.id,100),normalizedTitle,city.toLowerCase(),state,zip].join('|'));
  const normalizedJob:DiscoveredJob={...input,title,role:cls.role,city,state,zip,employmentType,payMin,payMax,payPeriod:payUnit,classifierReason:cls.reason,roles,normalizedTitle};
  const key=await dedupeKeyForJob(clean(org.id,100),normalizedJob);
  const decision=publicationDecision(normalizedJob);
  const publish=decision.publish?1:0;
  const id='job_'+key.slice(0,28);
  const sql='INSERT INTO caregiver_jobs (id,agency_organization_id,dedupe_key,source_provider,source_job_id,source_url,source_listing_url,title,normalized_title,role,roles_json,employer_name,city,state,zip,location_source,employment_type,pay_min,pay_max,pay_period,description_text,classifier_reason,confidence,date_posted,valid_through,canonical_fingerprint,status,is_published,publication_reason,last_seen_at,last_checked_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,"current",?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(dedupe_key) DO UPDATE SET source_url=excluded.source_url,source_listing_url=excluded.source_listing_url,title=excluded.title,normalized_title=excluded.normalized_title,role=excluded.role,roles_json=excluded.roles_json,employer_name=excluded.employer_name,city=excluded.city,state=excluded.state,zip=excluded.zip,location_source=excluded.location_source,employment_type=excluded.employment_type,pay_min=excluded.pay_min,pay_max=excluded.pay_max,pay_period=excluded.pay_period,description_text=excluded.description_text,classifier_reason=excluded.classifier_reason,confidence=excluded.confidence,date_posted=excluded.date_posted,valid_through=excluded.valid_through,canonical_fingerprint=excluded.canonical_fingerprint,status="current",is_published=excluded.is_published,publication_reason=excluded.publication_reason,last_seen_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP';
  await env.DB.prepare(sql).bind(
    id,org.id,key,normalizedJob.sourceProvider,normalizedJob.sourceJobId||null,normalizedJob.sourceUrl,normalizedJob.sourceListingUrl,
    title,normalizedTitle,cls.role,JSON.stringify(roles),clean(org.canonical_name,220),city,state,zip,locationSource,employmentType,
    payMin,payMax,payUnit,input.descriptionText,cls.reason,input.confidence,input.datePosted||null,input.validThrough||null,fingerprint,publish,decision.reason
  ).run();
  return publish===1;
}
function sourceQuality(value:unknown){
  const p=clean(value,50);
  if(['workday','greenhouse','lever','ashby'].includes(p))return 5;
  if(['icims','paylocity','bamboohr','paycom','ukg','jazzhr','workable'].includes(p))return 4;
  if(p==='jsonld')return 3;
  return 2;
}
async function reconcileOrgDuplicates(env:FeatureEnv,orgId:string){
  if(!env.DB)return;
  const rows=await env.DB.prepare('SELECT id,canonical_fingerprint,source_provider,confidence,last_seen_at FROM caregiver_jobs WHERE agency_organization_id=? AND status="current" AND canonical_fingerprint IS NOT NULL').bind(orgId).all<Row>();
  const groups=new Map<string,Row[]>();
  for(const row of rows.results||[]){
    const key=clean(row.canonical_fingerprint,100);
    if(!key)continue;
    const group=groups.get(key)||[];
    group.push(row);
    groups.set(key,group);
  }
  for(const group of groups.values()){
    if(group.length<2)continue;
    group.sort((a,b)=>sourceQuality(b.source_provider)-sourceQuality(a.source_provider)||asNum(b.confidence)-asNum(a.confidence)||clean(b.last_seen_at,40).localeCompare(clean(a.last_seen_at,40)));
    for(const loser of group.slice(1)){
      await env.DB.prepare('UPDATE caregiver_jobs SET status="duplicate",is_published=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(loser.id).run();
    }
  }
}
async function discoverJobsForOrg(env:FeatureEnv,org:Row){
  if(!env.DB)return {seen:0,published:0,rejected:0,jobLinksSeen:0,provider:'none',status:'no_db'};
  let listing=clean(org.primary_careers_url,1000);
  if(!listing||badCareerUrl(listing))listing=clean(org.primary_website,1000);
  if(!listing){
    const domain=clean(org.primary_domain,240).replace(/^https?:\/\//,'').replace(/\/$/,'');
    if(domain&&!/@/.test(domain))listing='https://'+domain+'/';
  }
  if(!listing)return {seen:0,published:0,rejected:0,jobLinksSeen:0,provider:'none',status:'no_valid_source'};

  const direct=atsInfo(listing);
  let jobs:DiscoveredJob[]=[];
  let jobLinksSeen=0;
  const providers=new Set<string>();
  if(direct?.provider)providers.add(direct.provider);

  if(direct?.provider==='greenhouse'&&direct.account)jobs=await greenhouseJobs(direct.account,listing);
  else if(direct?.provider==='lever'&&direct.account)jobs=await leverJobs(direct.account,listing);
  else if(direct?.provider==='ashby'&&direct.account)jobs=await ashbyJobs(direct.account,listing);
  else if(direct?.provider==='workday')jobs=await workdayJobs(listing);
  else if(direct){
    const crawled=await crawlHtmlBoard(listing,direct.provider,org,listing);
    jobs.push(...crawled.jobs);
    jobLinksSeen+=crawled.linksSeen;
    if(crawled.fetchFailed)return {seen:0,published:0,rejected:0,jobLinksSeen:0,provider:direct.provider,status:'fetch_failed'};
  }else{
    let page=await fetchAgencyRoot(org,listing);
    if(!page){
      const fallbacks:string[]=[];
      const add=(url:string)=>{if(url&&!fallbacks.includes(url))fallbacks.push(url)};
      add(listing);
      const domain=clean(org.primary_domain,240).replace(/^https?:\/\//,'').replace(/\/$/,'').replace(/^www\./,'');
      if(domain&&!/@/.test(domain)){
        add('https://'+domain+'/');
        add('https://www.'+domain+'/');
        add('http://'+domain+'/');
        add('http://www.'+domain+'/');
      }
      for(const base of fallbacks){
        const probed=await probeCommonCareerPage(base);
        if(!probed)continue;
        page=probed;
        if(!clean(org.primary_careers_url,1000)){
          await env.DB.prepare('UPDATE agency_organizations SET primary_careers_url=?,careers_source="job_discovery",updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(probed.url,org.id).run();
          org.primary_careers_url=probed.url;
        }
        break;
      }
    }
    if(!page)return {seen:0,published:0,rejected:0,jobLinksSeen:0,provider:'generic',status:'fetch_failed'};
    if(!clean(org.primary_website,1000)&&sameOrgDomain(page.url,{...org,primary_website:page.url})){
      await env.DB.prepare('UPDATE agency_organizations SET primary_website=COALESCE(NULLIF(primary_website,""),?),website_source=CASE WHEN website_source IS NULL OR website_source="" THEN "job_discovery" ELSE website_source END,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(page.url,org.id).run();
      org.primary_website=page.url;
    }
    jobs.push(...parseJsonLdJobs(page.text,page.url));
    if(jobs.length)providers.add('jsonld');
    jobs.push(...headingJobsFromCareersPage(page.url,page.text,org));

    const links=providerJobLinks(page.url,page.text,'generic');
    jobLinksSeen+=links.length;
    for(const link of links.slice(0,10)){
      const detail=await fetchText(link.url,6500);
      if(!detail)continue;
      const structured=parseJsonLdJobs(detail.text,detail.url);
      if(structured.length)jobs.push(...structured);
      else{
        const generic=textJobFromPage(detail.url,link.title,detail.text,org);
        if(generic)jobs.push(generic);
      }
    }

    for(const dest of downstreamAtsLinks(page.url,page.text).slice(0,6)){
      providers.add(dest.provider);
      const result=await jobsFromAtsDestination(dest,org,page.url);
      jobs.push(...result.jobs);
      jobLinksSeen+=result.linksSeen;
    }

    if(jobs.length===0){
      for(const careersUrl of careerPageLinks(page.url,page.text).slice(0,3)){
        if(!clean(org.primary_careers_url,1000)){
          await env.DB.prepare('UPDATE agency_organizations SET primary_careers_url=?,careers_source="job_discovery",updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(careersUrl,org.id).run();
          org.primary_careers_url=careersUrl;
        }
        const nestedAts=atsInfo(careersUrl);
        if(nestedAts){
          providers.add(nestedAts.provider);
          const result=await jobsFromAtsDestination({url:careersUrl,provider:nestedAts.provider},org,careersUrl);
          jobs.push(...result.jobs);
          jobLinksSeen+=result.linksSeen;
          continue;
        }
        const careersPage=await fetchText(careersUrl,7500);
        if(!careersPage)continue;
        jobs.push(...parseJsonLdJobs(careersPage.text,careersPage.url));
        jobs.push(...headingJobsFromCareersPage(careersPage.url,careersPage.text,org));
        const careerLinks=providerJobLinks(careersPage.url,careersPage.text,'generic');
        jobLinksSeen+=careerLinks.length;
        for(const link of careerLinks.slice(0,10)){
          const detail=await fetchText(link.url,6500);
          if(!detail)continue;
          const structured=parseJsonLdJobs(detail.text,detail.url);
          if(structured.length)jobs.push(...structured.map(j=>({...j,sourceListingUrl:careersPage.url})));
          else{
            const generic=textJobFromPage(detail.url,link.title,detail.text,org);
            if(generic)jobs.push({...generic,sourceListingUrl:careersPage.url});
          }
        }
        for(const dest of downstreamAtsLinks(careersPage.url,careersPage.text).slice(0,6)){
          providers.add(dest.provider);
          const result=await jobsFromAtsDestination(dest,org,careersPage.url);
          jobs.push(...result.jobs);
          jobLinksSeen+=result.linksSeen;
        }
      }
    }

    if(jobs.length===0){
      const probed=await probeCommonCareerPage(page.url);
      if(probed){
        if(!clean(org.primary_careers_url,1000)){
          await env.DB.prepare('UPDATE agency_organizations SET primary_careers_url=?,careers_source="job_discovery",updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(probed.url,org.id).run();
          org.primary_careers_url=probed.url;
        }
        jobs.push(...parseJsonLdJobs(probed.text,probed.url));
        jobs.push(...headingJobsFromCareersPage(probed.url,probed.text,org));
        const probedLinks=providerJobLinks(probed.url,probed.text,'generic');
        jobLinksSeen+=probedLinks.length;
        for(const link of probedLinks.slice(0,10)){
          const detail=await fetchText(link.url,6500);
          if(!detail)continue;
          const structured=parseJsonLdJobs(detail.text,detail.url);
          if(structured.length)jobs.push(...structured.map(j=>({...j,sourceListingUrl:probed.url})));
          else{
            const generic=textJobFromPage(detail.url,link.title,detail.text,org);
            if(generic)jobs.push({...generic,sourceListingUrl:probed.url});
          }
        }
        for(const dest of downstreamAtsLinks(probed.url,probed.text).slice(0,6)){
          providers.add(dest.provider);
          const result=await jobsFromAtsDestination(dest,org,probed.url);
          jobs.push(...result.jobs);
          jobLinksSeen+=result.linksSeen;
        }
      }
    }
  }

  const unique=new Map<string,DiscoveredJob>();
  for(const job of jobs){
    const key=(job.sourceJobId||job.sourceUrl||normalizeTitle(job.title)+'|'+job.city).toLowerCase();
    const prior=unique.get(key);
    if(!prior||job.confidence>prior.confidence)unique.set(key,job);
  }
  let published=0;
  for(const job of unique.values())if(await saveDiscoveredJob(env,org,job))published++;
  await reconcileOrgDuplicates(env,clean(org.id,100));
  await env.DB.prepare('UPDATE caregiver_jobs SET status="stale",is_published=0,updated_at=CURRENT_TIMESTAMP WHERE agency_organization_id=? AND status="current" AND datetime(last_seen_at)<datetime("now","-7 days")').bind(org.id).run();

  const rejected=Math.max(0,unique.size-published);
  const provider=Array.from(providers).sort().join('+')||'generic';
  const status=published>0?'published':unique.size>0?'candidates_rejected':jobLinksSeen>0?'job_links_no_relevant_roles':'no_job_board_found';
  return {seen:unique.size,published,rejected,jobLinksSeen,provider,status};
}
function mentionsOtherStates(text:string){
  return /\b(VA|Virginia|DC|District of Columbia|PA|Pennsylvania|DE|Delaware|WV|West Virginia|NJ|New Jersey|NY|New York)\b/i.test(text);
}
function exactToken(text:string,value:string){
  if(!value)return false;
  return new RegExp('\\b'+escapeRegex(value)+'\\b','i').test(text);
}
export async function recoverRejectedJobsBatch(env:FeatureEnv,limit=120){
  if(!env.DB)return {reviewed:0,recovered:0};
  const sql="SELECT j.id,j.title,j.role,j.roles_json,j.city,j.state,j.zip,j.source_url,j.source_listing_url,j.description_text,j.confidence,j.valid_through,j.publication_reason,ao.id AS org_id,ao.city AS org_city,ao.state AS org_state,ao.zip AS org_zip,ao.primary_website,ao.primary_domain FROM caregiver_jobs j JOIN agency_organizations ao ON ao.id=j.agency_organization_id WHERE j.status='current' AND j.is_published=0 AND j.confidence>=88 AND (j.publication_reason IS NULL OR j.publication_reason='missing_maryland_evidence') ORDER BY j.updated_at DESC LIMIT ?";
  const rows=await env.DB.prepare(sql).bind(limit).all<Row>();
  let recovered=0;
  for(const row of rows.results||[]){
    const title=normalizeTitle(row.title);
    const description=decodeHtml(clean(row.description_text,8000));
    const cls=roleClassification(title,description);
    if(!cls||!TARGET_ROLES.has(cls.role))continue;
    const validThrough=clean(row.valid_through,80);
    if(validThrough&&Number.isFinite(Date.parse(validThrough))&&Date.parse(validThrough)<Date.now()-86400000)continue;
    const currentState=normalizeState(row.state);
    const currentZip=clean(row.zip,20).match(/\b\d{5}\b/)?.[0]||'';
    const currentCity=normalizeCity(row.city);
    const orgCity=normalizeCity(row.org_city);
    const orgZip=clean(row.org_zip,20).match(/\b\d{5}\b/)?.[0]||'';
    const orgState=normalizeState(row.org_state);
    if(orgState!=='MD'&&!mdZip(orgZip))continue;
    const evidence=[title,description,clean(row.source_url,1000),clean(row.source_listing_url,1000)].join(' ');
    let reason='';
    let state=currentState;
    let city=currentCity;
    let zip=currentZip;
    if(currentState==='MD'||mdZip(currentZip)){
      reason='recovered_existing_maryland_location';
      state='MD';
    }else if(orgZip&&exactToken(evidence,orgZip)){
      reason='recovered_exact_agency_zip';
      state='MD';zip=zip||orgZip;city=city||orgCity;
    }else if(orgCity&&exactToken(evidence,orgCity)){
      reason='recovered_exact_agency_city';
      state='MD';city=city||orgCity;zip=zip||orgZip;
    }else{
      const explicitMaryland=/\bMaryland\b|\bMD\b/i.test(evidence);
      if(explicitMaryland&&!mentionsOtherStates(evidence)){
        reason='recovered_explicit_maryland_text';
        state='MD';
      }
    }
    if(!reason)continue;
    const update="UPDATE caregiver_jobs SET state=?,city=?,zip=?,role=?,roles_json=?,is_published=1,publication_reason=?,location_source=CASE WHEN location_source IS NULL OR location_source='' THEN ? ELSE location_source END,updated_at=CURRENT_TIMESTAMP WHERE id=?";
    await env.DB.prepare(update).bind(state,city,zip,cls.role,JSON.stringify(cls.roles||[cls.role]),reason,reason,row.id).run();
    recovered++;
  }
  return {reviewed:(rows.results||[]).length,recovered};
}
export async function normalizeExistingJobsBatch(env:FeatureEnv,limit=100){
  if(!env.DB)return {processed:0};
  const rows=await env.DB.prepare('SELECT id,agency_organization_id,title,role,roles_json,city,state,zip,employment_type,pay_min,pay_max,pay_period,description_text FROM caregiver_jobs WHERE (normalized_title IS NULL OR roles_json IS NULL) AND status IN ("current","duplicate") ORDER BY updated_at DESC LIMIT ?').bind(limit).all<Row>();
  const orgs=new Set<string>();
  for(const row of rows.results||[]){
    const title=normalizeTitle(row.title);
    const description=clean(row.description_text,8000);
    const cls=roleClassification(title,description);
    if(!cls)continue;
    const employmentType=normalizeEmploymentType(clean(row.employment_type,200),title,description);
    const textPay=payFromText(description);
    const payMin=row.pay_min==null?textPay.min:Number(row.pay_min);
    const payMax=row.pay_max==null?textPay.max:Number(row.pay_max);
    const payUnit=clean(row.pay_period,30)||textPay.period;
    const normalizedTitle=title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const fingerprint=await sha256Hex([
      clean(row.agency_organization_id,100),normalizedTitle,normalizeCity(row.city).toLowerCase(),normalizeState(row.state),clean(row.zip,20)
    ].join('|'));
    await env.DB.prepare('UPDATE caregiver_jobs SET title=?,normalized_title=?,role=?,roles_json=?,employment_type=?,pay_min=?,pay_max=?,pay_period=?,canonical_fingerprint=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .bind(title,normalizedTitle,cls.role,JSON.stringify(cls.roles||[cls.role]),employmentType,payMin,payMax,payUnit,fingerprint,row.id).run();
    orgs.add(clean(row.agency_organization_id,100));
  }
  for(const orgId of orgs)if(orgId)await reconcileOrgDuplicates(env,orgId);
  return {processed:(rows.results||[]).length};
}

export async function discoverAgencyJobsBatch(env:FeatureEnv,limit=12){
  if(!env.DB)return {processed:0,seen:0,published:0,rejected:0};
  const rows=await env.DB.prepare('SELECT ao.id,ao.canonical_name,ao.primary_domain,ao.primary_website,ao.primary_careers_url,ao.city,ao.state,ao.zip,ao.current_hiring_signal,scan.last_scanned_at FROM agency_organizations ao LEFT JOIN agency_job_scan_state scan ON scan.organization_id=ao.id WHERE ao.is_active=1 AND ((ao.primary_careers_url IS NOT NULL AND ao.primary_careers_url!="") OR (ao.primary_website IS NOT NULL AND ao.primary_website!="") OR (ao.primary_domain IS NOT NULL AND ao.primary_domain!="")) AND (scan.last_scanned_at IS NULL OR datetime(scan.last_scanned_at)<datetime("now","-24 hours")) ORDER BY CASE WHEN lower(COALESCE(ao.primary_careers_url,"")) LIKE "%workday%" OR lower(COALESCE(ao.primary_careers_url,"")) LIKE "%icims%" OR lower(COALESCE(ao.primary_careers_url,"")) LIKE "%paylocity%" OR lower(COALESCE(ao.primary_careers_url,"")) LIKE "%greenhouse%" OR lower(COALESCE(ao.primary_careers_url,"")) LIKE "%lever.co%" OR lower(COALESCE(ao.primary_careers_url,"")) LIKE "%ashby%" THEN 0 ELSE 1 END,CASE WHEN ao.primary_careers_url IS NOT NULL AND ao.primary_careers_url!="" THEN 0 ELSE 1 END,CASE WHEN ao.current_hiring_signal="hiring_detected" THEN 0 ELSE 1 END,CASE WHEN scan.last_scanned_at IS NULL THEN 0 ELSE 1 END,COALESCE(scan.last_scanned_at,"") ASC,ao.caregiver_relevance_score DESC LIMIT ?').bind(limit).all<Row>();
  let seen=0,published=0,rejected=0;
  for(const org of rows.results||[]){
    let result:{seen:number;published:number;rejected:number;jobLinksSeen:number;provider:string;status:string};
    try{result=await discoverJobsForOrg(env,org)}
    catch(error){result={seen:0,published:0,rejected:0,jobLinksSeen:0,provider:'error',status:error instanceof Error?error.message.slice(0,200):'scan_failed'}}
    seen+=result.seen;
    published+=result.published;
    rejected+=result.rejected;
    const sql='INSERT INTO agency_job_scan_state (organization_id,source_provider,source_listing_url,last_status,last_error,jobs_seen,jobs_published,job_links_seen,jobs_rejected,last_scanned_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(organization_id) DO UPDATE SET source_provider=excluded.source_provider,source_listing_url=excluded.source_listing_url,last_status=excluded.last_status,last_error=excluded.last_error,jobs_seen=excluded.jobs_seen,jobs_published=excluded.jobs_published,job_links_seen=excluded.job_links_seen,jobs_rejected=excluded.jobs_rejected,last_scanned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP';
    await env.DB.prepare(sql).bind(
      org.id,result.provider,clean(org.primary_careers_url,1000),result.status,
      result.status==='fetch_failed'||result.provider==='error'?result.status:null,
      result.seen,result.published,result.jobLinksSeen,result.rejected
    ).run();
  }
  return {processed:(rows.results||[]).length,seen,published,rejected};
}

export async function getPublicCaregiverJobs(url:URL,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const role=clean(url.searchParams.get('role'),80);
  const city=clean(url.searchParams.get('city'),120);
  const limit=Math.max(1,Math.min(100,asNum(url.searchParams.get('limit'))||50));
  let sql='SELECT id,title,role,roles_json,employer_name,city,state,zip,employment_type,pay_min,pay_max,pay_period,source_url,date_posted,first_seen_at,last_seen_at FROM caregiver_jobs WHERE is_published=1 AND status="current" AND state="MD"';
  const args:unknown[]=[];
  if(role){
    sql+=' AND (lower(role)=lower(?) OR lower(COALESCE(roles_json,"")) LIKE lower(?))';
    args.push(role,'%"'+role+'"%');
  }
  if(city){sql+=' AND lower(city)=lower(?)';args.push(city)}
  sql+=' ORDER BY CASE WHEN date_posted IS NULL OR date_posted="" THEN 1 ELSE 0 END,date_posted DESC,last_seen_at DESC LIMIT ?';
  args.push(limit);
  const rows=await env.DB.prepare(sql).bind(...args).all<Row>();
  return json({ok:true,jobs:(rows.results||[]).map(r=>{
    let roles:string[]=[];
    try{roles=JSON.parse(clean(r.roles_json,1000)||'[]')}catch{roles=[clean(r.role,80)].filter(Boolean)}
    return {
      id:r.id,title:normalizeTitle(r.title),role:r.role,roles,employerName:r.employer_name,city:r.city,state:r.state,zip:r.zip,
      employmentType:r.employment_type,payMin:r.pay_min,payMax:r.pay_max,payPeriod:r.pay_period,sourceUrl:r.source_url,
      datePosted:r.date_posted,firstSeenAt:r.first_seen_at,lastSeenAt:r.last_seen_at
    };
  })});
}
export async function getPublicCaregiverJob(id:string,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const row=await env.DB.prepare('SELECT id,title,role,roles_json,employer_name,city,state,zip,employment_type,pay_min,pay_max,pay_period,description_text,source_url,source_listing_url,date_posted,first_seen_at,last_seen_at,last_checked_at FROM caregiver_jobs WHERE id=? AND is_published=1 AND status="current" LIMIT 1').bind(id).first<Row>();
  if(!row)return json({ok:false,error:'Job not found'},{status:404});
  let roles:string[]=[];
  try{roles=JSON.parse(clean(row.roles_json,1000)||'[]')}catch{roles=[clean(row.role,80)].filter(Boolean)}
  return json({ok:true,job:{
    id:row.id,title:normalizeTitle(row.title),role:row.role,roles,employerName:row.employer_name,
    city:row.city,state:row.state,zip:row.zip,employmentType:row.employment_type,
    payMin:row.pay_min,payMax:row.pay_max,payPeriod:row.pay_period,description:decodeHtml(clean(row.description_text,8000)),
    sourceUrl:row.source_url,sourceListingUrl:row.source_listing_url,datePosted:row.date_posted,
    firstSeenAt:row.first_seen_at,lastSeenAt:row.last_seen_at,lastCheckedAt:row.last_checked_at
  }});
}
