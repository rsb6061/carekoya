// Screening an agency's own applicants: one short question list per agency (yes/no and short-answer), the answers
// saved on each applicant, and which answers rule someone out. Caregiver screens turn on facts (certificate, a car,
// shifts, pay, area), so this is a checklist an operator fills from a call now, and texts can ask later.
// Shared by the Worker and the browser bundle: no server-only imports.

type Row=Record<string,unknown>;
type Statement={bind(...values:unknown[]):Statement;run():Promise<{success:boolean;meta?:Record<string,unknown>}>;first<T=Row>():Promise<T|null>};
type Db={prepare(query:string):Statement};

export type ScreeningQuestion={id:string;label:string;type:'yes_no'|'text';
  /** For a yes/no question: the answer that rules the applicant out for this agency. */
  knockout?:'yes'|'no'};
export type ScreeningAnswers=Record<string,string>;

export const MAX_SCREENING_QUESTIONS=20;

/** The starting list for a home-care agency. Each agency edits its own copy. */
export const DEFAULT_SCREENING_QUESTIONS:ScreeningQuestion[]=[
  {id:'certified',label:'Are you a CNA or GNA?',type:'yes_no'},
  {id:'certificate',label:'Certificate or registry number',type:'text'},
  {id:'car',label:'Do you have a reliable car to get to clients?',type:'yes_no',knockout:'no'},
  {id:'background',label:'Can you pass a background check?',type:'yes_no',knockout:'no'},
  {id:'shifts',label:'Which shifts can you work? (days, evenings, overnights, weekends)',type:'text'},
  {id:'hours',label:'How many hours a week do you want?',type:'text'},
  {id:'pay',label:'Lowest hourly pay you’d take',type:'text'},
  {id:'area',label:'Where do you live? (city or ZIP)',type:'text'},
  {id:'start',label:'When can you start?',type:'text'},
];

const clean=(v:unknown,max=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
const slug=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40);

/** A question list as saved: labels required, ids unique and stable, knockouts only on yes/no questions. */
export function cleanQuestions(input:unknown):ScreeningQuestion[]|null{
  if(!Array.isArray(input))return null;
  const used=new Set<string>();
  const out:ScreeningQuestion[]=[];
  for(const raw of input.slice(0,MAX_SCREENING_QUESTIONS)){
    const q=(raw||{}) as Row;
    const label=clean(q.label,200);
    if(!label)continue;
    const type=q.type==='yes_no'?'yes_no':'text';
    let id=slug(clean(q.id,40))||slug(label)||'q';
    for(let n=2;used.has(id);n++)id=slug(clean(q.id,40)||label).slice(0,36)+'_'+n;
    used.add(id);
    const knockout=type==='yes_no'&&(q.knockout==='yes'||q.knockout==='no')?q.knockout:undefined;
    out.push(knockout?{id,label,type,knockout}:{id,label,type});
  }
  return out;
}

/** Answers kept to the agency's questions, trimmed; yes/no answers only "yes" or "no". */
export function cleanAnswers(questions:ScreeningQuestion[],input:unknown):ScreeningAnswers{
  const raw=(input&&typeof input==='object'?input:{}) as Row;
  const out:ScreeningAnswers={};
  for(const q of questions){
    const v=clean(raw[q.id],300);
    if(!v)continue;
    if(q.type==='yes_no'){if(v==='yes'||v==='no')out[q.id]=v}
    else out[q.id]=v;
  }
  return out;
}

/** The questions whose answer rules this applicant out. */
export function knockoutsFor(questions:ScreeningQuestion[],answers:ScreeningAnswers){
  return questions.filter(q=>q.knockout&&answers[q.id]===q.knockout).map(q=>q.label);
}

export function parseQuestions(json:unknown):ScreeningQuestion[]{
  try{return cleanQuestions(JSON.parse(String(json||'')))||DEFAULT_SCREENING_QUESTIONS}catch{return DEFAULT_SCREENING_QUESTIONS}
}

export async function screeningQuestions(db:Db,employerId:string){
  const row=await db.prepare('SELECT questions_json,updated_by,updated_at FROM agency_screening_questions WHERE employer_id=?').bind(employerId).first<Row>();
  return {questions:row?parseQuestions(row.questions_json):DEFAULT_SCREENING_QUESTIONS,isDefault:!row,updatedBy:clean(row?.updated_by,320),updatedAt:clean(row?.updated_at,40)};
}

export async function saveScreeningQuestions(db:Db,employerId:string,input:unknown,by:string){
  const questions=cleanQuestions(input);
  if(!questions||!questions.length)return {ok:false as const,error:'Add at least one question.'};
  await db.prepare(`INSERT INTO agency_screening_questions(employer_id,questions_json,updated_by,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(employer_id) DO UPDATE SET questions_json=excluded.questions_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(employerId,JSON.stringify(questions),clean(by,320)||null).run();
  return {ok:true as const,...await screeningQuestions(db,employerId)};
}
