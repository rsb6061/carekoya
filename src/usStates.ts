// Shared by the Worker and the browser bundle, so it must stay free of server-only imports.
export const US_STATES:ReadonlyArray<readonly [code:string,name:string]>=[
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],
  ['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],
  ['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
  ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],
  ['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],
  ['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],
  ['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],
  ['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']
];

export type UsState={code:string;name:string;slug:string};

export const slugify=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

const BY_SLUG=new Map<string,UsState>(US_STATES.map(([code,name])=>[slugify(name),{code,name,slug:slugify(name)}]));
const BY_CODE=new Map<string,UsState>([...BY_SLUG.values()].map(s=>[s.code,s]));

/** Accepts a URL slug ("new-york") or a two-letter code ("NY"). */
export function usState(value:string|null|undefined):UsState|null{
  const v=String(value||'').trim();
  if(!v)return null;
  return BY_CODE.get(v.toUpperCase())||BY_SLUG.get(slugify(v))||null;
}

/** `/caregiver-jobs/{state}[/{city}]` → its parts, or null for any other path. */
export function parseJobsHubPath(pathname:string){
  const m=pathname.match(/^\/caregiver-jobs\/([^/]+)(?:\/([^/]+))?\/?$/);
  if(!m)return null;
  const state=usState(decodeURIComponent(m[1]));
  if(!state||slugify(decodeURIComponent(m[1]))!==state.slug)return null;
  return {state,citySlug:m[2]?slugify(decodeURIComponent(m[2])):''};
}

export const jobsHubPath=(state:UsState,citySlug='')=>'/caregiver-jobs/'+state.slug+(citySlug?'/'+citySlug:'');

// USPS three-digit ZIP prefixes per state (territories and military prefixes are left out).
const ZIP3_RANGES:ReadonlyArray<readonly [from:number,to:number,code:string]>=[
  [5,5,'NY'],[10,27,'MA'],[28,29,'RI'],[30,38,'NH'],[39,49,'ME'],[50,59,'VT'],[60,69,'CT'],[70,89,'NJ'],
  [100,149,'NY'],[150,196,'PA'],[197,199,'DE'],[200,200,'DC'],[201,201,'VA'],[202,205,'DC'],[206,219,'MD'],
  [220,246,'VA'],[247,268,'WV'],[270,289,'NC'],[290,299,'SC'],[300,319,'GA'],[320,339,'FL'],[341,349,'FL'],
  [350,369,'AL'],[370,385,'TN'],[386,397,'MS'],[398,399,'GA'],[400,427,'KY'],[430,458,'OH'],[460,479,'IN'],
  [480,499,'MI'],[500,528,'IA'],[530,549,'WI'],[550,567,'MN'],[569,569,'DC'],[570,577,'SD'],[580,588,'ND'],
  [590,599,'MT'],[600,629,'IL'],[630,658,'MO'],[660,679,'KS'],[680,693,'NE'],[700,714,'LA'],[716,729,'AR'],
  [730,732,'OK'],[733,733,'TX'],[734,749,'OK'],[750,799,'TX'],[800,816,'CO'],[820,831,'WY'],[832,838,'ID'],
  [840,847,'UT'],[850,865,'AZ'],[870,884,'NM'],[885,885,'TX'],[889,898,'NV'],[900,961,'CA'],[967,968,'HI'],
  [970,979,'OR'],[980,994,'WA'],[995,999,'AK']
];

/** Two-letter state code for a US ZIP, or '' when the prefix isn't a state. */
export function stateForZipPrefix(zip:string|null|undefined){
  const m=String(zip||'').match(/^\s*(\d{5})/);
  if(!m)return '';
  const n=Number(m[1].slice(0,3));
  return ZIP3_RANGES.find(([from,to])=>n>=from&&n<=to)?.[2]||'';
}
