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
function mdZip(zip:string){
  const n=Number(zip.slice(0,3));
  return /^\d{5}/.test(zip)&&n>=206&&n<=219;
}
function escapeRegex(value:string){
  return value.replace(/[\\^$.*+?()[\]{}|]/g,'\\function escapeRegex(value:string){
  return value.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&');
}
function roleClassification(title:string,description=''){
  const titleLower=title.toLowerCase();
  const all=(title+' '+description).toLowerCase();
  const titleRules:[string,RegExp,string][]=[
    ['GNA',/\b(gna|geriatric nursing assistant)\b/i,'GNA title'],
    ['CNA',/\b(cna(?:-i)?|certified nursing assistant|nursing assistant)\b/i,'CNA/nursing-assistant title'],
    ['HHA',/\b(hha|home health aide)\b/i,'HHA title'],
    ['PCA',/\b(pca|personal care aide|personal care assistant)\b/i,'PCA title'],
    ['DSP',/\b(dsp|direct support professional|direct care worker)\b/i,'DSP/direct-care title'],
    ['Caregiver',/\b(caregiver|care giver|companion(?: caregiver)?|home care aide|homecare aide|private duty caregiver)\b/i,'caregiver/companion title']
  ];
  for(const [role,re,reason] of titleRules)if(re.test(titleLower))return {role,confidence:96,reason};
  if(/\b(rn|registered nurse|lpn|licensed practical nurse|nurse practitioner|therapist|scheduler|coordinator|administrator|manager|director)\b/i.test(titleLower))return null;
  for(const [role,re] of titleRules)if(re.test(all))return {role,confidence:72,reason:'caregiver role appears only in job description'};
  return null;
}');
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
  ['DSP',/\b(dsp|direct support professional|direct care worker)\b/i],
  ['Caregiver',/\b(caregiver|care giver|companion(?: caregiver)?|home care aide|homecare aide|private duty caregiver)\b/i],
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
  if(descTargets.length)return {role:descTargets[0],roles:Array.from(new Set(descRoles)),confidence:72,reason:'caregiver role appears only in job description'};
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
function payFromText(text:string){
  const normalized=text.replace(/,/g,' ');
  const range=normalized.match(/\$(\d{1,3}(?:\.\d{1,2})?)\s*(?:-|–|—|to)\s*\$?(\d{1,3}(?:\.\d{1,2})?)\s*(?:\/|per\s+)?(hour|hr|year|yr|week|wk|day|month)\b/i);
  if(range)return {min:Number(range[1]),max:Number(range[2]),period:/hour|hr/i.test(range[3])?'hour':/year|yr/i.test(range[3])?'year':/week|wk/i.test(range[3])?'week':range[3].toLowerCase()};
  const single=normalized.match(/\$(\d{1,3}(?:\.\d{1,2})?)\s*(?:\/|per\s+)(hour|hr|year|yr|week|wk|day|month)\b/i);
  if(single)return {min:Number(single[1]),max:null,period:/hour|hr/i.test(single[2])?'hour':/year|yr/i.test(single[2])?'year':/week|wk/i.test(single[2])?'week':single[2].toLowerCase()};
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
  const unit=clean(value?.unitText??raw?.unitText??raw?.unitCode,80).toLowerCase();
  if(typeof raw==='number')min=max=raw;
  else if(raw&&typeof raw==='object'){
    const a=Number(raw.minValue??raw.value??0),b=Number(raw.maxValue??raw.value??0);
    if(Number.isFinite(a)&&a>0)min=a;
    if(Number.isFinite(b)&&b>0)max=b;
  }
  if(/hour|hourly|hr/.test(unit))period='hour';
  else if(/year|annual|yr/.test(unit))period='year';
  else if(/week|wk/.test(unit))period='week';
  else if(/day/.test(unit))period='day';
  else if(/month/.test(unit))period='month';
  return {min,max,period};
}
function locationParts(job:any){
  const loc=Array.isArray(job?.jobLocation)?job.jobLocation[0]:job?.jobLocation;
  const address=loc?.address||{};
  return {
    city:clean(address.addressLocality,120),
    state:normalizeState(address.addressRegion),
    zip:clean(address.postalCode,20)
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
      payMin:salary.min,payMax:salary.max,descriptionText:description,classifierReason:cls.reason,
      confidence:cls.confidence,datePosted:clean(job.datePosted,80),validThrough:clean(job.validThrough,80),
      ...(salary.period?{payPeriod:salary.period}:{}),
      ...(cls.roles?{roles:cls.roles}:{}),
      normalizedTitle:normalizeTitle(title).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
    } as DiscoveredJob & {payPeriod?:string;roles?:string[];normalizedTitle?:string};
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
  }catch{}
  return null;
}
function locationStringParts(value:string){
  const s=clean(value,300);
  const zip=s.match(/\b(20[6-9]\d{2}|21\d{3})\b/)?.[1]||'';
  const state=/\bMaryland\b/i.test(s)||/\bMD\b/.test(s)?'MD':'';
  const city=state?clean(s.split(',')[0],120):'';
  return {city,state,zip};
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
function isPublishableMarylandJob(job:DiscoveredJob,org:Row){
  const explicit=normalizeState(job.state)==='MD'||mdZip(job.zip)||/\bMaryland\b|\bMD\b/.test(job.descriptionText);
  const localFallback=normalizeState(org.state)==='MD'&&job.confidence>=90&&clean(org.city,120)!==''&&job.city===clean(org.city,120);
  const notExpired=!job.validThrough||!Number.isFinite(Date.parse(job.validThrough))||Date.parse(job.validThrough)>=Date.now()-86400000;
  return notExpired&&(explicit||localFallback)&&job.confidence>=88&&!!job.sourceUrl&&!!job.title;
}
async function dedupeKeyForJob(orgId:string,job:DiscoveredJob){
  const identity=[orgId,job.sourceProvider,job.sourceJobId||job.sourceUrl||job.title,job.city,job.state].join('|').toLowerCase();
  return sha256Hex(identity);
}
async function saveDiscoveredJob(env:FeatureEnv,org:Row,job:DiscoveredJob){
  if(!env.DB)return false;
  const key=await dedupeKeyForJob(clean(org.id,100),job);
  const publish=isPublishableMarylandJob(job,org)?1:0;
  const id='job_'+key.slice(0,28);
  await env.DB.prepare(`INSERT INTO caregiver_jobs
    (id,agency_organization_id,dedupe_key,source_provider,source_job_id,source_url,source_listing_url,title,role,employer_name,city,state,zip,employment_type,pay_min,pay_max,description_text,classifier_reason,confidence,date_posted,valid_through,status,is_published,last_seen_at,last_checked_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'current',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      source_url=excluded.source_url,source_listing_url=excluded.source_listing_url,title=excluded.title,role=excluded.role,employer_name=excluded.employer_name,
      city=excluded.city,state=excluded.state,zip=excluded.zip,employment_type=excluded.employment_type,pay_min=excluded.pay_min,pay_max=excluded.pay_max,
      description_text=excluded.description_text,classifier_reason=excluded.classifier_reason,confidence=excluded.confidence,date_posted=excluded.date_posted,
      valid_through=excluded.valid_through,status='current',is_published=excluded.is_published,last_seen_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
    .bind(id,org.id,key,job.sourceProvider,job.sourceJobId||null,job.sourceUrl,job.sourceListingUrl,job.title,job.role,clean(org.canonical_name,220),
      job.city,normalizeState(job.state),job.zip,job.employmentType,job.payMin,job.payMax,job.descriptionText,job.classifierReason,job.confidence,
      job.datePosted||null,job.validThrough||null,publish).run();
  return publish===1;
}
async function discoverJobsForOrg(env:FeatureEnv,org:Row){
  if(!env.DB)return {seen:0,published:0,provider:'none',status:'no_db'};
  const listing=clean(org.primary_careers_url,1000)||clean(org.primary_website,1000);
  if(!listing)return {seen:0,published:0,provider:'none',status:'no_careers_url'};
  const ats=atsInfo(listing);
  let jobs:DiscoveredJob[]=[];
  const provider=ats?.provider||'generic';
  if(ats?.provider==='greenhouse'&&ats.account)jobs=await greenhouseJobs(ats.account,listing);
  else if(ats?.provider==='lever'&&ats.account)jobs=await leverJobs(ats.account,listing);
  else if(ats?.provider==='ashby'&&ats.account)jobs=await ashbyJobs(ats.account,listing);
  else if(ats?.provider==='workday')jobs=await workdayJobs(listing);
  else{
    const page=await fetchText(listing,8000);
    if(!page)return {seen:0,published:0,provider,status:'fetch_failed'};
    jobs.push(...parseJsonLdJobs(page.text,page.url));
    for(const link of jobLinks(page.url,page.text).slice(0,6)){
      const detail=await fetchText(link.url,6500);
      if(!detail)continue;
      const structured=parseJsonLdJobs(detail.text,detail.url);
      if(structured.length)jobs.push(...structured);
      else{
        const generic=textJobFromPage(detail.url,link.title,detail.text,org);
        if(generic)jobs.push(generic);
      }
    }
  }
  const unique=new Map<string,DiscoveredJob>();
  for(const job of jobs){
    const key=(job.sourceJobId||job.sourceUrl||job.title+'|'+job.city).toLowerCase();
    if(!unique.has(key))unique.set(key,job);
  }
  let published=0;
  for(const job of unique.values())if(await saveDiscoveredJob(env,org,job))published++;
  await env.DB.prepare(`UPDATE caregiver_jobs SET status='stale',is_published=0,updated_at=CURRENT_TIMESTAMP
    WHERE agency_organization_id=? AND status='current' AND datetime(last_seen_at)<datetime('now','-7 days')`).bind(org.id).run();
  return {seen:unique.size,published,provider,status:'ok'};
}

export async function discoverAgencyJobsBatch(env:FeatureEnv,limit=12){
  if(!env.DB)return {processed:0,seen:0,published:0};
  const rows=await env.DB.prepare(`SELECT ao.id,ao.canonical_name,ao.primary_website,ao.primary_careers_url,ao.city,ao.state,ao.zip,
      ao.current_hiring_signal,scan.last_scanned_at
    FROM agency_organizations ao
    LEFT JOIN agency_job_scan_state scan ON scan.organization_id=ao.id
    WHERE ao.is_active=1
      AND ((ao.primary_careers_url IS NOT NULL AND ao.primary_careers_url!='') OR ao.current_hiring_signal='hiring_detected')
      AND (scan.last_scanned_at IS NULL OR datetime(scan.last_scanned_at)<datetime('now','-24 hours'))
    ORDER BY CASE WHEN ao.current_hiring_signal='hiring_detected' THEN 0 ELSE 1 END,
      CASE WHEN scan.last_scanned_at IS NULL THEN 0 ELSE 1 END,COALESCE(scan.last_scanned_at,'') ASC,ao.caregiver_relevance_score DESC
    LIMIT ?`).bind(limit).all<Row>();
  let seen=0,published=0;
  for(const org of rows.results||[]){
    let result:{seen:number;published:number;provider:string;status:string};
    try{result=await discoverJobsForOrg(env,org)}
    catch(error){result={seen:0,published:0,provider:'error',status:error instanceof Error?error.message.slice(0,200):'scan_failed'}}
    seen+=result.seen;published+=result.published;
    await env.DB.prepare(`INSERT INTO agency_job_scan_state(organization_id,source_provider,source_listing_url,last_status,last_error,jobs_seen,jobs_published,last_scanned_at,updated_at)
      VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(organization_id) DO UPDATE SET source_provider=excluded.source_provider,source_listing_url=excluded.source_listing_url,
        last_status=excluded.last_status,last_error=excluded.last_error,jobs_seen=excluded.jobs_seen,jobs_published=excluded.jobs_published,
        last_scanned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
      .bind(org.id,result.provider,clean(org.primary_careers_url,1000),result.status,result.status==='ok'?null:result.status,result.seen,result.published).run();
  }
  return {processed:(rows.results||[]).length,seen,published};
}

export async function getPublicCaregiverJobs(url:URL,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const role=clean(url.searchParams.get('role'),80);
  const city=clean(url.searchParams.get('city'),120);
  const limit=Math.max(1,Math.min(100,asNum(url.searchParams.get('limit'))||50));
  let sql=`SELECT id,title,role,employer_name,city,state,zip,employment_type,pay_min,pay_max,source_url,date_posted,first_seen_at,last_seen_at
    FROM caregiver_jobs WHERE is_published=1 AND status='current' AND state='MD'`;
  const args:unknown[]=[];
  if(role){sql+=' AND lower(role)=lower(?)';args.push(role)}
  if(city){sql+=' AND lower(city)=lower(?)';args.push(city)}
  sql+=" ORDER BY CASE WHEN date_posted IS NULL OR date_posted='' THEN 1 ELSE 0 END,date_posted DESC,last_seen_at DESC LIMIT ?";
  args.push(limit);
  const rows=await env.DB.prepare(sql).bind(...args).all<Row>();
  return json({ok:true,jobs:(rows.results||[]).map(r=>({
    id:r.id,title:decodeHtml(clean(r.title,220)),role:r.role,employerName:r.employer_name,city:r.city,state:r.state,zip:r.zip,
    employmentType:r.employment_type,payMin:r.pay_min,payMax:r.pay_max,sourceUrl:r.source_url,
    datePosted:r.date_posted,firstSeenAt:r.first_seen_at,lastSeenAt:r.last_seen_at
  }))});
}


export async function getPublicCaregiverJob(id:string,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const row=await env.DB.prepare(`SELECT id,title,role,employer_name,city,state,zip,employment_type,pay_min,pay_max,
      description_text,source_url,source_listing_url,date_posted,first_seen_at,last_seen_at,last_checked_at
    FROM caregiver_jobs WHERE id=? AND is_published=1 AND status='current' LIMIT 1`)
    .bind(id).first<Row>();
  if(!row)return json({ok:false,error:'Job not found'},{status:404});
  return json({ok:true,job:{
    id:row.id,title:decodeHtml(clean(row.title,220)),role:row.role,employerName:row.employer_name,
    city:row.city,state:row.state,zip:row.zip,employmentType:row.employment_type,
    payMin:row.pay_min,payMax:row.pay_max,description:decodeHtml(clean(row.description_text,8000)),
    sourceUrl:row.source_url,sourceListingUrl:row.source_listing_url,datePosted:row.date_posted,
    firstSeenAt:row.first_seen_at,lastSeenAt:row.last_seen_at,lastCheckedAt:row.last_checked_at
  }});
}
