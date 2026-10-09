/** Canonical hourly minimum from a numeric profile field or a legacy free-text wage. */
export function parseHourlyMinimum(value:unknown):number|null{
  if(typeof value==='number')return Number.isFinite(value)&&value>0&&value<=200?value:null;
  if(typeof value!=='string')return null;
  const text=value.trim().toLowerCase();
  if(!text||/\b(negotiable|any|flexible|open|market)\b/.test(text))return null;
  // Never treat salary, weekly or monthly amounts as an hourly rate.
  if(/\b(year|yearly|annual|salary|week|weekly|month|monthly|day|daily|shift)\b|\/(?:yr|wk|mo|day)\b/.test(text))return null;
  const match=text.match(/(?:^|[^\d])\$?\s*(\d{1,3}(?:\.\d{1,2})?)(?!\d)/);
  if(!match)return null;
  const minimum=Number(match[1]);
  return Number.isFinite(minimum)&&minimum>0&&minimum<=200?minimum:null;
}

export function minimumHourlyPay(candidate:Record<string,unknown>):number|null{
  return parseHourlyMinimum(candidate.hourly_rate_min)??parseHourlyMinimum(candidate.desired_wage);
}

/** Exclude disclosed underpayment; unknown or nonhour pay must not be labeled a confirmed match. */
export function jobMeetsPayFloor(candidate:Record<string,unknown>,job:Record<string,unknown>):boolean{
  const minimum=minimumHourlyPay(candidate);
  if(minimum===null)return true;
  const period=typeof job.pay_period==='string'?job.pay_period.trim().toLowerCase():'';
  if(period&&!/^(hour|hourly|hr|per.hour)$/.test(period))return true;
  const statedMax=Number(job.pay_max||job.pay_min||0);
  return !Number.isFinite(statedMax)||statedMax===0||statedMax>=minimum;
}
