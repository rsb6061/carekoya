// The public caregiver directory: /caregivers/{state}/{city} pages, the card each listed caregiver gets, the
// dashboard switch that puts someone on it, and the "Still looking?" email that keeps the list fresh.
//
// A caregiver is listed only when every one of these holds: they ticked "List my profile", their email is
// verified (or a legacy profile was reactivated), they are actively looking, that was confirmed in the last
// LISTING_MAX_AGE_DAYS, and their ZIP is a known place. The card never carries contact details, a full last name,
// an exact ZIP, a licence number, a resume or a video; a photo needs its own yes. Pages with fewer than
// DIRECTORY_MIN_LISTED caregivers exist for the people who land on them but are noindex, like thin jobs pages.
import { hourlyPayFloor } from './payPreferences';
import { cleanList } from './listField';
import { scrubBio } from './caregiverProtectionRules';
import { freshnessLabel } from './matching';
import { zipGeoJoin } from './geo';
import { caregiverForIdentity, type CaregiverIdentity } from './caregiverApi';
import { stillLookingEmail, withUnsubscribe } from './email';
import { unsubscribeLink } from './emailPreferences';
import { slugify, usState, type UsState } from './usStates';
import type { FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});

/** Listed caregivers a city or state page needs before Google is asked to index it. */
export const DIRECTORY_MIN_LISTED=5;
/** A listing drops off the public pages when the caregiver hasn't confirmed they are looking within this many days. */
export const LISTING_MAX_AGE_DAYS=30;
/** The "Still looking?" email goes out this many days after the last confirmation. */
export const STILL_LOOKING_AFTER_DAYS=14;
export const DIRECTORY_PAGE_SIZE=50;

/** Caregiver `c` joined to zip_geo `zg` is on the public directory. */
export const LISTED_SQL=`c.public_listing=1 AND c.is_active=1 AND c.work_status='actively_looking'
  AND (c.auth0_email_verified=1 OR (c.source='legacy_carekoya' AND c.activation_completed_at IS NOT NULL)) AND COALESCE(c.is_test,0)=0
  AND c.last_confirmed_at IS NOT NULL AND datetime(c.last_confirmed_at)>datetime('now','-${LISTING_MAX_AGE_DAYS} days')
  AND zg.zip IS NOT NULL AND COALESCE(zg.city,'')!='' AND COALESCE(zg.state,'')!=''`;

const CARD_COLUMNS=`c.id,c.first_name,c.last_name,c.role,c.certifications,c.specialties,c.languages,c.years_experience,c.desired_wage,c.hourly_rate_min,
  c.shift_preferences,c.employment_types,c.start_availability,c.care_settings,c.preferred_settings,c.travel_distance_miles,c.transportation,c.willing_to_drive,c.bio,
  c.last_confirmed_at,c.profile_updated_at,c.updated_at,c.work_status,c.auth0_email_verified,c.public_photo,c.profile_photo_url,c.zip,
  zg.city AS geo_city,zg.state AS geo_state`;

export type PublicCaregiverCard=ReturnType<typeof publicCaregiverCard>;

/** "212xx": enough to say which part of town, never the exact ZIP. */
export const zipArea=(zip:unknown)=>{const z=clean(zip,10).replace(/\D/g,'');return z.length>=5?z.slice(0,3)+'xx':''};

const listOf=(v:unknown)=>clean(v,500).split(',').map(x=>x.trim()).filter(Boolean);
const EMPLOYMENT:Record<string,string>={full_time:'Full-time',part_time:'Part-time',per_diem:'Per diem'};

/** What anyone on the web sees of a listed caregiver. The input row must come from a LISTED_SQL query. */
export function publicCaregiverCard(c:Row){
  const first=clean(c.first_name,80);
  const lastInitial=clean(c.last_name,80).charAt(0).toUpperCase();
  const payFloor=hourlyPayFloor(c.hourly_rate_min??c.desired_wage);
  const state=usState(clean(c.geo_state,10));
  return {
    id:clean(c.id,100),
    name:first+(lastInitial?' '+lastInitial+'.':''),
    role:clean(c.role,80),
    certifications:cleanList(c.certifications),
    specialties:cleanList(c.specialties),
    languages:cleanList(c.languages),
    yearsExperience:asNum(c.years_experience)||null,
    payFloor,
    shifts:clean(c.shift_preferences,200),
    hours:listOf(c.employment_types).map(x=>EMPLOYMENT[x]||x),
    startAvailability:clean(c.start_availability,40),
    careSettings:listOf(c.care_settings),
    preferredSettings:listOf(c.preferred_settings),
    travelMiles:asNum(c.travel_distance_miles)||null,
    ownCar:clean(c.transportation,80)==='own_car'||asNum(c.willing_to_drive)===1,
    bio:scrubBio(c.bio),
    city:clean(c.geo_city,120),
    state:state?.code||'',
    stateSlug:state?.slug||'',
    citySlug:slugify(clean(c.geo_city,120)),
    zipArea:zipArea(c.zip),
    verifiedEmail:asNum(c.auth0_email_verified)===1,
    availability:freshnessLabel(c.work_status,c.last_confirmed_at),
    lastConfirmedAt:clean(c.last_confirmed_at,40)||null,
    profileUpdatedAt:clean(c.profile_updated_at,40)||clean(c.updated_at,40)||null,
    photoUrl:asNum(c.public_photo)===1&&clean(c.profile_photo_url,300)?'/api/public/caregivers/'+encodeURIComponent(clean(c.id,100))+'/photo':null
  };
}

export type DirectoryPlace={city:string;slug:string;count:number};

/** One directory page: every state with listed caregivers, one state's cities, or one city's cards. */
export async function directoryHub(env:FeatureEnv,opts:{state?:UsState|null;citySlug?:string;page?:number}={}){
  const empty={total:0,page:1,pages:1,city:'',cards:[] as PublicCaregiverCard[],cities:[] as DirectoryPlace[],states:[] as {state:UsState;count:number}[]};
  if(!env.DB)return empty;
  const from=`FROM caregivers c ${zipGeoJoin('c')} WHERE ${LISTED_SQL}`;
  const stateRows=(await env.DB.prepare(`SELECT zg.state,COUNT(*) AS count ${from} GROUP BY zg.state ORDER BY count DESC,zg.state`).all<Row>()).results||[];
  const states=stateRows.map(r=>({state:usState(clean(r.state,10)),count:asNum(r.count)})).filter((s):s is {state:UsState;count:number}=>!!s.state&&s.count>0);
  if(!opts.state)return {...empty,states,total:states.reduce((n,s)=>n+s.count,0)};
  const cityRows=(await env.DB.prepare(`SELECT zg.city,COUNT(*) AS count ${from} AND zg.state=? GROUP BY lower(zg.city) ORDER BY count DESC,zg.city`).bind(opts.state.code).all<Row>()).results||[];
  const cities=cityRows.map(r=>({city:clean(r.city,120),slug:slugify(clean(r.city,120)),count:asNum(r.count)})).filter(c=>c.slug);
  const city=opts.citySlug?cities.find(c=>c.slug===opts.citySlug)?.city||'':'';
  if(opts.citySlug&&!city)return {...empty,states,cities};
  let where=from+' AND zg.state=?';const args:unknown[]=[opts.state.code];
  if(city){where+=' AND lower(zg.city)=lower(?)';args.push(city)}
  const total=asNum((await env.DB.prepare(`SELECT COUNT(*) AS count ${where}`).bind(...args).first<Row>())?.count);
  const pages=Math.max(1,Math.ceil(total/DIRECTORY_PAGE_SIZE));
  const page=Math.min(pages,Math.max(1,Math.floor(opts.page||1)));
  const rows=(await env.DB.prepare(`SELECT ${CARD_COLUMNS} ${where} ORDER BY c.last_confirmed_at DESC,c.profile_updated_at DESC LIMIT ? OFFSET ?`)
    .bind(...args,DIRECTORY_PAGE_SIZE,(page-1)*DIRECTORY_PAGE_SIZE).all<Row>()).results||[];
  return {total,page,pages,city,cards:rows.map(publicCaregiverCard),cities,states};
}

/** The directory pages with enough listed caregivers for the sitemap. */
export async function directoryLocations(env:FeatureEnv){
  const states:{state:UsState;count:number}[]=[];const cities:{state:UsState;slug:string;count:number}[]=[];
  if(!env.DB)return {states,cities};
  const rows=(await env.DB.prepare(`SELECT zg.state,zg.city,COUNT(*) AS count FROM caregivers c ${zipGeoJoin('c')} WHERE ${LISTED_SQL} GROUP BY zg.state,lower(zg.city)`).all<Row>()).results||[];
  const perState=new Map<string,number>();
  for(const r of rows){
    const state=usState(clean(r.state,10));if(!state)continue;
    const count=asNum(r.count);
    perState.set(state.code,(perState.get(state.code)||0)+count);
    if(count>=DIRECTORY_MIN_LISTED)cities.push({state,slug:slugify(clean(r.city,120)),count});
  }
  for(const [code,count] of perState){const state=usState(code);if(state&&count>=DIRECTORY_MIN_LISTED)states.push({state,count})}
  return {states,cities};
}

/** One listed caregiver's public card, or null when they are not (or no longer) on the directory. */
export async function publicCaregiverProfile(env:FeatureEnv,id:string){
  if(!env.DB||!id)return null;
  const row=await env.DB.prepare(`SELECT ${CARD_COLUMNS} FROM caregivers c ${zipGeoJoin('c')} WHERE c.id=? AND ${LISTED_SQL} LIMIT 1`).bind(id).first<Row>();
  return row?publicCaregiverCard(row):null;
}

/** Whether the caregiver ever opted in and later left, so their old profile link can answer 410 instead of 404. */
export async function wasListed(env:FeatureEnv,id:string){
  if(!env.DB||!id)return false;
  return !!(await env.DB.prepare('SELECT 1 FROM caregivers WHERE id=? AND public_listing_at IS NOT NULL LIMIT 1').bind(id).first());
}

/** The listed caregiver's photo, only with their separate photo yes. */
export async function publicCaregiverPhoto(env:FeatureEnv,id:string){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const card=await publicCaregiverProfile(env,id);
  if(!card?.photoUrl)return json({ok:false,error:'Photo not found'},{status:404});
  const row=await env.DB.prepare('SELECT image_blob,content_type FROM caregiver_profile_photos WHERE caregiver_id=? LIMIT 1').bind(id).first<{image_blob:ArrayBuffer|number[];content_type:string}>();
  if(!row)return json({ok:false,error:'Photo not found'},{status:404});
  return new Response(new Uint8Array(row.image_blob),{headers:{'content-type':row.content_type||'image/webp','cache-control':'public,max-age=3600','x-content-type-options':'nosniff'}});
}

/** Records the caregiver's own listing choice at signup or on the dashboard. `listed: undefined` leaves it as it was. */
export async function saveListingChoice(env:FeatureEnv,caregiverId:string,choice:{listed?:boolean;photo?:boolean},source:string){
  if(!env.DB)return;
  if(typeof choice.listed==='boolean'){
    await env.DB.prepare(`UPDATE caregivers SET public_listing=?,public_listing_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE public_listing_at END,public_listing_source=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(choice.listed?1:0,choice.listed?1:0,source,caregiverId).run();
  }
  if(typeof choice.photo==='boolean')await env.DB.prepare('UPDATE caregivers SET public_photo=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(choice.photo?1:0,caregiverId).run();
}

/** GET: the signed-in caregiver's listing state and card preview. POST {listed?,photo?}: change it. */
export async function myPublicListing(request:Request,env:FeatureEnv,identity:CaregiverIdentity|null){
  if(!identity)return json({ok:false,error:'Sign in required'},{status:401});
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return json({ok:false,error:'No caregiver profile yet'},{status:404});
  if(request.method==='POST'){
    const data=await request.json().catch(()=>null) as Row|null;
    await saveListingChoice(env,caregiverId,{listed:typeof data?.listed==='boolean'?data.listed:undefined,photo:typeof data?.photo==='boolean'?data.photo:undefined},'caregiver_dashboard');
  }
  const c=await env.DB.prepare(`SELECT ${CARD_COLUMNS},c.public_listing,(${LISTED_SQL}) AS listed FROM caregivers c ${zipGeoJoin('c')} WHERE c.id=? LIMIT 1`).bind(caregiverId).first<Row>();
  if(!c)return json({ok:false,error:'No caregiver profile yet'},{status:404});
  const card=publicCaregiverCard(c);
  // Why a caregiver who said yes still isn't shown, in their own words.
  const reasons:string[]=[];
  if(asNum(c.public_listing)===1&&asNum(c.listed)!==1){
    if(clean(c.work_status,40)!=='actively_looking')reasons.push('Your profile says you are not looking right now.');
    if(asNum(c.auth0_email_verified)!==1)reasons.push('Your email is not verified yet.');
    if(!clean(c.last_confirmed_at,40)||Date.now()-Date.parse(clean(c.last_confirmed_at,40))>LISTING_MAX_AGE_DAYS*86400000)reasons.push('Confirm you are still looking (it has been more than '+LISTING_MAX_AGE_DAYS+' days).');
    if(!card.city||!card.state)reasons.push('Add a US ZIP code to your profile.');
  }
  const state=usState(card.state);
  return json({ok:true,listed:asNum(c.listed)===1,optedIn:asNum(c.public_listing)===1,photo:asNum(c.public_photo)===1,hasPhoto:!!clean(c.profile_photo_url,300),reasons,
    card:{...card,photoUrl:asNum(c.public_photo)===1&&clean(c.profile_photo_url,300)?'/api/me/photo':null},
    pageUrl:state&&card.citySlug?'/caregivers/'+state.slug+'/'+card.citySlug:'/caregivers',profileUrl:'/caregiver/'+encodeURIComponent(caregiverId)});
}

async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

const FROM='CareJoys <hello@carejoys.com>';
const ORIGIN='https://carejoys.com';

/**
 * "Still looking?" to listed caregivers whose last confirmation is STILL_LOOKING_AFTER_DAYS old: one email per
 * confirmation cycle, answered with a one-tap yes or no link. No answer means the listing lapses on its own at
 * LISTING_MAX_AGE_DAYS; nothing is deleted.
 */
export async function sendStillLookingEmails(env:FeatureEnv,limit=50){
  if(!env.DB||!env.EMAIL)return {sent:0,failed:0};
  const rows=(await env.DB.prepare(`SELECT c.id,c.first_name,c.email FROM caregivers c
    WHERE c.public_listing=1 AND c.is_active=1 AND c.work_status='actively_looking' AND COALESCE(c.is_test,0)=0 AND c.email LIKE '%@%'
      AND (c.auth0_email_verified=1 OR (c.source='legacy_carekoya' AND c.activation_completed_at IS NOT NULL))
      AND c.last_confirmed_at IS NOT NULL AND datetime(c.last_confirmed_at)<=datetime('now','-${STILL_LOOKING_AFTER_DAYS} days')
      AND (c.still_looking_sent_at IS NULL OR datetime(c.still_looking_sent_at)<datetime(c.last_confirmed_at))
      AND NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE lower(s.email)=lower(c.email))
    ORDER BY c.last_confirmed_at LIMIT ?`).bind(limit).all<Row>()).results||[];
  let sent=0,failed=0;
  for(const r of rows){
    const id=clean(r.id,100),email=clean(r.email,320).toLowerCase();
    const token=crypto.randomUUID()+'-'+crypto.randomUUID();
    await env.DB.prepare('UPDATE caregivers SET still_looking_token_hash=?,still_looking_sent_at=CURRENT_TIMESTAMP WHERE id=?').bind(await sha256Hex(token),id).run();
    const link=(answer:'yes'|'no')=>ORIGIN+'/api/still-looking?t='+encodeURIComponent(token)+'&a='+answer;
    const unsubscribe=await unsubscribeLink(env.DB,email,'still_looking');
    const body=withUnsubscribe(stillLookingEmail(clean(r.first_name,80),link('yes'),link('no')),unsubscribe.link);
    try{
      await env.EMAIL.send({from:FROM,to:email,subject:body.subject,html:body.html,text:body.text,headers:unsubscribe.headers});
      sent++;
    }catch(error){console.error('still looking email failed',id,error);failed++;}
  }
  return {sent,failed};
}

const page=(title:string,body:string,status=200)=>new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} | CareJoys</title>
<style>body{margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#191e49}main{max-width:480px;margin:12vh auto;padding:32px 24px;background:#f7f6fb;border:1px solid #e8e6f0;border-radius:24px}h1{font-size:26px;margin:0 0 12px}p{font-size:16px;line-height:1.6;color:#5b5f7e}a{color:#b8368f}</style></head>
<body><main><div style="font-weight:700;margin-bottom:20px">CareJoys</div><h1>${title}</h1>${body}</main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});

/** The yes or no tap from the "Still looking?" email. Each token answers once. */
export async function answerStillLooking(url:URL,env:FeatureEnv){
  if(!env.DB)return page('Something went wrong','<p>Please try again later.</p>',503);
  const token=clean(url.searchParams.get('t'),200);
  const answer=clean(url.searchParams.get('a'),10);
  const c=token?await env.DB.prepare('SELECT id FROM caregivers WHERE still_looking_token_hash=? LIMIT 1').bind(await sha256Hex(token)).first<Row>():null;
  if(!c||(answer!=='yes'&&answer!=='no'))return page('This link has already been used','<p>Sign in at <a href="/login">carejoys.com/login</a> to change whether you are listed.</p>',410);
  const id=clean(c.id,100);
  const status=answer==='yes'?'actively_looking':'not_looking';
  await env.DB.prepare("UPDATE caregivers SET work_status=?,is_active=?,last_confirmed_at=CURRENT_TIMESTAMP,still_looking_token_hash=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(status,answer==='yes'?1:0,id).run();
  await env.DB.prepare("INSERT INTO availability_events(id,caregiver_id,status,source,confirmed_at) VALUES (?,?,?,'still_looking_email',CURRENT_TIMESTAMP)").bind(crypto.randomUUID(),id,status).run();
  return answer==='yes'
    ?page('Thanks, you’re still listed','<p>Employers near you can find you for another '+LISTING_MAX_AGE_DAYS+' days. We’ll check in again if we haven’t heard from you.</p><p><a href="/dashboard">Open your dashboard</a></p>')
    :page('Got it, you’re off the list','<p>Your profile is no longer shown to employers. Whenever you’re looking again, turn it back on from <a href="/dashboard/settings">your settings</a>.</p>');
}
