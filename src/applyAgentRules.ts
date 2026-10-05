// "Apply for me": which employer job sites CareJoys can fill in for a caregiver, and which questions it may
// answer from their profile. Ported from JobPlots' candidate-directed Apply agent (same safety rules):
// it runs only when the caregiver clicks, stays on the employer's own job site, never answers demographic,
// criminal-history or legal questions, and hands the browser to the caregiver for CAPTCHAs, logins and signatures.

export type ApplyProvider="paylocity"|"ashby"|"isolved"|"greenhouse"|"lever"|"icims"|"careerplug"|"jazzhr";

export type ApplyAnswerKey=
  |"firstName"|"lastName"|"fullName"|"email"|"phone"|"streetAddress"|"city"|"state"|"postalCode"|"country"|"locationText"
  |"applicationSource"|"applicationSourceDetail"|"workAuthorizationUs"|"requiresSponsorship"|"earliestStartDate"
  |"employmentPreference"|"desiredPay"|"yearsExperience"|"certifications"|"cnaCertified"|"cprCertified"
  |"reliableTransportation"|"driversLicense"|"languages"|"over18";

/** Everything CareJoys knows about the caregiver for filling in a form: profile fields plus remembered answers. */
export type ApplyProfile=Partial<Record<ApplyAnswerKey,string|boolean|number|null>>;

/** Keys a caregiver's answer may be remembered for (the rest come from their CareJoys profile). */
export const REMEMBERABLE_KEYS:ApplyAnswerKey[]=["streetAddress","workAuthorizationUs","requiresSponsorship","earliestStartDate",
  "employmentPreference","driversLicense","over18","reliableTransportation","cnaCertified","cprCertified"];

export function answerValueKind(key:ApplyAnswerKey):"boolean"|"number"|"date"|"text"{
  if(["workAuthorizationUs","requiresSponsorship","cnaCertified","cprCertified","reliableTransportation","driversLicense","over18"].includes(key))return "boolean";
  if(key==="yearsExperience")return "number";
  if(key==="earliestStartDate")return "date";
  return "text";
}

export interface QuestionClassification{
  key:ApplyAnswerKey|null;
  reusePolicy:"auto"|"confirm_each_time"|"never_auto";
  sensitive:boolean;
  attestation:boolean;
}

const normalized=(value:string)=>String(value||"").toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ").trim();

export function detectApplyProvider(rawUrl:string|null|undefined):ApplyProvider|null{
  if(!rawUrl)return null;
  try{
    const url=new URL(rawUrl);
    const host=url.hostname.toLowerCase();
    if(host==="recruiting.paylocity.com")return "paylocity";
    if(host==="jobs.ashbyhq.com")return "ashby";
    if(host.endsWith(".isolvedhire.com"))return "isolved";
    if(host==="boards.greenhouse.io"||host==="job-boards.greenhouse.io")return "greenhouse";
    if(host==="jobs.lever.co")return "lever";
    if(host.endsWith(".icims.com"))return "icims";
    // Only a single CareerPlug posting (/jobs/123...), not a company's job list or account page.
    if(host.endsWith(".careerplug.com")&&/^\/jobs\/\d+(\/|$)/.test(url.pathname))return "careerplug";
    // JazzHR postings: /apply/<code>/<title> or /apply/jobs/details/<code>.
    if(host.endsWith(".applytojob.com")&&/^\/apply\/(jobs\/details\/)?[A-Za-z0-9]{6,}(\/|$)/.test(url.pathname))return "jazzhr";
  }catch{}
  return null;
}

/** A plain name for the job site behind a URL, for the admin breakdown (supported or not). */
export function jobSiteName(rawUrl:string|null|undefined){
  try{
    const host=new URL(String(rawUrl||"")).hostname.toLowerCase();
    const known:[RegExp,string][]=[[/paylocity\.com$/,"Paylocity"],[/ashbyhq\.com$/,"Ashby"],[/isolvedhire\.com$/,"isolved"],[/greenhouse\.io$/,"Greenhouse"],
      [/lever\.co$/,"Lever"],[/icims\.com$/,"iCIMS"],[/myworkdayjobs\.com$|workday\.com$/,"Workday"],[/bamboohr\.com$/,"BambooHR"],[/paycomonline\.net$/,"Paycom"],
      [/ultipro\.com$|ukg\.com$/,"UKG"],[/applytojob\.com$|jazz\.co$/,"JazzHR"],[/careerplug\.com$/,"CareerPlug"],[/apploi\.com$/,"Apploi"],[/careconnecthiring\.com$/,"CareConnect"],[/workable\.com$/,"Workable"],[/indeed\.com$/,"Indeed"],
      [/adp\.com$/,"ADP"],[/applicantpro\.com$/,"ApplicantPro"],[/clearcareonline\.com$|wellsky\.com$/,"WellSky"],[/hirebridge\.com$/,"Hirebridge"],[/hiringthing\.com$/,"HiringThing"]];
    for(const [pattern,name] of known)if(pattern.test(host))return name;
    return "Employer's own site";
  }catch{return "No link"}
}

export function allowedApplyNavigation(provider:ApplyProvider,rawUrl:string,applicationUrl?:string){
  try{
    const host=new URL(rawUrl).hostname.toLowerCase();
    const initialHost=applicationUrl?new URL(applicationUrl).hostname.toLowerCase():null;
    if(provider==="paylocity")return host==="recruiting.paylocity.com";
    if(provider==="ashby")return host==="jobs.ashbyhq.com";
    if(provider==="isolved")return host.endsWith(".isolvedhire.com")&&(!initialHost||host===initialHost);
    if(provider==="greenhouse")return host==="boards.greenhouse.io"||host==="job-boards.greenhouse.io";
    if(provider==="lever")return host==="jobs.lever.co";
    // Stay on the employer's own iCIMS portal.
    if(provider==="icims")return host.endsWith(".icims.com")&&(!initialHost||host===initialHost);
    // CareerPlug and JazzHR give each employer its own subdomain; stay on it.
    if(provider==="careerplug")return host.endsWith(".careerplug.com")&&(!initialHost||host===initialHost);
    if(provider==="jazzhr")return host.endsWith(".applytojob.com")&&(!initialHost||host===initialHost);
  }catch{}
  return false;
}

export function applyStartUrl(provider:ApplyProvider,rawUrl:string){
  const url=new URL(rawUrl);
  url.hash="";
  if(provider==="lever"){
    // jobs.lever.co/<company>/<posting> -> the posting's /apply form.
    const parts=url.pathname.split("/").filter(Boolean);
    if(parts.length===2)url.pathname="/"+parts.join("/")+"/apply";
  }
  // iCIMS portals render the job inside an iframe; in_iframe=1 loads the content directly.
  if(provider==="icims")url.searchParams.set("in_iframe","1");
  if(provider==="careerplug"){
    // careerplug.com/jobs/<id> -> the posting's application form at /jobs/<id>/apps/new.
    const m=url.pathname.match(/^\/jobs\/(\d+)/);
    if(m)url.pathname="/jobs/"+m[1]+"/apps/new";
  }
  if(provider==="ashby"){
    const parts=url.pathname.split("/").filter(Boolean);
    if(parts.length>=2&&parts[parts.length-1]?.toLowerCase()!=="application")url.pathname=url.pathname.replace(/\/$/,"")+"/application";
  }
  return url.toString();
}

export function isSensitiveOrAttestation(text:string){
  const value=normalized(text);
  const sensitive=/race|ethnic|gender|sex\b|sexual orientation|disab|veteran|military status|religion|genetic|criminal|convict|arrest|background check|drug test|accommodation|social security|\bssn\b|date of birth|birth date/.test(value);
  const attestation=/\b(?:i\s+)?certify\b|certify that|\battest\b|electronic signature|e signature|signature|i agree|acknowledge|terms and conditions|truthful|accurate and complete|under penalty/.test(value);
  return {sensitive,attestation};
}

// Voluntary EEO self-identification. CareJoys only ever picks the employer's own "decline to answer" option,
// or asks the caregiver; it never remembers these answers.
export type EeoCategory="race"|"hispanic"|"gender"|"veteran"|"disability";
export function eeoCategory(rawText:string):EeoCategory|null{
  const text=normalized(rawText);
  if(/criminal|convict|arrest|background check|drug test|accommodation|religion|genetic/.test(text))return null;
  if(/hispanic|latino|latina|latinx/.test(text))return "hispanic";
  if(/\brace\b|ethnicit/.test(text))return "race";
  if(/gender|\bsex\b/.test(text))return "gender";
  if(/veteran|military status/.test(text))return "veteran";
  if(/disab/.test(text))return "disability";
  return null;
}
export function declineOption(options:string[]){
  return options.find(o=>/decline|prefer not|choose not|do not (wish|want)|don.?t (wish|want)|not to (answer|disclose|self.?identify|identify)|rather not/i.test(o))||null;
}

export function classifyApplicationQuestion(rawText:string):QuestionClassification{
  const text=normalized(rawText);
  const flags=isSensitiveOrAttestation(text);
  if(flags.sensitive||flags.attestation)return {key:null,reusePolicy:"never_auto",sensitive:flags.sensitive,attestation:flags.attestation};
  const rules:Array<[RegExp,ApplyAnswerKey,QuestionClassification["reusePolicy"]]>=[
    [/\bfirst name\b|\bgiven name\b/,"firstName","auto"],
    [/\blast name\b|\bsurname\b|\bfamily name\b/,"lastName","auto"],
    // "Name" / "Your full name", but not "Name of previous employer".
    [/\b(full|legal) name\b|^(your |full |legal )*name\b(?! of| on| as| and)|_systemfield_name/,"fullName","auto"],
    [/\be-?mail\b/,"email","auto"],
    [/\b(phone|mobile|telephone|cell)\b/,"phone","auto"],
    [/\b(street address|address line 1|mailing address|home address)\b/,"streetAddress","auto"],
    [/authorized.*work|work authorization|legally.*work|eligible to work/,"workAuthorizationUs","auto"],
    [/sponsor|sponsorship|visa.*future/,"requiresSponsorship","auto"],
    [/18 years|age of 18|at least 18|over 18/,"over18","auto"],
    [/start date|available to start|earliest.*start|when can you start/,"earliestStartDate","auto"],
    [/full.?time|part.?time|employment type|schedule.*looking/,"employmentPreference","auto"],
    [/desired pay|salary expectation|compensation expectation|pay expectation|minimum pay|pay requirement|salary requirement|expected (pay|salary|wage)|desired (hourly )?(rate|wage)/,"desiredPay","confirm_each_time"],
    [/driver.?s licen[cs]e|valid licen[cs]e to drive/,"driversLicense","auto"],
    [/reliable transportation|own (car|vehicle|transportation)|access to a (car|vehicle)|transportation to/,"reliableTransportation","auto"],
    [/\b(cna|gna|certified nursing assistant|geriatric nursing assistant)\b.*(certif|licen[cs]|active)|(certif|licen[cs]).*\b(cna|gna|nursing assistant)\b/,"cnaCertified","auto"],
    [/\b(cpr|bls)\b/,"cprCertified","auto"],
    [/certifications?|licenses? (held|you hold)|credentials/,"certifications","auto"],
    [/years?.*(experience)|experience.*years?/,"yearsExperience","auto"],
    [/languages? (do you )?speak|languages spoken/,"languages","auto"],
    [/\bcity\b/,"city","auto"],
    [/\b(state|province)\b/,"state","auto"],
    [/\b(zip|postal code)\b/,"postalCode","auto"],
    [/\bcountry\b/,"country","auto"],
    [/current location|where are you located|location \(city|city and state/,"locationText","auto"],
    [/how did you hear|source of application|where did you hear|referral source/,"applicationSource","auto"],
    [/please specify.*(?:source|other)|other.*(?:source|details)/,"applicationSourceDetail","auto"],
  ];
  for(const [pattern,key,reusePolicy] of rules)if(pattern.test(text))return {key,reusePolicy,sensitive:false,attestation:false};
  return {key:null,reusePolicy:"never_auto",sensitive:false,attestation:false};
}

export function applyAnswer(profile:ApplyProfile,key:ApplyAnswerKey):string|boolean|number|null{
  switch(key){
    case "fullName":return [profile.firstName,profile.lastName].filter(Boolean).join(" ")||null;
    case "country":return profile.state?"United States":null;
    case "locationText":return [profile.city,profile.state].filter(Boolean).join(", ")||null;
    case "applicationSource":return "Other";
    case "applicationSourceDetail":return "CareJoys";
    default:{const v=profile[key];return v===undefined?null:v}
  }
}

/** The caregiver's CareJoys profile as form answers. Remembered answers fill the rest. */
export function applyProfileFromCaregiver(c:Record<string,unknown>,remembered:Record<string,string>):ApplyProfile{
  const text=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():null;
  const certs=text(c.certifications)||"";
  const bool=(v:string|undefined)=>v===undefined?undefined:v==="true"?true:v==="false"?false:undefined;
  const profile:ApplyProfile={
    firstName:text(c.first_name),lastName:text(c.last_name),email:text(c.email),phone:text(c.phone),
    city:text(c.city),state:text(c.state),postalCode:text(c.zip),
    yearsExperience:c.years_experience==null||c.years_experience===""?null:Number(c.years_experience),
    certifications:certs||null,languages:text(c.languages),
    // Credentials the profile names count as a yes; a missing one is asked, never assumed to be a no.
    cnaCertified:/\b(cna|gna)\b/i.test(certs)?true:null,
    cprCertified:/\b(cpr|bls)\b/i.test(certs)?true:null,
    reliableTransportation:/car|vehicle|own|drive/i.test(String(c.transportation||""))?true:null,
  };
  for(const key of REMEMBERABLE_KEYS){
    const raw=remembered[key];
    if(raw===undefined||profile[key]!=null)continue;
    profile[key]=answerValueKind(key)==="boolean"?bool(raw)??null:raw;
  }
  return profile;
}
