// A short, plain-words reason a matched caregiver fits an opening, built only from the match reasons and what the
// caregiver put on their profile. Nothing here is inferred or scored beyond that.

export type FitInput={
  name:string;reasons:string[];
  profile?:{role?:string;certifications?:string;yearsExperience?:number;specialties?:string;languages?:string;startAvailability?:string;transportation?:string;checklist?:string[]};
};

const START:Record<string,string>={now:'can start right away','2_weeks':'can start within 2 weeks','1_month':'can start within a month'};
const firstName=(name:string)=>(name||'').trim().split(/\s+/)[0]||'This caregiver';
const list=(items:string[])=>items.length<=1?items.join(''):items.slice(0,-1).join(', ')+' and '+items[items.length-1];

export function fitSummary({name,reasons,profile:p={}}:FitInput):string{
  const who=firstName(name);
  const has=(r:string)=>reasons.includes(r);
  const distance=reasons.find(r=>/ mi away$|^within 1 mi$/.test(r));
  const shifts=reasons.find(r=>/^available (all \d+ shifts|for the shift|\d+ of \d+ shifts)$/.test(r));
  const sentences:string[]=[];

  const credential=p.role||(p.certifications||'').split(',')[0]?.trim()||'';
  const what=has('role match')?(credential?'is a '+credential:'holds the role'):has('related credential')?(credential?'is a '+credential+' (a related credential)':'holds a related credential'):'';
  const where=distance?(distance==='within 1 mi'?'lives within a mile of this opening':'lives '+distance.replace(' away','')+' from this opening'):has('same ZIP')?'lives in this opening’s ZIP':has('same city')?'lives in this opening’s city':'';
  const first=[what,where].filter(Boolean);
  if(first.length)sentences.push(who+' '+list(first)+'.');

  const fit:string[]=[];
  if(shifts)fit.push('is '+shifts.replace(/^available (all|\d)/,'available for $1'));
  else if(has('schedule does not overlap'))fit.push('has weekly availability that doesn’t line up with this schedule');
  if(has('open to live-in'))fit.push('is open to live-in work');
  if(START[p.startAvailability||''])fit.push(START[p.startAvailability!]);
  if(fit.length)sentences.push(who+' '+list(fit)+'.');

  const background:string[]=[];
  if(p.yearsExperience)background.push(p.yearsExperience+(p.yearsExperience===1?' year':' years')+' of experience');
  const skills=(p.specialties||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,2);
  if(skills.length)background.push(list(skills));
  const languages=(p.languages||'').split(',').map(x=>x.trim()).filter(x=>x&&x!=='English');
  if(languages.length)background.push('speaks '+list(languages));
  if(background.length)sentences.push('Profile: '+background.join('; ')+'.');

  if(has('recently confirmed'))sentences.push(who+' confirmed this week that they’re looking for work.');
  else if(has('older availability'))sentences.push(who+' hasn’t confirmed availability recently, so check they’re still looking.');
  return sentences.join(' ');
}
