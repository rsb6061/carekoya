import type { FeatureEnv } from './serverFeatures';
import { boundingBox, haversineMiles, rowGeo, zipGeoJoin } from './geo';
import { decodeHtml, normalizeTitle } from './jobDiscovery';
import { descriptionBlocks, normalizePay, payLabel } from './jobFormat';
import { US_STATES, jobsHubPath, slugify, usState, type UsState } from './usStates';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):(typeof v==='number'?String(v):'');
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};

export const SEO_ORIGIN='https://carejoys.com';
export const JOBS_PER_PAGE=50;
/** Cities need this many current jobs before they get their own indexable page. */
export const CITY_PAGE_MIN_JOBS=3;
/** States need this many current jobs before their jobs and hire-caregivers pages are indexable. */
export const STATE_PAGE_MIN_JOBS=5;

/** Cuts at the last word boundary so titles never end mid-word. */
export function trimAtWord(text:string,max:number){
  const t=text.replace(/\s+/g,' ').trim();
  if(t.length<=max)return t;
  const cut=t.slice(0,max+1);
  const space=cut.lastIndexOf(' ');
  return (space>max*0.6?cut.slice(0,space):t.slice(0,max)).replace(/[\s|·,–-]+$/,'');
}

/** "Main | CareJoys" when it fits in `max`; otherwise the brand is dropped first, then words from the end of `main`. */
export function fitTitle(main:string,max=60){
  const branded=main.replace(/\s+/g,' ').trim()+' | CareJoys';
  return branded.length<=max?branded:trimAtWord(main,max);
}

/** "Title | Employer | CareJoys" within `max`, dropping the employer before cutting the job title. */
export function jobPageTitle(title:string,employer:string,max=65){
  const full=title+' | '+employer+' | CareJoys';
  if(full.length<=max)return full;
  const short=title+' | CareJoys';
  if(short.length<=max)return short;
  return trimAtWord(title,max-' | CareJoys'.length)+' | CareJoys';
}

const PAY_UNITS:Record<string,{label:string;schema:string}>={
  hour:{label:'/hr',schema:'HOUR'},day:{label:'/day',schema:'DAY'},week:{label:'/wk',schema:'WEEK'},
  month:{label:'/mo',schema:'MONTH'},year:{label:'/yr',schema:'YEAR'}
};
export const payUnitLabel=(period:unknown)=>PAY_UNITS[clean(period,20)]?.label||'';

export function payText(min:unknown,max:unknown,period:unknown){
  return payLabel({payMin:min,payMax:max,payPeriod:period});
}

/** Maps the free-text employment type scraped from careers pages onto schema.org values. */
export function employmentTypeSchema(value:unknown){
  const v=clean(value,200).toLowerCase();
  const out=new Set<string>();
  if(/full[\s_-]*time/.test(v))out.add('FULL_TIME');
  if(/part[\s_-]*time/.test(v))out.add('PART_TIME');
  if(/per[\s_-]*diem|prn/.test(v))out.add('PER_DIEM');
  if(/contract|1099/.test(v))out.add('CONTRACTOR');
  if(/temp/.test(v))out.add('TEMPORARY');
  if(/intern/.test(v))out.add('INTERN');
  if(/volunteer/.test(v))out.add('VOLUNTEER');
  if(!out.size&&v)out.add('OTHER');
  return [...out];
}

// D1's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker.
const isoDate=(value:unknown)=>{
  const s=clean(value,40);
  if(!s)return null;
  const t=Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(s)?s.replace(' ','T')+'Z':s);
  return Number.isFinite(t)?new Date(t):null;
};

/**
 * Google for Jobs markup for one job. `validThrough` comes from the source when it gave one, otherwise
 * 30 days after CareJoys last confirmed the listing was still live.
 */
export function jobPostingJsonLd(job:Row,org:Row|null){
  const id=clean(job.id,200);
  const url=SEO_ORIGIN+'/jobs/'+encodeURIComponent(id);
  const posted=isoDate(job.date_posted)||isoDate(job.first_seen_at)||isoDate(job.last_seen_at)||new Date();
  const checked=isoDate(job.last_checked_at)||isoDate(job.last_seen_at)||posted;
  const sourceValid=isoDate(job.valid_through);
  const validThrough=sourceValid&&sourceValid.getTime()>Date.now()?sourceValid:new Date(checked.getTime()+30*86400000);
  // CareJoys' own summary, never the employer's posting text.
  const summary=descriptionBlocks(clean(job.summary_text,4000));
  const pay=normalizePay(job.pay_min,job.pay_max,job.pay_period);
  const unit=PAY_UNITS[pay.period]?.schema;
  const lo=pay.min??0,hi=pay.max??0;
  const website=clean(org?.primary_website,500);
  const posting:Record<string,unknown>={
    '@context':'https://schema.org',
    '@type':'JobPosting',
    title:normalizeTitle(job.title)||'Caregiver',
    description:summary.lead?'<p>'+escapeHtml(summary.lead)+'</p>'+(summary.bullets.length?'<ul>'+summary.bullets.map(b=>'<li>'+escapeHtml(b)+'</li>').join('')+'</ul>':''):'<p>'+escapeHtml(normalizeTitle(job.title)+' at '+clean(job.employer_name,200))+'.</p>',
    identifier:{'@type':'PropertyValue',name:'CareJoys',value:id},
    datePosted:posted.toISOString().slice(0,10),
    validThrough:validThrough.toISOString(),
    hiringOrganization:{'@type':'Organization',name:clean(job.employer_name,200)||'Care employer',...(website?{sameAs:website}:{})},
    jobLocation:{'@type':'Place',address:{'@type':'PostalAddress',
      ...(clean(job.city,120)?{addressLocality:clean(job.city,120)}:{}),
      ...(clean(job.state,20)?{addressRegion:clean(job.state,20)}:{}),
      ...(clean(job.zip,10)?{postalCode:clean(job.zip,10)}:{}),
      addressCountry:'US'}},
    directApply:false,
    url
  };
  const types=employmentTypeSchema(job.employment_type);
  if(types.length)posting.employmentType=types.length===1?types[0]:types;
  if(unit&&(lo||hi)){
    posting.baseSalary={'@type':'MonetaryAmount',currency:clean(job.pay_currency,3)||'USD',value:{'@type':'QuantitativeValue',
      ...(lo&&hi&&lo!==hi?{minValue:lo,maxValue:hi}:{value:lo||hi}),unitText:unit}};
  }
  return posting;
}

export const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));

function primaryRole(job:Row){
  return clean(job.role,80)||'Caregiver';
}

function median(values:number[]){
  if(!values.length)return 0;
  const s=[...values].sort((a,b)=>a-b);
  const mid=Math.floor(s.length/2);
  return s.length%2?s[mid]:(s[mid-1]+s[mid])/2;
}

/**
 * What a CareJoys job page adds beyond the copied listing: nearby similar jobs, the hiring agency's
 * other openings, and how this pay compares with the same role in the same state.
 */
export async function jobPageContext(env:FeatureEnv,job:Row){
  if(!env.DB)return {similar:[],employer:null,payContext:null};
  const role=primaryRole(job);
  const state=clean(job.state,2).toUpperCase();
  const geoRow=await env.DB.prepare(`SELECT zg.lat AS geo_lat,zg.lng AS geo_lng FROM caregiver_jobs j ${zipGeoJoin('j')} WHERE j.id=? LIMIT 1`).bind(job.id).first<Row>();
  const geo=geoRow?rowGeo(geoRow):null;

  let sql=`SELECT j.id,j.title,j.employer_name,j.city,j.state,j.pay_min,j.pay_max,j.pay_period,zg.lat AS geo_lat,zg.lng AS geo_lng
    FROM caregiver_jobs j ${zipGeoJoin('j')} WHERE j.is_published=1 AND j.status='current' AND j.id!=? AND j.agency_organization_id!=?`;
  const args:unknown[]=[job.id,clean(job.agency_organization_id,100)];
  if(geo){const box=boundingBox(geo,25);sql+=' AND zg.lat BETWEEN ? AND ? AND zg.lng BETWEEN ? AND ?';args.push(box.minLat,box.maxLat,box.minLng,box.maxLng)}
  else if(state){sql+=' AND j.state=?';args.push(state)}
  sql+=' ORDER BY CASE WHEN lower(j.role)=lower(?) THEN 0 ELSE 1 END,j.last_seen_at DESC LIMIT 40';args.push(role);
  const rows=(await env.DB.prepare(sql).bind(...args).all<Row>()).results||[];
  const similar=rows.map(r=>{const g=rowGeo(r);return {r,d:geo&&g?haversineMiles(geo,g):null}})
    .sort((a,b)=>(a.d??99)-(b.d??99)).slice(0,6)
    .map(({r,d})=>({id:clean(r.id,200),title:normalizeTitle(r.title),employerName:clean(r.employer_name,200),city:clean(r.city,120),state:clean(r.state,20),
      pay:payText(r.pay_min,r.pay_max,r.pay_period),distanceMiles:d===null?null:Math.round(d*10)/10}));

  const org=job.agency_organization_id?await env.DB.prepare('SELECT id,canonical_name,city,state,provider_types,primary_website FROM agency_organizations WHERE id=? LIMIT 1').bind(job.agency_organization_id).first<Row>():null;
  const otherJobs=org?asNum((await env.DB.prepare("SELECT COUNT(*) AS count FROM caregiver_jobs WHERE agency_organization_id=? AND is_published=1 AND status='current' AND id!=?").bind(org.id,job.id).first<Row>())?.count):0;
  const employer=org?{name:clean(org.canonical_name,200)||clean(job.employer_name,200),city:clean(org.city,120),state:clean(org.state,20),
    providerTypes:clean(org.provider_types,300),website:clean(org.primary_website,500),otherOpenJobs:otherJobs}:null;

  let payContext:null|{role:string;state:string;median:number;count:number;unit:string;position:'above'|'near'|'below'|null}=null;
  const midpoint=(min:unknown,max:unknown,period:unknown)=>{
    const p=normalizePay(min,max,period);
    return p.period==='hour'?(p.min!==null&&p.max!==null?(p.min+p.max)/2:(p.min??p.max??0)):0;
  };
  const mine=midpoint(job.pay_min,job.pay_max,job.pay_period);
  if(state&&mine){
    const pays=((await env.DB.prepare("SELECT pay_min,pay_max,pay_period FROM caregiver_jobs WHERE is_published=1 AND status='current' AND state=? AND lower(role)=lower(?) AND (pay_min>0 OR pay_max>0) LIMIT 500").bind(state,role).all<Row>()).results||[])
      .map(r=>midpoint(r.pay_min,r.pay_max,r.pay_period)).filter(n=>n>0);
    if(pays.length>=5){
      const m=Math.round(median(pays)*100)/100;
      payContext={role,state,median:m,count:pays.length,unit:'/hr',position:mine?(mine>m*1.05?'above':mine<m*0.95?'below':'near'):null};
    }
  }
  return {similar,employer,payContext};
}

/**
 * Big cities whose jobs are mostly posted under suburb names ("Towson", "Parkville") get one metro page at the
 * city's slug that rolls those places up. ZIP prefixes keep a mislabeled out-of-area job from joining.
 */
export type Metro={state:string;slug:string;name:string;area:string;zipPrefixes:string[];places:string[]};
export const METROS:Metro[]=[
  {state:'MD',slug:'baltimore',name:'Baltimore',area:'Baltimore City and Baltimore County',zipPrefixes:['210','211','212'],places:[
    'Baltimore','Baltimore City','Baltimore County','Towson','Parkville','Rosedale','Pikesville','Owings Mills','Cockeysville',
    'Lutherville','Lutherville-Timonium','Lutherville Timonium','Timonium','Hunt Valley','Phoenix','Monkton','Sparks','Glen Arm',
    'Kingsville','Perry Hall','Nottingham','White Marsh','Middle River','Essex','Dundalk','Catonsville','Arbutus','Halethorpe',
    'Lansdowne','Woodlawn','Windsor Mill','Gwynn Oak','Randallstown','Reisterstown','Glyndon','Brooklyn Park','Brooklyn Pk','Woodstock']},
  {state:'MI',slug:'detroit',name:'Detroit',area:'Wayne, Oakland and Macomb counties',zipPrefixes:['480','481','482','483'],places:[
    'Detroit','Dearborn','Dearborn Heights','Southfield','Bloomfield Township','Bloomfield Hills','West Bloomfield','Birmingham',
    'Bingham Farms','Farmington','Farmington Hills','Livonia','Novi','Northville','Plymouth','Canton','Westland','Garden City',
    'Redford Township','Taylor','Southgate','Southagate','Wyandotte','Riverview','Belleville','New Boston','Romulus','Troy',
    'Rochester','Rochester Hills','Auburn Hills','Pontiac','Waterford','Clarkston','Lake Orion','Oxford','Commerce Township',
    'Wixom','Milford','Royal Oak','Ferndale','Madison Heights','Warren','Sterling Heights','Clinton Township','Macomb',
    'Shelby Township','Grosse Pointe']},
  {state:'MA',slug:'boston',name:'Boston',area:'Boston and its inner suburbs',zipPrefixes:['020','021','022','024'],places:[
    'Boston','Allston','Brighton','Hyde Park','South Boston','Mattapan','Dorchester','Roxbury','Jamaica Plain','Roslindale',
    'West Roxbury','Charlestown','East Boston','Cambridge','Somerville','Brookline','Newton','Waltham','Watertown','Belmont',
    'Arlington','Lexington','Quincy','Milton','Dedham','Norwood','Needham','Wellesley','Randolph','Braintree','Weymouth',
    'Canton','Walpole','Malden','Medford','Everett','Chelsea','Revere','Winchester','Woburn','Burlington']}
];
export const metroFor=(stateCode:string,slug:string)=>METROS.find(m=>m.state===stateCode&&m.slug===slug)||null;
/** The metro a place belongs to, so its own page can link up to the metro page. */
export const metroOfPlace=(stateCode:string,city:string)=>METROS.find(m=>m.state===stateCode&&m.slug!==slugify(city)&&m.places.some(p=>p.toLowerCase()===city.trim().toLowerCase()))||null;
/** SQL (no table alias) matching a metro's current jobs. */
function metroWhere(m:Metro){
  return {sql:`state=? AND lower(city) IN (${m.places.map(()=>'?').join(',')}) AND (COALESCE(zip,'')='' OR substr(zip,1,3) IN (${m.zipPrefixes.map(()=>'?').join(',')}))`,
    args:[m.state,...m.places.map(p=>p.toLowerCase()),...m.zipPrefixes] as unknown[]};
}
/** Current job counts per metro, optionally limited to one state. */
export async function metroTotals(env:FeatureEnv,stateCode=''){
  if(!env.DB)return [] as {metro:Metro;count:number;lastmod:string}[];
  const db=env.DB;
  return Promise.all(METROS.filter(m=>!stateCode||m.state===stateCode).map(async metro=>{
    const w=metroWhere(metro);
    const row=await db.prepare(`SELECT COUNT(*) AS count,MAX(last_seen_at) AS lastmod FROM caregiver_jobs WHERE ${PUBLISHED} AND ${w.sql}`).bind(...w.args).first<Row>();
    return {metro,count:asNum(row?.count),lastmod:clean(row?.lastmod,40)};
  }));
}
/** Replaces a metro's core-city row with the metro total, keeping the list sorted by count. */
function withMetros<T extends {slug:string;count:number}>(rows:T[],totals:{metro:Metro;count:number}[],make:(t:{metro:Metro;count:number})=>T){
  const slugs=new Set(totals.filter(t=>t.count>0).map(t=>t.metro.slug));
  return [...rows.filter(r=>!slugs.has(r.slug)),...totals.filter(t=>t.count>0).map(make)].sort((a,b)=>b.count-a.count);
}

/** One page of a state (or city) jobs hub plus the cities worth linking to. */
export async function jobsHub(env:FeatureEnv,opts:{state:UsState;citySlug?:string;role?:string;page?:number}){
  const empty={jobs:[] as Row[],total:0,city:'',cities:[] as {city:string;slug:string;count:number}[],page:1,pages:1,metro:null as Metro|null,places:[] as {city:string;slug:string;count:number}[]};
  if(!env.DB)return empty;
  const cityRows=((await env.DB.prepare(`SELECT city,COUNT(*) AS count FROM caregiver_jobs
    WHERE is_published=1 AND status='current' AND state=? AND COALESCE(city,'')!='' GROUP BY lower(city) ORDER BY count DESC LIMIT 200`)
    .bind(opts.state.code).all<Row>()).results||[]);
  const metros=await metroTotals(env,opts.state.code);
  const cities=withMetros(cityRows.map(r=>({city:clean(r.city,120),slug:slugify(clean(r.city,120)),count:asNum(r.count)})).filter(c=>c.slug),
    metros,t=>({city:t.metro.name,slug:t.metro.slug,count:t.count}));
  const metro=opts.citySlug?metroFor(opts.state.code,opts.citySlug):null;
  let city=opts.citySlug?cities.find(c=>c.slug===opts.citySlug)?.city||'':'';
  if(opts.citySlug&&!city&&cityRows.length>=200){
    // Big states have more cities than the linked list; the sitemap still links their pages.
    const all=((await env.DB.prepare(`SELECT DISTINCT city FROM caregiver_jobs WHERE is_published=1 AND status='current' AND state=? AND COALESCE(city,'')!=''`)
      .bind(opts.state.code).all<Row>()).results||[]);
    city=all.map(r=>clean(r.city,120)).find(c=>slugify(c)===opts.citySlug)||'';
  }
  if(opts.citySlug&&!city)return {...empty,cities};
  let where="is_published=1 AND status='current' AND state=?";
  const args:unknown[]=[opts.state.code];
  if(metro&&city){const w=metroWhere(metro);where="is_published=1 AND status='current' AND "+w.sql;args.splice(0,args.length,...w.args)}
  else if(city){where+=' AND lower(city)=lower(?)';args.push(city)}
  if(opts.role){where+=' AND (lower(role)=lower(?) OR lower(COALESCE(roles_json,\'\')) LIKE lower(?))';args.push(opts.role,'%"'+opts.role+'"%')}
  const total=asNum((await env.DB.prepare('SELECT COUNT(*) AS count FROM caregiver_jobs WHERE '+where).bind(...args).first<Row>())?.count);
  const pages=Math.max(1,Math.ceil(total/JOBS_PER_PAGE));
  const page=Math.min(pages,Math.max(1,Math.floor(opts.page||1)));
  const jobs=((await env.DB.prepare(`SELECT id,title,role,employer_name,city,state,zip,pay_min,pay_max,pay_period,employment_type FROM caregiver_jobs WHERE ${where}
    ORDER BY CASE WHEN date_posted IS NULL OR date_posted='' THEN 1 ELSE 0 END,date_posted DESC,last_seen_at DESC LIMIT ? OFFSET ?`)
    .bind(...args,JOBS_PER_PAGE,(page-1)*JOBS_PER_PAGE).all<Row>()).results||[]);
  // A metro page lists the places it covers so each suburb page stays one click away.
  const places=metro&&city?(((await env.DB.prepare(`SELECT city,COUNT(*) AS count FROM caregiver_jobs WHERE ${where} GROUP BY lower(city) ORDER BY count DESC`).bind(...args).all<Row>()).results||[])
    .map(r=>({city:clean(r.city,120),slug:slugify(clean(r.city,120)),count:asNum(r.count)})).filter(c=>c.slug)):[];
  return {jobs,total,city,cities,page,pages,metro:metro&&city?metro:null,places};
}

/** States and cities with enough current jobs to deserve an indexable hub page. */
export async function hubLocations(env:FeatureEnv){
  if(!env.DB)return {states:[] as {state:UsState;count:number;lastmod:string}[],cities:[] as {state:UsState;slug:string;count:number;lastmod:string}[]};
  const stateRows=(await env.DB.prepare("SELECT state,COUNT(*) AS count,MAX(last_seen_at) AS lastmod FROM caregiver_jobs WHERE is_published=1 AND status='current' GROUP BY state").all<Row>()).results||[];
  const states=stateRows.map(r=>({state:usState(clean(r.state,20)),count:asNum(r.count),lastmod:clean(r.lastmod,40)})).filter((s):s is {state:UsState;count:number;lastmod:string}=>!!s.state&&s.count>=STATE_PAGE_MIN_JOBS);
  const cityRows=(await env.DB.prepare(`SELECT state,city,COUNT(*) AS count,MAX(last_seen_at) AS lastmod FROM caregiver_jobs
    WHERE is_published=1 AND status='current' AND COALESCE(city,'')!='' GROUP BY state,lower(city) HAVING COUNT(*)>=?`).bind(CITY_PAGE_MIN_JOBS).all<Row>()).results||[];
  const metros=(await metroTotals(env)).filter(t=>t.count>=CITY_PAGE_MIN_JOBS);
  const cities=cityRows.map(r=>({state:usState(clean(r.state,20)),slug:slugify(clean(r.city,120)),count:asNum(r.count),lastmod:clean(r.lastmod,40)}))
    .filter((c):c is {state:UsState;slug:string;count:number;lastmod:string}=>!!c.state&&!!c.slug&&!metros.some(t=>t.metro.state===c.state?.code&&t.metro.slug===c.slug));
  for(const t of metros){const state=usState(t.metro.state);if(state)cities.push({state,slug:t.metro.slug,count:t.count,lastmod:t.lastmod})}
  return {states,cities};
}

const PUBLISHED="is_published=1 AND status='current'";
const roleWhere=(role:string)=>role?" AND (lower(role)=lower(?) OR lower(COALESCE(roles_json,'')) LIKE lower(?))":'';
const roleArgs=(role:string)=>role?[role,'%"'+role+'"%']:[];

/** `/caregiver-jobs`: every state with current jobs, the busiest cities, and the newest jobs nationwide. */
export async function nationalJobsHub(env:FeatureEnv,opts:{role?:string;page?:number}={}){
  const role=clean(opts.role,40);
  const empty={jobs:[] as Row[],total:0,states:[] as {state:UsState;count:number}[],cities:[] as {state:UsState;city:string;slug:string;count:number}[],page:1,pages:1};
  if(!env.DB)return empty;
  const stateRows=(await env.DB.prepare(`SELECT state,COUNT(*) AS count FROM caregiver_jobs WHERE ${PUBLISHED} GROUP BY state ORDER BY count DESC`).all<Row>()).results||[];
  const states=stateRows.map(r=>({state:usState(clean(r.state,20)),count:asNum(r.count)})).filter((s):s is {state:UsState;count:number}=>!!s.state&&s.count>0);
  const cityRows=(await env.DB.prepare(`SELECT state,city,COUNT(*) AS count FROM caregiver_jobs WHERE ${PUBLISHED} AND COALESCE(city,'')!=''
    GROUP BY state,lower(city) HAVING COUNT(*)>=? ORDER BY count DESC LIMIT 30`).bind(CITY_PAGE_MIN_JOBS).all<Row>()).results||[];
  const metros=(await metroTotals(env)).filter(t=>t.count>=CITY_PAGE_MIN_JOBS);
  const cities=[...cityRows.map(r=>({state:usState(clean(r.state,20)),city:clean(r.city,120),slug:slugify(clean(r.city,120)),count:asNum(r.count)}))
    .filter((c):c is {state:UsState;city:string;slug:string;count:number}=>!!c.state&&!!c.slug&&!metros.some(t=>t.metro.state===c.state?.code&&t.metro.slug===c.slug)),
    ...metros.flatMap(t=>{const state=usState(t.metro.state);return state?[{state,city:t.metro.name,slug:t.metro.slug,count:t.count}]:[]})]
    .sort((a,b)=>b.count-a.count).slice(0,30);
  const total=asNum((await env.DB.prepare(`SELECT COUNT(*) AS count FROM caregiver_jobs WHERE ${PUBLISHED}${roleWhere(role)}`).bind(...roleArgs(role)).first<Row>())?.count);
  const pages=Math.max(1,Math.ceil(total/JOBS_PER_PAGE));
  const page=Math.min(pages,Math.max(1,Math.floor(opts.page||1)));
  const jobs=((await env.DB.prepare(`SELECT id,title,role,employer_name,city,state,zip,pay_min,pay_max,pay_period,employment_type FROM caregiver_jobs WHERE ${PUBLISHED}${roleWhere(role)}
    ORDER BY CASE WHEN date_posted IS NULL OR date_posted='' THEN 1 ELSE 0 END,date_posted DESC,last_seen_at DESC LIMIT ? OFFSET ?`)
    .bind(...roleArgs(role),JOBS_PER_PAGE,(page-1)*JOBS_PER_PAGE).all<Row>()).results||[]);
  return {jobs,total,states,cities,page,pages};
}

// "St. Louis", "st louis" and "St-Louis" all compare equal.
export const cityKey=(value:string)=>value.toLowerCase().replace(/[.,']/g,'').replace(/[-\s]+/g,' ').trim();
const CITY_KEY_SQL="trim(replace(replace(replace(replace(replace(lower(city),'.',''),',',''),'''',''),'-',' '),'  ',' '))";

/**
 * What the jobs search box means: a ZIP (the page lists jobs near it), or the state or city hub to open.
 * Accepts "Texas", "TX", "Houston", "Houston, TX" and "Houston Texas".
 */
export async function resolveJobsSearch(env:FeatureEnv,query:string):Promise<{zip:string}|{path:string}|null>{
  const q=query.replace(/\s+/g,' ').trim().slice(0,120);
  if(!q)return null;
  const zip=q.match(/^(\d{5})(?:-\d{4})?$/);
  if(zip)return {zip:zip[1]};
  const whole=usState(q);
  if(whole)return {path:jobsHubPath(whole)};
  let city=q,state:UsState|null=null;
  const comma=q.match(/^(.+?),\s*([^,]+)$/);
  if(comma&&usState(comma[2])){city=comma[1];state=usState(comma[2])}
  else{
    const lower=q.toLowerCase();
    for(const [code,name] of US_STATES){
      const suffix=[' '+name.toLowerCase(),' '+code.toLowerCase()].find(sfx=>lower.endsWith(sfx)&&lower.length>sfx.length);
      // A trailing two-letter code only counts in capitals, so "Bel Air" keeps its "Air".
      if(suffix&&(suffix.length>3||q.endsWith(' '+code))){city=q.slice(0,q.length-suffix.length);state=usState(code);break}
    }
  }
  if(!env.DB)return state?{path:jobsHubPath(state)}:null;
  const key=cityKey(city);
  if(!key)return state?{path:jobsHubPath(state)}:null;
  const row=await env.DB.prepare(`SELECT state,city,COUNT(*) AS count FROM caregiver_jobs WHERE ${PUBLISHED} AND ${CITY_KEY_SQL}=?${state?' AND state=?':''}
    GROUP BY state,lower(city) ORDER BY count DESC LIMIT 1`).bind(...(state?[key,state.code]:[key])).first<Row>();
  const found=row?usState(clean(row.state,20)):null;
  if(found)return {path:jobsHubPath(found,slugify(clean(row!.city,120)))};
  return state?{path:jobsHubPath(state)}:null;
}

const ROLE_NAMES:Record<string,string>={CNA:'Certified nursing assistant (CNA)',HHA:'Home health aide (HHA)',PCA:'Personal care aide (PCA)',
  DSP:'Direct support professional (DSP)',GNA:'Geriatric nursing assistant (GNA)',Caregiver:'Caregiver and companion'};
const htmlText=(v:unknown)=>String(v??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]!));
const dollars=(n:number)=>'$'+n.toFixed(2);

export type StateHiringStats={jobs:number;agencies:number;caregivers:number;roles:{role:string;count:number}[];
  cities:{city:string;slug:string;count:number}[];employers:{name:string;count:number}[];
  hourly:{low:number;median:number;high:number;sample:number}|null};

/** What CareJoys knows about caregiver hiring in one state, from current jobs, agencies and caregiver profiles. */
const hourlyMidpoints=(rows:Row[])=>rows.map(r=>{const p=normalizePay(r.pay_min,r.pay_max,r.pay_period);
  return p.period==='hour'?(p.min!==null&&p.max!==null?(p.min+p.max)/2:p.min??p.max):null}).filter((n):n is number=>n!==null).sort((a,b)=>a-b);
/** Middle and interquartile hourly pay; needs 5 samples to say anything. */
function hourlyQuartiles(mids:number[]){
  const at=(q:number)=>mids[Math.min(mids.length-1,Math.floor(q*(mids.length-1)+0.5))];
  return mids.length>=5?{low:at(0.25),median:at(0.5),high:at(0.75),sample:mids.length}:null;
}

export async function stateHiringStats(env:FeatureEnv,state:UsState):Promise<StateHiringStats>{
  const empty={jobs:0,agencies:0,caregivers:0,roles:[],cities:[],employers:[],hourly:null};
  if(!env.DB)return empty;
  const db=env.DB;
  const [jobs,agencies,caregivers,roles,cities,employers,payRows,metros]=await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM caregiver_jobs WHERE ${PUBLISHED} AND state=?`).bind(state.code).first<Row>(),
    db.prepare('SELECT COUNT(*) AS count FROM agency_organizations WHERE is_active=1 AND COALESCE(is_test,0)=0 AND state=?').bind(state.code).first<Row>(),
    db.prepare('SELECT COUNT(*) AS count FROM caregivers WHERE is_active=1 AND upper(state)=?').bind(state.code).first<Row>(),
    db.prepare(`SELECT role,COUNT(*) AS count FROM caregiver_jobs WHERE ${PUBLISHED} AND state=? AND COALESCE(role,'')!='' GROUP BY role ORDER BY count DESC`).bind(state.code).all<Row>(),
    db.prepare(`SELECT city,COUNT(*) AS count FROM caregiver_jobs WHERE ${PUBLISHED} AND state=? AND COALESCE(city,'')!='' GROUP BY lower(city) ORDER BY count DESC LIMIT 200`).bind(state.code).all<Row>(),
    db.prepare(`SELECT employer_name,COUNT(*) AS count FROM caregiver_jobs WHERE ${PUBLISHED} AND state=? AND COALESCE(employer_name,'')!='' GROUP BY employer_name ORDER BY count DESC,employer_name LIMIT 8`).bind(state.code).all<Row>(),
    db.prepare(`SELECT pay_min,pay_max,pay_period FROM caregiver_jobs WHERE ${PUBLISHED} AND state=? AND pay_period='hour' LIMIT 2000`).bind(state.code).all<Row>(),
    metroTotals(env,state.code)
  ]);
  const mids=hourlyMidpoints(payRows.results||[]);
  return {
    jobs:asNum(jobs?.count),agencies:asNum(agencies?.count),caregivers:asNum(caregivers?.count),
    roles:(roles.results||[]).map(r=>({role:clean(r.role,40),count:asNum(r.count)})),
    // Suburbs a metro page covers are counted under the metro instead of listed one by one.
    cities:withMetros((cities.results||[]).map(r=>({city:clean(r.city,120),slug:slugify(clean(r.city,120)),count:asNum(r.count)}))
      .filter(c=>c.slug&&!metros.some(t=>t.count>0&&t.metro.places.some(p=>p.toLowerCase()===c.city.toLowerCase()))),
      metros,t=>({city:t.metro.name+' area',slug:t.metro.slug,count:t.count})).slice(0,10),
    employers:(employers.results||[]).map(r=>({name:decodeHtml(clean(r.employer_name,160)),count:asNum(r.count)})),
    hourly:hourlyQuartiles(mids)
  };
}

/** Pay, roles and top employers across a metro's current jobs, for the metro jobs page. */
export async function metroJobStats(env:FeatureEnv,metro:Metro){
  const out={roles:[] as {role:string;count:number}[],employers:[] as {name:string;count:number}[],hourly:null as StateHiringStats['hourly']};
  if(!env.DB)return out;
  const w=metroWhere(metro);
  const [roles,employers,payRows]=await Promise.all([
    env.DB.prepare(`SELECT role,COUNT(*) AS count FROM caregiver_jobs WHERE ${PUBLISHED} AND ${w.sql} AND COALESCE(role,'')!='' GROUP BY role ORDER BY count DESC`).bind(...w.args).all<Row>(),
    env.DB.prepare(`SELECT employer_name,COUNT(*) AS count FROM caregiver_jobs WHERE ${PUBLISHED} AND ${w.sql} AND COALESCE(employer_name,'')!='' GROUP BY employer_name ORDER BY count DESC,employer_name LIMIT 8`).bind(...w.args).all<Row>(),
    env.DB.prepare(`SELECT pay_min,pay_max,pay_period FROM caregiver_jobs WHERE ${PUBLISHED} AND ${w.sql} AND pay_period='hour' LIMIT 2000`).bind(...w.args).all<Row>()
  ]);
  const mids=hourlyMidpoints(payRows.results||[]);
  out.roles=(roles.results||[]).map(r=>({role:clean(r.role,40),count:asNum(r.count)}));
  out.employers=(employers.results||[]).map(r=>({name:decodeHtml(clean(r.employer_name,160)),count:asNum(r.count)}));
  out.hourly=hourlyQuartiles(mids);
  return out;
}

export function metroJobStatsHtml(metro:Metro,s:Awaited<ReturnType<typeof metroJobStats>>){
  const name='the '+htmlText(metro.name)+' area';
  const parts:string[]=[];
  if(s.hourly)parts.push('<h2>Caregiver pay in '+name+'</h2><p>Across '+s.hourly.sample+' current caregiver jobs in '+name+' that list an hourly rate, the middle posted rate is '+dollars(s.hourly.median)+
    ' an hour. Half of them pay between '+dollars(s.hourly.low)+' and '+dollars(s.hourly.high)+'.</p>');
  if(s.roles.length)parts.push('<h2>Roles hiring in '+name+'</h2><ul>'+s.roles.map(r=>'<li>'+htmlText(ROLE_NAMES[r.role]||r.role)+': '+r.count+' open job'+(r.count===1?'':'s')+'</li>').join('')+'</ul>');
  if(s.employers.length)parts.push('<h2>Employers with the most open caregiver jobs in '+name+'</h2><p>'+s.employers.map(e=>htmlText(e.name)+' ('+e.count+')').join(', ')+'.</p>');
  return parts.join('');
}

/** The data section of /hire-caregivers/{state}: every number comes from current CareJoys data for that state. */
export function stateHiringHtml(state:UsState,s:StateHiringStats){
  const name=htmlText(state.name);
  const parts:string[]=['<h2>Caregiver hiring in '+name+' right now</h2><ul>',
    '<li>'+s.jobs.toLocaleString('en-US')+' current caregiver job'+(s.jobs===1?'':'s')+' posted by '+name+' employers</li>',
    s.agencies?'<li>'+s.agencies.toLocaleString('en-US')+' home-care and senior-care agencies tracked in '+name+'</li>':'',
    s.caregivers?'<li>'+s.caregivers.toLocaleString('en-US')+' caregiver'+(s.caregivers===1?'':'s')+' with CareJoys profiles in '+name+'</li>':'',
    '</ul>'];
  if(s.hourly)parts.push('<h2>Caregiver pay in '+name+'</h2><p>Across '+s.hourly.sample+' current '+name+' caregiver jobs that list an hourly rate, the middle posted rate is '+dollars(s.hourly.median)+
    ' an hour. Half of them pay between '+dollars(s.hourly.low)+' and '+dollars(s.hourly.high)+'.</p>');
  if(s.roles.length)parts.push('<h2>Roles '+name+' employers are hiring</h2><ul>'+s.roles.map(r=>'<li>'+htmlText(ROLE_NAMES[r.role]||r.role)+': '+r.count+' open job'+(r.count===1?'':'s')+'</li>').join('')+'</ul>');
  if(s.cities.length)parts.push('<h2>Where the openings are</h2><ul>'+s.cities.map(c=>'<li>'+(c.count>=CITY_PAGE_MIN_JOBS?'<a href="'+jobsHubPath(state,c.slug)+'">'+htmlText(c.city)+'</a>':htmlText(c.city))+': '+c.count+' job'+(c.count===1?'':'s')+'</li>').join('')+'</ul>');
  if(s.employers.length)parts.push('<h2>Employers with the most open caregiver jobs in '+name+'</h2><p>'+s.employers.map(e=>htmlText(e.name)+' ('+e.count+')').join(', ')+'.</p>');
  return parts.join('');
}

/** Current caregiver jobs within `miles` of a training program's locations, nearest first, for its graduates. */
export async function jobsNearTrainingProgram(env:FeatureEnv,zips:string[],miles=15){
  const out={total:0,town:'',jobs:[] as {id:string;title:string;employerName:string;city:string;pay:string;miles:number}[]};
  const zip=zips.map(z=>clean(z,10).slice(0,5)).find(z=>/^\d{5}$/.test(z));
  if(!env.DB||!zip)return out;
  const geo=await env.DB.prepare('SELECT lat,lng,city FROM zip_geo WHERE zip=?').bind(zip).first<Row>();
  if(!geo)return out;
  const center={lat:asNum(geo.lat),lng:asNum(geo.lng)};
  const box=boundingBox(center,miles);
  const rows=(await env.DB.prepare(`SELECT j.id,j.title,j.employer_name,j.city,j.pay_min,j.pay_max,j.pay_period,zg.lat AS geo_lat,zg.lng AS geo_lng
    FROM caregiver_jobs j ${zipGeoJoin('j')} WHERE j.is_published=1 AND j.status='current'
    AND zg.lat BETWEEN ? AND ? AND zg.lng BETWEEN ? AND ? LIMIT 500`).bind(box.minLat,box.maxLat,box.minLng,box.maxLng).all<Row>()).results||[];
  const near=rows.map(r=>{const g=rowGeo(r);return {r,d:g?haversineMiles(center,g):999}}).filter(x=>x.d<=miles).sort((a,b)=>a.d-b.d);
  out.total=near.length;
  out.town=clean(geo.city,120);
  out.jobs=near.slice(0,8).map(({r,d})=>({id:clean(r.id,200),title:normalizeTitle(r.title),employerName:decodeHtml(clean(r.employer_name,200)),
    city:clean(r.city,120),pay:payLabel({payMin:r.pay_min,payMax:r.pay_max,payPeriod:r.pay_period})||'',miles:Math.round(d)}));
  return out;
}
