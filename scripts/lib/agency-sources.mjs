// Pure helpers shared by the NPPES importer and the organization builder (Google listings come from src/dataforseo.ts).
// Kept free of I/O so scripts/test-agency-sources.mjs can exercise them directly.
import crypto from 'node:crypto';

export const STATES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',
  DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',
  MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',
  NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',
  SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',
  WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
const BY_NAME=new Map(Object.entries(STATES).map(([code,name])=>[name.toLowerCase(),code]));

export const clean=v=>String(v??'').trim();
export const normalize=v=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,'');
export const sql=v=>v===null||v===undefined||v===''?'NULL':typeof v==='number'?(Number.isFinite(v)?String(v):'NULL'):"'"+String(v).replaceAll("'","''")+"'";
export const idFor=(source,key)=>'ag_'+crypto.createHash('sha256').update(source+'|'+key).digest('hex').slice(0,24);

/** "VA", "va" or "Virginia" → "VA"; anything else → "". */
export function stateCode(value){
  const s=clean(value);
  if(/^[a-z]{2}$/i.test(s)&&STATES[s.toUpperCase()])return s.toUpperCase();
  return BY_NAME.get(s.toLowerCase())||'';
}
export function parseKinds(value){
  const kinds=clean(value||'home_care,facility').split(/[\s,]+/).filter(Boolean).map(k=>k==='facilities'?'facility':k);
  if(!kinds.length||kinds.some(k=>!['home_care','facility'].includes(k)))throw new Error('--kinds takes home_care, facility or both');
  return [...new Set(kinds)];
}
export function parseStates(value){
  const codes=clean(value).split(/[\s,]+/).filter(Boolean).map(stateCode);
  if(!codes.length||codes.some(c=>!c))throw new Error('--states needs two-letter state codes, e.g. VA or VA,DC');
  return [...new Set(codes)];
}
/** Last ten digits of a US phone number, or "" when it isn't one. */
export function phone10(value){
  const d=clean(value).replace(/\D/g,'');
  const ten=d.length===11&&d.startsWith('1')?d.slice(1):d;
  return ten.length===10?ten:'';
}
export function formatPhone(value){
  const p=phone10(value);
  return p?`(${p.slice(0,3)}) ${p.slice(3,6)}-${p.slice(6)}`:clean(value);
}
export const zip5=v=>clean(v).match(/^\d{5}/)?.[0]||'';
/** Title-cases the ALL-CAPS names and addresses NPPES ships, leaving mixed-case text alone. */
export function titleCase(value){
  const s=clean(value).replace(/\s+/g,' ');
  if(s!==s.toUpperCase())return s;
  return s.toLowerCase().replace(/\b([a-z])/g,c=>c.toUpperCase())
    .replace(/\b(Llc|Inc|Lp|Llp|Pllc|Pc|Ii|Iii|Iv)\b/g,w=>w.toUpperCase())
    .replace(/\b(Ne|Nw|Se|Sw)\b/g,w=>w.toUpperCase());
}

// ---------------------------------------------------------------- NPPES (NPI registry bulk file)

/** Taxonomies worth importing, with how directly each employs caregivers and whether it is home care or a facility. */
export const NPPES_TAXONOMIES={
  '253Z00000X':{providerType:'In Home Supportive Care Agency',score:100,kind:'home_care'},
  '251E00000X':{providerType:'Home Health Agency',score:90,kind:'home_care'},
  '251J00000X':{providerType:'Nursing Care Agency',score:70,kind:'home_care'},
  '310400000X':{providerType:'Assisted Living Facility',score:90,kind:'facility'},
  '311500000X':{providerType:'Alzheimer Center',score:85,kind:'facility'},
  '314000000X':{providerType:'Skilled Nursing Facility',score:85,kind:'facility'},
  '313M00000X':{providerType:'Nursing Facility',score:80,kind:'facility'},
  '311ZA0620X':{providerType:'Adult Care Home',score:80,kind:'facility'}
};
/** A row is a facility only when every matching code is a facility one: an agency that also runs a facility stays home care. */
export const providerKindOf=codes=>codes.length&&codes.every(c=>NPPES_TAXONOMIES[c]?.kind==='facility')?'facility':'home_care';
export const NPPES_COLUMNS={
  npi:'NPI',
  entity:'Entity Type Code',
  legalName:'Provider Organization Name (Legal Business Name)',
  otherName:'Provider Other Organization Name',
  otherNameType:'Provider Other Organization Name Type Code',
  address1:'Provider First Line Business Practice Location Address',
  address2:'Provider Second Line Business Practice Location Address',
  city:'Provider Business Practice Location Address City Name',
  state:'Provider Business Practice Location Address State Name',
  zip:'Provider Business Practice Location Address Postal Code',
  phone:'Provider Business Practice Location Address Telephone Number',
  deactivated:'NPI Deactivation Date',
  reactivated:'NPI Reactivation Date',
  officialFirst:'Authorized Official First Name',
  officialLast:'Authorized Official Last Name',
  enumerated:'Provider Enumeration Date',
  updated:'Last Update Date'
};

/** Splits one line of the NPPES CSV (every field double-quoted, quotes doubled inside). */
export function parseCsvLine(line){
  const out=[];let field='',quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(quoted){
      if(ch==='"'){if(line[i+1]==='"'){field+='"';i++}else quoted=false}
      else field+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===','){out.push(field);field=''}
    else if(ch!=='\r')field+=ch;
  }
  out.push(field);
  return out;
}

/** Column positions from the NPPES header row; throws if the file layout changed. */
export function nppesHeader(fields){
  const at=name=>fields.indexOf(name);
  const index={};
  for(const [key,name] of Object.entries(NPPES_COLUMNS)){
    index[key]=at(name);
    if(index[key]<0&&!['otherNameType','enumerated','updated'].includes(key))throw new Error('NPPES file is missing column: '+name);
  }
  index.taxonomies=[];
  for(let n=1;n<=15;n++){const i=at('Healthcare Provider Taxonomy Code_'+n);if(i>=0)index.taxonomies.push(i)}
  if(!index.taxonomies.length)throw new Error('NPPES file has no taxonomy columns');
  return index;
}

/** One NPPES row → an `agencies` record, or null when it isn't an active agency (or facility) of a wanted kind in the wanted states. */
export function nppesRecord(fields,index,states,kinds=['home_care','facility']){
  const get=k=>clean(fields[index[k]]);
  if(get('entity')!=='2')return null;
  const state=stateCode(get('state'));
  if(!states.includes(state))return null;
  if(get('deactivated')&&!get('reactivated'))return null;
  const codes=index.taxonomies.map(i=>clean(fields[i])).filter(Boolean);
  const matched=codes.filter(c=>NPPES_TAXONOMIES[c]);
  if(!matched.length)return null;
  const best=matched.map(c=>NPPES_TAXONOMIES[c]).sort((a,b)=>b.score-a.score)[0];
  const npi=get('npi');
  const legalName=titleCase(get('legalName'));
  // Type code 3 is a DBA, which is usually the name caregivers and families know.
  const dba=index.otherNameType>=0&&clean(fields[index.otherNameType])==='3'?titleCase(get('otherName')):'';
  const name=dba||legalName;
  if(!npi||!name||!kinds.includes(providerKindOf(matched)))return null;
  const contact=[get('officialFirst'),get('officialLast')].filter(Boolean).map(titleCase).join(' ');
  return {
    source:'nppes',sourceKey:'npi:'+npi,id:idFor('nppes','npi:'+npi),
    npi,name,legalName,
    address1:titleCase([get('address1'),get('address2')].filter(Boolean).join(', ')),
    city:titleCase(get('city')),state,zip:zip5(get('zip')),
    phone:formatPhone(get('phone')),contactName:contact,
    providerType:[...new Set(matched.map(c=>NPPES_TAXONOMIES[c].providerType))].join(', '),
    providerKind:providerKindOf(matched),
    licenseType:'NPI '+matched.join(', '),
    score:best.score,eligible:1,
    sourceUrl:'https://npiregistry.cms.hhs.gov/provider-view/'+npi,
    sourceAsOfDate:get('updated')||null
  };
}

// ---------------------------------------------------------------- CMS nursing homes (Care Compare "Provider Information")

export const CMS_NURSING_HOME_DATASET='4pq5-n9py';
/** One row of the CMS Provider Information datastore API → an `agencies` record, or null when unusable. */
export function cmsNursingHomeRecord(row,states){
  const get=k=>clean(row?.[k]);
  const ccn=get('cms_certification_number_ccn');
  const state=stateCode(get('state'));
  const name=titleCase(get('provider_name'));
  if(!ccn||!name||!states.includes(state))return null;
  const beds=Number.parseInt(get('number_of_certified_beds'),10);
  return {
    source:'cms_nursing_home',sourceKey:'ccn:'+ccn,id:idFor('cms_nursing_home','ccn:'+ccn),
    ccn,name,legalName:titleCase(get('legal_business_name'))||name,
    address1:titleCase(get('provider_address')),city:titleCase(get('citytown')),state,zip:zip5(get('zip_code').padStart(5,'0')),
    phone:formatPhone(get('telephone_number')),
    providerType:'Nursing Home',providerKind:'facility',
    licenseType:'CMS CCN '+ccn+(get('chain_name')?' · '+get('chain_name'):''),
    bedCount:Number.isFinite(beds)?beds:null,
    score:85,eligible:1,
    sourceUrl:'https://www.medicare.gov/care-compare/details/nursing-home/'+ccn,
    sourceAsOfDate:get('processing_date')||null
  };
}

// ---------------------------------------------------------------- websites (Google rows are written by src/dataforseo.ts)

export function hostOf(url){
  try{return new URL(/^https?:/i.test(clean(url))?clean(url):'https://'+clean(url)).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}
}
/** A website is a site of its own when it isn't a deep page (franchise location pages share one domain). */
export function ownSiteDomain(url){
  try{
    const u=new URL(/^https?:/i.test(clean(url))?clean(url):'https://'+clean(url));
    const path=u.pathname.replace(/\/+$/,'');
    return path===''||/^\/(index\.html?|home)$/i.test(path)?u.hostname.toLowerCase().replace(/^www\./,''):'';
  }catch{return ''}
}

// ---------------------------------------------------------------- shared upsert

/** INSERT … ON CONFLICT for one `agencies` record from any national source. */
export function agencyUpsertSql(r){
  return `INSERT INTO agencies (
      id,source,source_key,name,legal_name,license_number,license_type,address1,city,state,zip,phone,email,website,source_url,
      is_active,last_source_sync_at,updated_at,contact_name,provider_type,organization_key,caregiver_relevance_score,caregiver_match_eligible,
      source_as_of_date,npi,google_place_id,google_cid,google_category,rating,review_count,latitude,longitude,provider_kind,bed_count,ccn
    ) VALUES (
      ${sql(r.id)},${sql(r.source)},${sql(r.sourceKey)},${sql(r.name)},${sql(r.legalName)},${sql(r.npi||null)},${sql(r.licenseType)},
      ${sql(r.address1)},${sql(r.city)},${sql(r.state)},${sql(r.zip)},${sql(r.phone)},NULL,${sql(r.website||null)},${sql(r.sourceUrl)},
      1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,${sql(r.contactName||null)},${sql(r.providerType)},${sql(normalize(r.name))},${r.score},${r.eligible},
      ${sql(r.sourceAsOfDate)},${sql(r.npi||null)},${sql(r.googlePlaceId||null)},${sql(r.googleCid||null)},${sql(r.googleCategory||null)},
      ${sql(r.rating??null)},${sql(r.reviewCount??null)},${sql(r.latitude??null)},${sql(r.longitude??null)},
      ${sql(r.providerKind||'home_care')},${sql(r.bedCount??null)},${sql(r.ccn||null)}
    )
    ON CONFLICT(source,source_key) DO UPDATE SET
      name=excluded.name,legal_name=excluded.legal_name,license_number=excluded.license_number,license_type=excluded.license_type,
      address1=excluded.address1,city=excluded.city,state=excluded.state,zip=excluded.zip,phone=excluded.phone,website=excluded.website,
      source_url=excluded.source_url,is_active=1,last_source_sync_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,
      contact_name=excluded.contact_name,provider_type=excluded.provider_type,organization_key=excluded.organization_key,
      caregiver_relevance_score=excluded.caregiver_relevance_score,caregiver_match_eligible=excluded.caregiver_match_eligible,
      source_as_of_date=excluded.source_as_of_date,npi=excluded.npi,google_place_id=excluded.google_place_id,google_cid=excluded.google_cid,
      google_category=excluded.google_category,rating=excluded.rating,review_count=excluded.review_count,
      latitude=excluded.latitude,longitude=excluded.longitude,provider_kind=excluded.provider_kind,bed_count=excluded.bed_count,ccn=excluded.ccn;`;
}

// ---------------------------------------------------------------- grouping rows into organizations

// Exactly the list the Maryland-only builder used: widening it would re-key (and re-id) existing organizations.
export const FREE_EMAIL_DOMAINS=new Set(['gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','comcast.net','verizon.net','msn.com','live.com']);
// Sites that host many unrelated businesses, so a shared one says nothing about being the same agency.
const SHARED_SITES=/(^|\.)(facebook\.com|instagram\.com|linkedin\.com|yelp\.com|google\.com|business\.site|wixsite\.com|godaddysites\.com|square\.site|weebly\.com|carecompare\.cms\.gov|caring\.com|care\.com|indeed\.com)$/;
const TOLL_FREE=/^(800|833|844|855|866|877|888)/;
const NATIONAL_SOURCES=new Set(['nppes','cms_nursing_home','google_business']);
/** Sources that carry no website or email, so an organization known only from them can't be crawled or reached. */
export const UNREACHABLE_SOURCES=new Set(['nppes','cms_nursing_home']);

const emailDomain=e=>{const s=clean(e).toLowerCase();const i=s.lastIndexOf('@');return i>0?s.slice(i+1):''};
const brand=n=>clean(n).toLowerCase().replace(/&/g,' and ')
  .replace(/\b(llc|inc|incorporated|corp|corporation|company|limited|ltd|pllc)\b/g,' ')
  .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

/** Licence lists first (they carry emails and are what claims hang off), then NPI and CMS, then Google. */
export const sourceRank=source=>NATIONAL_SOURCES.has(source)?(source==='google_business'?2:1):0;

/** The domain an agency row identifies itself by: its business email's, else its own website's. */
export function rowDomain(r){
  const d=emailDomain(r.email);
  if(d&&!FREE_EMAIL_DOMAINS.has(d))return d;
  const w=ownSiteDomain(r.website);
  return w&&!SHARED_SITES.test(w)&&!FREE_EMAIL_DOMAINS.has(w)?w:'';
}
/** Same key the Maryland-only builder used, so existing organization ids (claims, jobs, tokens) stay put. */
export function baseOrganizationKey(r){
  const d=rowDomain(r);
  if(d)return 'domain:'+d;
  return 'name:'+normalize(brand(r.name))+'|state:'+normalize(r.state||'MD')+'|city:'+normalize(r.city);
}

/**
 * Groups agency rows into organizations: same base key, or same NPI, or same local phone number in the same
 * city/ZIP. Two groups that both hold licence-list rows are never merged by phone, so existing organizations
 * are not collapsed into each other.
 */
export function groupAgencies(rows){
  const parent=new Map(),anchored=new Map();
  const find=k=>{while(parent.get(k)!==k){parent.set(k,parent.get(parent.get(k)));k=parent.get(k)}return k};
  const union=(a,b)=>{
    a=find(a);b=find(b);
    if(a===b)return;
    if(anchored.get(a)&&anchored.get(b))return;
    parent.set(b,a);anchored.set(a,anchored.get(a)||anchored.get(b));
  };
  const keyOf=new Map();
  for(const r of rows){
    const k=baseOrganizationKey(r);
    keyOf.set(r,k);
    if(!parent.has(k)){parent.set(k,k);anchored.set(k,false)}
    if(sourceRank(r.source)===0)anchored.set(find(k),true);
  }
  const byNpi=new Map(),byPhone=new Map();
  for(const r of rows){
    const k=keyOf.get(r),npi=clean(r.npi),phone=phone10(r.phone),state=normalize(r.state);
    if(npi){if(byNpi.has(npi))union(byNpi.get(npi),k);else byNpi.set(npi,k)}
    if(phone&&!TOLL_FREE.test(phone)){
      for(const place of [normalize(r.city),zip5(r.zip)].filter(Boolean)){
        const pk=phone+'|'+state+'|'+place;
        if(byPhone.has(pk))union(byPhone.get(pk),k);else byPhone.set(pk,k);
      }
    }
  }
  const groups=new Map();
  for(const r of rows){
    const root=find(keyOf.get(r));
    if(!groups.has(root))groups.set(root,[]);
    groups.get(root).push(r);
  }
  return [...groups.values()].map(rs=>{
    const ordered=[...rs].sort((a,b)=>sourceRank(a.source)-sourceRank(b.source)||keyOf.get(a).localeCompare(keyOf.get(b)));
    const key=keyOf.get(ordered[0]);
    return {key,id:'org_'+crypto.createHash('sha256').update(key).digest('hex').slice(0,24),rows:ordered};
  });
}

/** The organization-level fields for one group, each taken from the most trustworthy row that has it. */
export function organizationFields(group){
  const rs=group.rows;
  const pick=(field,order=rs)=>order.map(r=>clean(r[field])).find(Boolean)||'';
  // Google titles are the brand people search for; licence names are next best; NPI legal names last.
  const nameOrder=[...rs].sort((a,b)=>[0,2,1][sourceRank(a.source)]-[0,2,1][sourceRank(b.source)]);
  const domains=rs.map(rowDomain).filter(Boolean);
  const primaryDomain=domains[0]||'';
  const emails=rs.map(r=>clean(r.email).toLowerCase()).filter(Boolean);
  const google=rs.filter(r=>r.source==='google_business').sort((a,b)=>Number(b.review_count||0)-Number(a.review_count||0))[0];
  const website=google?clean(google.website):'';
  const types=[...new Set(rs.flatMap(r=>clean(r.provider_type).split(/,\s*/)).filter(Boolean))].sort();
  return {
    name:pick('name',nameOrder),
    primaryDomain,
    primaryEmail:emails.find(e=>!primaryDomain||e.endsWith('@'+primaryDomain))||emails[0]||'',
    primaryWebsite:website,
    phone:pick('phone'),contactName:pick('contact_name'),
    city:pick('city'),state:pick('state')||'MD',zip:pick('zip'),
    providerTypes:types.join(', '),
    licenseCount:rs.filter(r=>sourceRank(r.source)<2).length||rs.length,
    relevance:Math.max(0,...rs.map(r=>Number(r.caregiver_relevance_score||0))),
    npi:pick('npi'),googlePlaceId:google?clean(google.google_place_id):'',
    rating:google&&google.rating!=null?Number(google.rating):null,
    reviewCount:google&&google.review_count!=null?Number(google.review_count):null,
    // Any facility row makes the organization a facility, which keeps it out of agency outreach.
    providerKind:rs.some(r=>clean(r.provider_kind)==='facility')?'facility':'home_care',
    bedCount:rs.some(r=>Number(r.bed_count)>0)?Math.max(...rs.map(r=>Number(r.bed_count)||0)):null,
    sources:[...new Set(rs.map(r=>r.source.startsWith('maryland_ohcq_')?'maryland_license':r.source))].sort().join(', ')
  };
}

/** Caregiver roles an organization likely hires, from its provider types. */
export function inferredRoles(providerTypes){
  const roles=new Set();
  if(/Home Health Agency/.test(providerTypes))roles.add('HHA');
  if(/Residential Service Agency|In Home Supportive Care/.test(providerTypes)){roles.add('Caregiver');roles.add('PCA')}
  if(/Health Care Staff Agency/.test(providerTypes)){roles.add('CNA');roles.add('GNA');roles.add('HHA')}
  if(/Nursing Care Agency/.test(providerTypes)){roles.add('CNA');roles.add('HHA')}
  if(/Assisted Living|Alzheimer|Adult Care Home/.test(providerTypes)){roles.add('CNA');roles.add('Caregiver')}
  if(/Nursing Home|Nursing Facility|Skilled Nursing/.test(providerTypes)){roles.add('CNA');roles.add('GNA')}
  if(/Google listing: (Assisted living|Aged care|Retirement|Nursing home|Memory care|Senior living|Skilled nursing)/i.test(providerTypes)){roles.add('CNA');roles.add('Caregiver')}
  else if(/Google listing/.test(providerTypes)){roles.add('Caregiver');roles.add('HHA')}
  return [...roles];
}
