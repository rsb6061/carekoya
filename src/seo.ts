import type { FeatureEnv } from './serverFeatures';
import { boundingBox, haversineMiles, rowGeo, zipGeoJoin } from './geo';
import { decodeHtml, normalizeTitle } from './jobDiscovery';
import { slugify, usState, type UsState } from './usStates';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):(typeof v==='number'?String(v):'');
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};

export const SEO_ORIGIN='https://carejoys.com';
export const JOBS_PER_PAGE=50;
/** Cities need this many current jobs before they get their own indexable page. */
export const CITY_PAGE_MIN_JOBS=3;

/** Cuts at the last word boundary so titles never end mid-word. */
export function trimAtWord(text:string,max:number){
  const t=text.replace(/\s+/g,' ').trim();
  if(t.length<=max)return t;
  const cut=t.slice(0,max+1);
  const space=cut.lastIndexOf(' ');
  return (space>max*0.6?cut.slice(0,space):t.slice(0,max)).replace(/[\s|·,–-]+$/,'');
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
  const lo=asNum(min),hi=asNum(max),unit=payUnitLabel(period);
  const fmt=(n:number)=>'$'+(Number.isInteger(n)?String(n):n.toFixed(2));
  if(lo&&hi)return fmt(lo)+'–'+fmt(hi)+unit;
  if(lo)return 'From '+fmt(lo)+unit;
  if(hi)return 'Up to '+fmt(hi)+unit;
  return '';
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
  const description=decodeHtml(clean(job.description_text,8000)).replace(/\s+/g,' ').trim();
  const unit=PAY_UNITS[clean(job.pay_period,20)]?.schema;
  const lo=asNum(job.pay_min),hi=asNum(job.pay_max);
  const website=clean(org?.primary_website,500);
  const posting:Record<string,unknown>={
    '@context':'https://schema.org',
    '@type':'JobPosting',
    title:normalizeTitle(job.title)||'Caregiver',
    description:description?'<p>'+escapeHtml(description)+'</p>':'<p>'+escapeHtml(normalizeTitle(job.title)+' at '+clean(job.employer_name,200))+'.</p>',
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
      ...(lo&&hi?{minValue:lo,maxValue:hi}:{value:lo||hi}),unitText:unit}};
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
  if(state&&clean(job.pay_period,20)==='hour'){
    const pays=((await env.DB.prepare("SELECT pay_min,pay_max FROM caregiver_jobs WHERE is_published=1 AND status='current' AND state=? AND lower(role)=lower(?) AND pay_period='hour' AND (pay_min>0 OR pay_max>0) LIMIT 500").bind(state,role).all<Row>()).results||[])
      .map(r=>{const lo=asNum(r.pay_min),hi=asNum(r.pay_max);return lo&&hi?(lo+hi)/2:(lo||hi)}).filter(n=>n>5&&n<100);
    if(pays.length>=5){
      const m=Math.round(median(pays)*100)/100;
      const lo=asNum(job.pay_min),hi=asNum(job.pay_max);
      const mine=lo&&hi?(lo+hi)/2:(lo||hi);
      payContext={role,state,median:m,count:pays.length,unit:'/hr',position:mine?(mine>m*1.05?'above':mine<m*0.95?'below':'near'):null};
    }
  }
  return {similar,employer,payContext};
}

/** One page of a state (or city) jobs hub plus the cities worth linking to. */
export async function jobsHub(env:FeatureEnv,opts:{state:UsState;citySlug?:string;role?:string;page?:number}){
  const empty={jobs:[] as Row[],total:0,city:'',cities:[] as {city:string;slug:string;count:number}[],page:1,pages:1};
  if(!env.DB)return empty;
  const cityRows=((await env.DB.prepare(`SELECT city,COUNT(*) AS count FROM caregiver_jobs
    WHERE is_published=1 AND status='current' AND state=? AND COALESCE(city,'')!='' GROUP BY lower(city) ORDER BY count DESC LIMIT 200`)
    .bind(opts.state.code).all<Row>()).results||[]);
  const cities=cityRows.map(r=>({city:clean(r.city,120),slug:slugify(clean(r.city,120)),count:asNum(r.count)})).filter(c=>c.slug);
  const city=opts.citySlug?cities.find(c=>c.slug===opts.citySlug)?.city||'':'';
  if(opts.citySlug&&!city)return {...empty,cities};
  let where="is_published=1 AND status='current' AND state=?";
  const args:unknown[]=[opts.state.code];
  if(city){where+=' AND lower(city)=lower(?)';args.push(city)}
  if(opts.role){where+=' AND (lower(role)=lower(?) OR lower(COALESCE(roles_json,\'\')) LIKE lower(?))';args.push(opts.role,'%"'+opts.role+'"%')}
  const total=asNum((await env.DB.prepare('SELECT COUNT(*) AS count FROM caregiver_jobs WHERE '+where).bind(...args).first<Row>())?.count);
  const pages=Math.max(1,Math.ceil(total/JOBS_PER_PAGE));
  const page=Math.min(pages,Math.max(1,Math.floor(opts.page||1)));
  const jobs=((await env.DB.prepare(`SELECT id,title,role,employer_name,city,state,zip,pay_min,pay_max,pay_period,employment_type FROM caregiver_jobs WHERE ${where}
    ORDER BY CASE WHEN date_posted IS NULL OR date_posted='' THEN 1 ELSE 0 END,date_posted DESC,last_seen_at DESC LIMIT ? OFFSET ?`)
    .bind(...args,JOBS_PER_PAGE,(page-1)*JOBS_PER_PAGE).all<Row>()).results||[]);
  return {jobs,total,city,cities,page,pages};
}

/** States and cities with enough current jobs to deserve an indexable hub page. */
export async function hubLocations(env:FeatureEnv){
  if(!env.DB)return {states:[] as {state:UsState;count:number;lastmod:string}[],cities:[] as {state:UsState;slug:string;count:number;lastmod:string}[]};
  const stateRows=(await env.DB.prepare("SELECT state,COUNT(*) AS count,MAX(last_seen_at) AS lastmod FROM caregiver_jobs WHERE is_published=1 AND status='current' GROUP BY state").all<Row>()).results||[];
  const states=stateRows.map(r=>({state:usState(clean(r.state,20)),count:asNum(r.count),lastmod:clean(r.lastmod,40)})).filter((s):s is {state:UsState;count:number;lastmod:string}=>!!s.state&&s.count>0);
  const cityRows=(await env.DB.prepare(`SELECT state,city,COUNT(*) AS count,MAX(last_seen_at) AS lastmod FROM caregiver_jobs
    WHERE is_published=1 AND status='current' AND COALESCE(city,'')!='' GROUP BY state,lower(city) HAVING COUNT(*)>=?`).bind(CITY_PAGE_MIN_JOBS).all<Row>()).results||[];
  const cities=cityRows.map(r=>({state:usState(clean(r.state,20)),slug:slugify(clean(r.city,120)),count:asNum(r.count),lastmod:clean(r.lastmod,40)}))
    .filter((c):c is {state:UsState;slug:string;count:number;lastmod:string}=>!!c.state&&!!c.slug);
  return {states,cities};
}
