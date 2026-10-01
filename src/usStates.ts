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
