// CareJoys shows its own short AI summary of each job, never the employer's posting text (Rebecca, 2026-10-08).
// Summaries are written by Workers AI from the crawled description and stored on the job row.

type Row=Record<string,unknown>;
type DB={prepare(sql:string):{bind(...v:unknown[]):{all<T=Row>():Promise<{results?:T[]}>;run():Promise<unknown>}}};
export type AiBinding={run(model:string,input:Record<string,unknown>):Promise<unknown>};
export type SummaryEnv={DB?:DB;AI?:AiBinding;JOB_SUMMARY_MODEL?:string};

export const DEFAULT_SUMMARY_MODEL='@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';

const SYSTEM=`You write short, original summaries of caregiver job postings for a job board.
Rules:
- Use your own words. Never copy a sentence or phrase of more than five words from the posting.
- Only state facts the posting gives. Do not guess or add anything.
- Leave out pay (shown separately), equal opportunity statements, company slogans and calls to apply.
- Plain, friendly English a caregiver can scan on a phone.
Format exactly:
First line: one or two sentences (at most 40 words) saying what the job is and who it serves.
Then 3 to 6 lines, each starting with "- ", covering duties, requirements, schedule and benefits (at most 14 words each).
No headings, no other text.`;

/** "overview\n- a\n- b" from the model, as the "lead • bullet • bullet" text the job page already renders. */
export function parseSummary(raw:string){
  const lines=raw.replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean)
    .filter(l=>!/^(here is|here's|summary:?$|overview:?$)/i.test(l));
  const bullets:string[]=[];let lead='';
  for(const line of lines){
    const b=line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if(b){if(b[1].trim())bullets.push(b[1].trim().replace(/[•]/g,''))}
    else if(!lead)lead=line.replace(/[•]/g,'');
  }
  if(!lead||lead.length<20)return '';
  return [lead.slice(0,400),...bullets.slice(0,6).map(b=>b.slice(0,160))].join(' • ');
}

export async function summarizeJob(env:SummaryEnv,job:{title:string;employer:string;description:string}){
  const out=await env.AI!.run(clean(env.JOB_SUMMARY_MODEL,120)||DEFAULT_SUMMARY_MODEL,{
    messages:[{role:'system',content:SYSTEM},{role:'user',content:`Job title: ${job.title}\nEmployer: ${job.employer}\n\nPosting:\n${job.description.slice(0,6000)}`}],
    max_tokens:350,temperature:0.3
  }) as {response?:string};
  return parseSummary(clean(out?.response,4000));
}

/**
 * Summarizes live jobs that have no summary yet, or whose description changed length since.
 * A failure is recorded and retried a day later, so a bad posting can't eat every run.
 */
export async function summarizeJobsBatch(env:SummaryEnv,limit:number){
  if(!env.DB||!env.AI||limit<1)return {attempted:0,summarized:0,failed:0};
  const rows=await env.DB.prepare(`SELECT id,title,employer_name,description_text FROM caregiver_jobs
    WHERE is_published=1 AND status='current' AND length(COALESCE(description_text,''))>=80
      AND (summary_source_len IS NULL OR summary_source_len!=length(description_text))
      AND (summary_error IS NULL OR datetime(summarized_at)<datetime('now','-1 day'))
    ORDER BY COALESCE(date_posted,first_seen_at) DESC LIMIT ?`).bind(limit).all<Row>();
  let summarized=0,failed=0;
  for(const row of rows.results||[]){
    const description=clean(row.description_text,8000);
    try{
      const summary=await summarizeJob(env,{title:clean(row.title,200),employer:clean(row.employer_name,200),description});
      if(!summary)throw new Error('empty summary');
      await env.DB.prepare("UPDATE caregiver_jobs SET summary_text=?,summary_source_len=?,summary_error=NULL,summarized_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(summary,description.length,row.id).run();
      summarized++;
    }catch(error){
      failed++;
      await env.DB.prepare("UPDATE caregiver_jobs SET summary_error=?,summarized_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind((error instanceof Error?error.message:'summary failed').slice(0,300),row.id).run();
    }
  }
  return {attempted:(rows.results||[]).length,summarized,failed};
}
