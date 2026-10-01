import type { FeatureEnv } from './serverFeatures';
import {
  MAX_TARGETS, REACHABLE_AGENCY_SQL, confirmPreparedRequest, interestRequestStatus, prepareInterestRequest, resolveTargets, validateProfile
} from './agencyInbox';

// Public MCP server for AI assistants (Claude, ChatGPT): stateless Streamable HTTP, JSON responses, no sign-in.
// Searching is read-only. Sending a caregiver's profile takes three steps, and the last one is the caregiver's:
// prepare (checks and holds it), confirm (after the caregiver agrees, emails them a Send link), and the caregiver
// pressing Send on /confirm-interest. No agency hears anything from an assistant alone.

type Row=Record<string,unknown>;
const ORIGIN='https://carejoys.com';
export const MCP_PATH='/api/mcp';
export const MCP_VERSION='1.0.0';
export const MCP_PROTOCOL_VERSIONS=['2025-11-25','2025-06-18','2025-03-26'];
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):typeof v==='number'?String(v).slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:0};

// Assistants call from their servers (no Origin). Browsers must come from CareJoys, a known assistant, or a
// local tool such as MCP Inspector; anything else is refused, as the MCP transport spec requires.
const MCP_ORIGIN=/^(https:\/\/([a-z0-9-]+\.)*(carejoys\.com|claude\.ai|claude\.com|anthropic\.com|chatgpt\.com|openai\.com)|https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)$/i;
export const mcpOriginAllowed=(origin:string|null)=>!origin||MCP_ORIGIN.test(origin);
function mcpCors(origin:string|null):Record<string,string>{
  if(!origin||!MCP_ORIGIN.test(origin))return {};
  return {
    'access-control-allow-origin':origin,vary:'origin',
    'access-control-allow-methods':'POST, GET, OPTIONS',
    'access-control-allow-headers':'content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id',
    'access-control-expose-headers':'mcp-session-id, mcp-protocol-version',
    'access-control-max-age':'86400'
  };
}
const plain=(value:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}
});

const READ={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const tool=(name:string,title:string,description:string,properties:Row,required:string[],annotations:Row)=>({
  name,title,description,inputSchema:{type:'object',additionalProperties:false,properties,required},annotations:{title,...annotations}
});
const ROLES=['CNA','GNA','HHA','PCA','DSP','Caregiver','Companion','Other'];
const tokenHelp='The requestToken returned by confirm_job_interest.';

export const MCP_TOOLS=[
  tool('search_caregiver_jobs','Search caregiver jobs',
    'Find current caregiver, CNA, GNA, HHA and PCA jobs at home-care agencies that CareJoys checked on the agency\'s own careers page. Coverage is Maryland today. Each job has the CareJoys page and the agency\'s own application link; canSendProfile says whether CareJoys can send the caregiver\'s profile to that agency. Show the caregiver the options; pass the job ids they pick to prepare_job_interest.',
    {
      role:{type:'string',description:'CNA, GNA, HHA, PCA, DSP or Caregiver.'},
      city:{type:'string',description:'City name, e.g. "Baltimore".'},
      zip:{type:'string',pattern:'^\\d{5}$',description:'5-digit ZIP; jobs in the same ZIP area come first.'},
      pay_min:{type:'number',minimum:0,description:'Lowest acceptable hourly pay in USD. Jobs without published pay are kept.'},
      limit:{type:'integer',minimum:1,maximum:20,default:10}
    },[],READ),
  tool('get_caregiver_job','Get a caregiver job',
    'One job\'s full details: description, pay, employment type, when CareJoys last confirmed it on the agency\'s site, and the application link.',
    {job_id:{type:'string',description:'id from search_caregiver_jobs.'}},['job_id'],READ),
  tool('find_hiring_agencies','Find hiring agencies',
    'Home-care agencies near a ZIP or city with open caregiver jobs or a hiring signal, most open jobs first. Pass agency ids to prepare_job_interest to send the caregiver\'s profile to an agency without a specific job.',
    {
      city:{type:'string'},
      zip:{type:'string',pattern:'^\\d{5}$'},
      role:{type:'string',description:'Only agencies with open jobs for this role.'},
      limit:{type:'integer',minimum:1,maximum:20,default:10}
    },[],READ),
  tool('prepare_job_interest','Prepare to send a caregiver profile',
    `Check the caregiver's details and chosen jobs or agencies (up to ${MAX_TARGETS}) and prepare to send their profile, without contacting anyone. Returns a 15-minute confirmation_token and a summary: show the summary (agencies, jobs, name, email, phone) and ask the caregiver to confirm before calling confirm_job_interest.`,
    {
      full_name:{type:'string',description:'Caregiver\'s first and last name.'},
      email:{type:'string',format:'email',description:'CareJoys emails this address to confirm before anything is sent.'},
      phone:{type:'string'},
      zip:{type:'string',pattern:'^\\d{5}$'},
      role:{type:'string',enum:ROLES},
      certifications:{type:'array',items:{type:'string'},maxItems:10,description:'e.g. ["CNA","CPR"].'},
      years_experience:{type:'integer',minimum:0,maximum:60},
      shifts:{type:'string',description:'e.g. "Weekdays, overnights".'},
      desired_pay:{type:'string',description:'e.g. "$20/hr".'},
      note:{type:'string',maxLength:1000,description:'Optional short note to the agencies, in the caregiver\'s words.'},
      job_ids:{type:'array',items:{type:'string'},maxItems:MAX_TARGETS,uniqueItems:true,description:'Job ids from search_caregiver_jobs.'},
      agency_ids:{type:'array',items:{type:'string'},maxItems:MAX_TARGETS,uniqueItems:true,description:'Agency ids from find_hiring_agencies, for interest in the agency without a specific job.'}
    },['full_name','email','zip','role'],{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}),
  tool('confirm_job_interest','Email the caregiver to send',
    'Call only after the caregiver explicitly confirms the prepared summary. CareJoys emails the caregiver a link, and their profile goes to the agencies only when they press Send there, so tell them to check their inbox. Keep the returned requestToken for get_interest_status.',
    {confirmation_token:{type:'string'},user_confirmed:{type:'boolean',const:true}},
    ['confirmation_token','user_confirmed'],{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}),
  tool('get_interest_status','Check where a caregiver\'s profile stands',
    'Whether the caregiver has pressed Send yet, and then each agency\'s progress: waiting, reached out, interview, hired, or not moving forward.',
    {request_token:{type:'string',description:tokenHelp}},['request_token'],READ)
];
export const MCP_INSTRUCTIONS='CareJoys lists current caregiver jobs (CNA, GNA, HHA, PCA) at home-care agencies, checked on each agency\'s own careers page; coverage is Maryland today. Search jobs or agencies and show the options. To send the caregiver\'s profile, collect their name, email, ZIP and role, call prepare_job_interest, show the summary, and call confirm_job_interest only after they say yes. CareJoys then emails the caregiver; no agency is contacted until they press Send. Each job also has the agency\'s own application link if the caregiver prefers to apply directly.';

function payText(min:unknown,max:unknown,period:unknown){
  const lo=asNum(min),hi=asNum(max),unit=clean(period,20)||'hour';
  if(!lo&&!hi)return null;
  const per='/'+(unit==='year'?'yr':unit==='week'?'wk':unit==='month'?'mo':unit==='day'?'day':'hr');
  return lo&&hi&&lo!==hi?`$${lo}–$${hi}${per}`:`$${lo||hi}${per}`;
}
function compactJob(r:Row){
  return {
    id:clean(r.id,120),title:clean(r.title,200),role:clean(r.role,80),agency:clean(r.employer_name,200),agencyId:clean(r.agency_organization_id,120),
    location:[clean(r.city,120),clean(r.state,20),clean(r.zip,10)].filter(Boolean).join(', ')||null,
    pay:payText(r.pay_min,r.pay_max,r.pay_period),employmentType:clean(r.employment_type,120)||null,
    postedOn:clean(r.date_posted,10)||null,lastCheckedOn:clean(r.last_checked_at||r.last_seen_at,10)||null,
    url:ORIGIN+'/jobs/'+encodeURIComponent(clean(r.id,120)),applicationUrl:clean(r.source_url,1000)||null,
    canSendProfile:!!asNum(r.reachable)
  };
}
const JOB_COLUMNS="(SELECT "+REACHABLE_AGENCY_SQL+" FROM agency_organizations o WHERE o.id=j.agency_organization_id) AS reachable,j.id,COALESCE(NULLIF(j.normalized_title,''),j.title) AS title,j.role,j.roles_json,j.employer_name,j.agency_organization_id,j.city,j.state,j.zip,j.employment_type,j.pay_min,j.pay_max,j.pay_period,j.source_url,j.date_posted,j.last_seen_at,j.last_checked_at";

type Ctx={request:Request};
const toolHandlers:Record<string,(env:FeatureEnv,args:Row,ctx:Ctx)=>Promise<unknown>>={
  async search_caregiver_jobs(env,args){
    const db=env.DB!;
    const limit=Math.min(20,Math.max(1,Math.round(asNum(args.limit)||10)));
    const role=clean(args.role,40),city=clean(args.city,120),zip=clean(args.zip,10);
    if(zip&&!/^\d{5}$/.test(zip))throw new Error('zip must be a 5-digit ZIP code.');
    let sql=`SELECT ${JOB_COLUMNS} FROM caregiver_jobs j WHERE j.is_published=1 AND j.status='current'`;
    const binds:unknown[]=[];
    if(role){sql+=" AND (lower(j.role)=lower(?) OR lower(COALESCE(j.roles_json,'')) LIKE lower(?))";binds.push(role,'%"'+role+'"%')}
    if(city){sql+=' AND lower(j.city)=lower(?)';binds.push(city)}
    if(zip){sql+=' AND substr(COALESCE(j.zip,\'\'),1,3)=?';binds.push(zip.slice(0,3))}
    if(args.pay_min!=null&&asNum(args.pay_min)>0){sql+=" AND (COALESCE(j.pay_max,j.pay_min) IS NULL OR COALESCE(j.pay_period,'hour')!='hour' OR COALESCE(j.pay_max,j.pay_min)>=?)";binds.push(asNum(args.pay_min))}
    sql+=' ORDER BY '+(zip?'CASE WHEN j.zip=? THEN 0 ELSE 1 END,':'')+"CASE WHEN j.date_posted IS NULL OR j.date_posted='' THEN 1 ELSE 0 END,j.date_posted DESC,j.last_seen_at DESC LIMIT ?";
    if(zip)binds.push(zip);
    binds.push(limit);
    const rows=await db.prepare(sql).bind(...binds).all<Row>();
    const jobs=(rows.results||[]).map(compactJob);
    return {count:jobs.length,jobs,coverage:'Maryland',
      note:jobs.length?undefined:'No current jobs match. Try fewer filters, a nearby city, or find_hiring_agencies to reach agencies that are hiring without a posted job.'};
  },
  async get_caregiver_job(env,args){
    const id=clean(args.job_id,120);
    if(!id)throw new Error('job_id is required.');
    const row=await env.DB!.prepare(`SELECT ${JOB_COLUMNS},j.description_text FROM caregiver_jobs j WHERE j.id=? AND j.is_published=1 AND j.status='current' LIMIT 1`).bind(id).first<Row>();
    if(!row)throw new Error('That job is not open on CareJoys any more. Search again for current jobs.');
    return {...compactJob(row),description:clean(row.description_text,4000).replace(/\s+/g,' ')||null};
  },
  async find_hiring_agencies(env,args){
    const limit=Math.min(20,Math.max(1,Math.round(asNum(args.limit)||10)));
    const city=clean(args.city,120),zip=clean(args.zip,10),role=clean(args.role,40);
    if(zip&&!/^\d{5}$/.test(zip))throw new Error('zip must be a 5-digit ZIP code.');
    const jobFilter=role?" AND (lower(j.role)=lower(?) OR lower(COALESCE(j.roles_json,'')) LIKE lower(?))":'';
    let sql=`SELECT o.id,o.canonical_name,o.city,o.state,o.zip,o.primary_website,o.primary_careers_url,o.current_hiring_signal,o.claimed_employer_id,${REACHABLE_AGENCY_SQL} AS reachable,
        (SELECT COUNT(*) FROM caregiver_jobs j WHERE j.agency_organization_id=o.id AND j.is_published=1 AND j.status='current'${jobFilter}) AS open_jobs
      FROM agency_organizations o WHERE o.is_active=1 AND COALESCE(o.is_test,0)=0`;
    const binds:unknown[]=role?[role,'%"'+role+'"%']:[];
    if(city){sql+=' AND lower(o.city)=lower(?)';binds.push(city)}
    if(zip){sql+=" AND substr(COALESCE(o.zip,''),1,3)=?";binds.push(zip.slice(0,3))}
    sql=`SELECT * FROM (${sql}) WHERE open_jobs>0`+(role?'':" OR current_hiring_signal IN ('hiring','always_hiring')")+' ORDER BY '+(zip?'CASE WHEN zip=? THEN 0 ELSE 1 END,':'')+'open_jobs DESC,canonical_name LIMIT ?';
    if(zip)binds.push(zip);
    binds.push(limit);
    const rows=await env.DB!.prepare(sql).bind(...binds).all<Row>();
    const agencies=(rows.results||[]).map(r=>({
      id:clean(r.id,120),name:clean(r.canonical_name,200),location:[clean(r.city,120),clean(r.state,20)].filter(Boolean).join(', ')||null,
      openJobs:asNum(r.open_jobs),hiringSignal:clean(r.current_hiring_signal,40)||'unknown',
      respondsOnCareJoys:!!r.claimed_employer_id,canSendProfile:!!asNum(r.reachable),website:clean(r.primary_website,500)||null,careersUrl:clean(r.primary_careers_url,500)||null
    }));
    return {count:agencies.length,agencies,coverage:'Maryland',
      note:agencies.length?undefined:'No hiring agencies found there. Try a nearby city or leave out the role.'};
  },
  async prepare_job_interest(env,args,{request}){
    const profile=validateProfile(args);
    const targets=await resolveTargets(env,{jobIds:args.job_ids,agencyIds:args.agency_ids});
    return prepareInterestRequest(env,{profile,targets,note:clean(args.note,1000),clientKey:clientKey(request)});
  },
  async confirm_job_interest(env,args){
    if(args.user_confirmed!==true)throw new Error('Explicit caregiver confirmation is required (user_confirmed: true).');
    return confirmPreparedRequest(env,clean(args.confirmation_token,300));
  },
  async get_interest_status(env,args){
    return interestRequestStatus(env,clean(args.request_token,300));
  }
};
function clientKey(request:Request){
  return request.headers.get('cf-connecting-ip')?.trim()||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
}

const toolResult=(value:unknown)=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
// Our own messages reach the model as written so it can fix the input; database or runtime failures never leak.
const INTERNAL_ERROR=/sql|syntax|column|constraint|d1_|sqlite|undefined|null|is not a function|cannot read/i;
function toolErrorMessage(error:unknown,name:string){
  const message=error instanceof Error?error.message:'';
  if(message&&!INTERNAL_ERROR.test(message))return message;
  console.error('MCP tool failed',name,error);
  return 'Something went wrong at CareJoys. Try again, or use https://carejoys.com/caregiver-jobs/maryland.';
}
export function negotiateProtocol(requested:unknown){
  return MCP_PROTOCOL_VERSIONS.includes(String(requested||''))?String(requested):MCP_PROTOCOL_VERSIONS[0];
}

export async function handleMcp(request:Request,env:FeatureEnv){
  const origin=request.headers.get('origin');
  const cors=mcpCors(origin);
  const send=(value:unknown,status=200)=>plain(value,status,cors);
  const rpc=(id:unknown,result:unknown)=>send({jsonrpc:'2.0',id:id??null,result});
  const rpcError=(id:unknown,code:number,message:string,status=200)=>send({jsonrpc:'2.0',id:id??null,error:{code,message}},status);
  if(!mcpOriginAllowed(origin))return plain({error:'Origin not allowed.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return plain({error:'CareJoys MCP uses Streamable HTTP POST requests at this endpoint. Setup: '+ORIGIN+'/agent'},405,{allow:'POST, OPTIONS',...cors});
  if(!env.DB)return rpcError(null,-32603,'CareJoys is not available right now.',503);
  let body:any;
  try{body=JSON.parse(await request.text())}
  catch{return rpcError(null,-32700,'Parse error',400)}
  const accepted=()=>new Response(null,{status:202,headers:cors});
  if(!body||typeof body!=='object'||Array.isArray(body)||body.jsonrpc!=='2.0')return rpcError(body?.id,-32600,'Invalid Request');
  // Notifications and responses from the client need no answer.
  if(typeof body.method!=='string')return 'result' in body||'error' in body?accepted():rpcError(body.id,-32600,'Invalid Request');
  if(body.id===undefined||body.method.startsWith('notifications/'))return accepted();
  const id=body.id;
  try{
    if(body.method==='initialize')return rpc(id,{
      protocolVersion:negotiateProtocol(body.params?.protocolVersion),capabilities:{tools:{listChanged:false}},
      serverInfo:{name:'CareJoys',title:'CareJoys caregiver jobs',version:MCP_VERSION,websiteUrl:ORIGIN+'/agent'},instructions:MCP_INSTRUCTIONS
    });
    if(body.method==='ping')return rpc(id,{});
    if(body.method==='tools/list')return rpc(id,{tools:MCP_TOOLS});
    if(body.method!=='tools/call')return rpcError(id,-32601,'Method not found');
    const name=String(body.params?.name||'');
    const handler=Object.prototype.hasOwnProperty.call(toolHandlers,name)?toolHandlers[name]:null;
    if(!handler)return rpcError(id,-32602,'Unknown tool: '+name);
    const args=body.params?.arguments&&typeof body.params.arguments==='object'&&!Array.isArray(body.params.arguments)?body.params.arguments:{};
    try{return rpc(id,toolResult(await handler(env,args,{request})))}
    catch(error){return rpc(id,{content:[{type:'text',text:toolErrorMessage(error,name)}],isError:true})}
  }catch{
    return rpcError(id,-32603,'Internal error');
  }
}

// Served at /.well-known/mcp/server-card.json (and /.well-known/mcp.json) so clients and directories can find the
// server without connecting first.
export function mcpServerCard(){
  return {
    name:'com.carejoys/caregiver-jobs',
    title:'CareJoys caregiver jobs',
    description:'Find current caregiver, CNA, GNA, HHA and PCA jobs at home-care agencies and send a caregiver\'s profile to them. Nothing is sent until the caregiver confirms by email.',
    version:MCP_VERSION,
    websiteUrl:ORIGIN+'/agent',
    documentationUrl:ORIGIN+'/agent',
    privacyPolicyUrl:ORIGIN+'/privacy-policy',
    termsOfServiceUrl:ORIGIN+'/terms-of-service',
    icons:[{src:ORIGIN+'/favicon.png',mimeType:'image/png'}],
    remotes:[{type:'streamable-http',url:ORIGIN+MCP_PATH}],
    authentication:{required:false},
    protocolVersions:MCP_PROTOCOL_VERSIONS,
    capabilities:{tools:{listChanged:false}},
    tools:MCP_TOOLS.map(t=>({name:t.name,title:t.title,description:t.description,readOnly:(t.annotations as Row).readOnlyHint}))
  };
}
