// Saved email templates, filled in the browser and opened in the employer's own email app.

export type EmailTemplate={id:string;name:string;subject:string;body:string;builtIn?:boolean};
export type TemplateValues={firstName:string;opening:string;company:string;contactName:string};

export const PLACEHOLDERS:[string,string][]=[['{first_name}','Caregiver’s first name'],['{opening}','Opening title'],['{company}','Your company'],['{my_name}','Your name']];

// Starting points everyone has; saving one under the same name replaces it for that employer.
export const BUILT_IN_TEMPLATES:EmailTemplate[]=[
  {id:'builtin-phone',builtIn:true,name:'Phone screen',subject:'{opening} at {company}',
    body:'Hi {first_name},\n\nThanks for your interest in the {opening} role at {company}. Do you have 10 minutes for a quick call this week? Reply with a couple of times that work, or call me back at your convenience.\n\nThank you,\n{my_name}\n{company}'},
  {id:'builtin-interview',builtIn:true,name:'Interview invite',subject:'Interview for {opening} at {company}',
    body:'Hi {first_name},\n\nWe’d like to invite you to interview for the {opening} role at {company}. Please reply with a day and time that works for you this week, and we’ll confirm.\n\nThank you,\n{my_name}\n{company}'},
  {id:'builtin-followup',builtIn:true,name:'Follow-up',subject:'Checking in about {opening}',
    body:'Hi {first_name},\n\nI wanted to follow up about the {opening} role at {company}. Are you still interested? Just reply to this email and we’ll take the next step.\n\nThank you,\n{my_name}\n{company}'}
];

/** The employer's saved templates first, then any built-in one they haven't replaced with a template of the same name. */
export function mergeTemplates(saved:EmailTemplate[]){
  const names=new Set(saved.map(t=>t.name.trim().toLowerCase()));
  return [...saved,...BUILT_IN_TEMPLATES.filter(t=>!names.has(t.name.toLowerCase()))];
}

export function fillTemplate(text:string,v:TemplateValues){
  return text
    .replace(/\{first_name\}/g,v.firstName||'there')
    .replace(/\{opening\}/g,v.opening||'caregiver')
    .replace(/\{company\}/g,v.company||'')
    .replace(/\{my_name\}/g,v.contactName||'')
    .replace(/\n{3,}/g,'\n\n').trim();
}

export function templateMailto(email:string,t:Pick<EmailTemplate,'subject'|'body'>,v:TemplateValues){
  return 'mailto:'+encodeURIComponent(email).replace(/%40/g,'@')+'?subject='+encodeURIComponent(fillTemplate(t.subject,v))+'&body='+encodeURIComponent(fillTemplate(t.body,v));
}
