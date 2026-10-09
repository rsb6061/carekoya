/** Hourly minimum only; annual salaries and ambiguous values are not silently treated as hourly. */
export function hourlyPayFloor(value:unknown):number|null{
  if(typeof value==='number')return Number.isFinite(value)&&value>=0&&value<=200?Math.round(value*100)/100:null;
  if(typeof value!=='string')return null;
  const s=value.trim().toLowerCase();
  if(!s)return null;
  const found=s.match(/^\$?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:[-–—]\s*\$?\s*\d{1,3}(?:\.\d{1,2})?)?\s*\+?\s*(?:(?:\/\s*(?:hr|hour|hourly))|(?:per\s+hour)|hourly)?$/);
  if(!found)return null;
  const n=Number(found[1]);
  return Number.isFinite(n)&&n>=0&&n<=200?Math.round(n*100)/100:null;
}
