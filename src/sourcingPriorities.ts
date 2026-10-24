// Where job scanning goes first: agencies in the cities whose job pages matter most are scanned before everyone
// else's. A city gets an indexable /cna-jobs page at 10 current CNA jobs (CNA_PAGE_MIN_JOBS), so this list covers
// the pages being submitted to Google now, the ones closest to unlocking, and the thin ones that could drop out.
// From the city SEO plan, 2026-10-20. A city with a metro in metros.ts also matches its suburbs and boroughs.

import { METROS } from './metros';

type Target=[state:string,city:string,why:string];

export const SOURCING_TARGETS:Target[]=[
  // Day 1: the CNA city pages submitted first.
  ['NV','Las Vegas','Day 1 CNA page'],['TX','Houston','Day 1 CNA page'],['CA','Los Angeles','Day 1 CNA page, 11 CNA jobs'],
  ['CA','San Diego','Day 1 CNA page, 12 CNA jobs'],['CA','Sacramento','Day 1 CNA page'],['FL','Jacksonville','Day 1 CNA page'],
  ['WA','Seattle','Day 1 CNA page'],['NE','Omaha','Day 1 CNA page'],['MD','Baltimore','Day 1 CNA page'],['TX','Dallas','Day 1 CNA page'],
  // Day 2: the next CNA pages.
  ['OR','Portland','Day 2 CNA page'],['AZ','Phoenix','Day 2 CNA page'],['CO','Colorado Springs','Day 2 CNA page'],['MN','Minneapolis','Day 2 CNA page'],
  // CNA pages a few jobs short of unlocking, by the searches each would capture.
  ['NY','New York','2 CNA jobs short across the five boroughs'],['IL','Chicago','9 CNA jobs short'],
  ['CA','Fresno','1 CNA job short'],['CA','San Jose','1 CNA job short'],['NC','Charlotte','3 CNA jobs short'],
  ['WI','Milwaukee','3 CNA jobs short'],['TX','San Antonio','2 CNA jobs short'],['FL','Orlando','6 to 10 CNA jobs short'],
  ['TN','Memphis','6 to 10 CNA jobs short'],
  // Thin CNA pages one or two expired listings from dropping out.
  ['CA','Bakersfield','10 CNA jobs, protect'],['GA','Atlanta','10 CNA jobs, protect'],
  // Days 3 and 4: caregiver city pages not already above.
  ['AZ','Tucson','Day 3 caregiver page'],['PA','Philadelphia','Day 3 caregiver page'],
  ['TX','Fort Worth','Day 4 caregiver page'],['TX','Austin','Day 4 caregiver page'],
];

// Where the paid careers-page search goes first: the CNA city pages that fell under the 10-job line after the
// 2026-10-23 duplicate cleanup, fewest jobs first, then the pages being built now. From the SEO thread, 2026-10-23.
// The search takes one agency per city in turn, so every city here gains ground each day.
export const CAREERS_LOOKUP_TARGETS:Target[]=[
  ['CA','San Diego','0 CNA jobs'],['CA','Bakersfield','0 CNA jobs'],['CA','San Jose','0 CNA jobs'],
  ['AZ','Phoenix','1 CNA job'],['NE','Lincoln','1 CNA job'],['CO','Colorado Springs','2 CNA jobs'],['CA','Fresno','2 CNA jobs'],
  ['OR','Portland','3 CNA jobs'],['IL','Chicago','3 CNA jobs'],['WA','Seattle','4 CNA jobs'],['MN','Minneapolis','4 CNA jobs'],
  ['NY','New York','7 CNA jobs across the five boroughs'],['CA','Sacramento','8 CNA jobs'],['NV','Las Vegas','Day 1 CNA page'],
];

const sqlText=(v:string)=>"'"+v.replace(/'/g,"''")+"'";
const placesFor=(state:string,city:string)=>{
  const metro=METROS.find(m=>m.state===state&&m.name.toLowerCase().startsWith(city.toLowerCase()));
  return metro?metro.places:[city];
};

/**
 * An ORDER BY term (lower is sooner) ranking an agency by the first target its state and city match; others rank last.
 * The places are constants, so they are written into the SQL rather than bound: D1 allows only 100 bound values.
 */
export function sourcingRankSql(stateCol:string,cityCol:string,targets:Target[]=SOURCING_TARGETS){
  const whens=targets.map(([state,city],i)=>
    `WHEN ${stateCol}=${sqlText(state)} AND lower(trim(COALESCE(${cityCol},''))) IN (${placesFor(state,city).map(p=>sqlText(p.toLowerCase())).join(',')}) THEN ${i}`);
  return `CASE ${whens.join(' ')} ELSE ${targets.length} END`;
}
