// Whether a caregiver's typed location can be trusted next to their ZIP. Shared by employer search (no mileage, or
// left out) and the caregiver's dashboard (asked to confirm their location).
import { usState } from './usStates';

type Row=Record<string,unknown>;
const text=(v:unknown)=>typeof v==='string'?v.trim():'';

/**
 * A caregiver's distance is computed from their ZIP alone. When the state they typed is not a US state ("South
 * Africa") or is a different state than the ZIP's, the ZIP is not where they are, so no distance is shown.
 */
export function locationMatchesZip(c:Row){
  const typed=text(c.state);
  const zipState=text(c.geo_state).toUpperCase();
  if(!typed||!zipState)return true;
  const state=usState(typed);
  return !!state&&state.code===zipState;
}

/** For now the network is US-only: a caregiver whose typed state is not a US state is left out. Blank counts as US. */
export function inUs(c:Row){
  const typed=text(c.state);
  return !typed||!!usState(typed);
}

