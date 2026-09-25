interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
interface D1Database { prepare(query: string): D1PreparedStatement; }
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: D1Database;
}
function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}
async function readJson(request: Request) {
  try { return await request.json() as Record<string, unknown>; } catch { return null; }
}
const clean = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const emailLooksValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const rejectBot = (data: Record<string, unknown> | null) => !!clean(data?.website);
function requireFields(data: Record<string, unknown> | null, fields: string[]) {
  if (!data) return "Invalid JSON body";
  const missing = fields.filter((field) => !clean(data[field]));
  return missing.length ? `Missing required fields: ${missing.join(", ")}` : null;
}
function publicName(first: unknown, last: unknown, display: unknown) {
  const f = clean(first, 80);
  const l = clean(last, 80);
  if (f) return l ? `${f} ${l.charAt(0).toUpperCase()}.` : f;
  const d = clean(display, 120);
  const parts = d.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : (d || "Caregiver");
}
function ageDays(timestamp: unknown) {
  const value = clean(timestamp, 80);
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 86400000) : null;
}
function freshnessLabel(status: unknown, confirmedAt: unknown) {
  const s = clean(status, 80);
  const days = ageDays(confirmedAt);
  if (s === "actively_looking" && days !== null) {
    if (days < 1) return "Confirmed today";
    if (days <= 7) return `Confirmed ${Math.floor(days)}d ago`;
    if (days <= 30) return "Confirmed this month";
  }
  if (s === "not_looking") return "Not currently looking";
  return "Availability unconfirmed";
}
function splitTerms(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2);
}
function scoreCandidate(opening: Record<string, unknown>, c: Record<string, unknown>) {
  let score = 0;
  const reasons: string[] = [];
  const targetRole = clean(opening.role).toLowerCase();
  const roleText = [clean(c.role), clean(c.certifications), clean(c.specialties)].join(" ").toLowerCase();
  if (targetRole && roleText.includes(targetRole)) { score += 40; reasons.push("role match"); }
  else if (targetRole) {
    const aliases: Record<string, string[]> = {
      cna: ["cna", "certified nursing assistant", "nursing assistant"],
      gna: ["gna", "geriatric nursing assistant", "nursing assistant"],
      hha: ["hha", "home health aide"],
      pca: ["pca", "personal care aide"],
      caregiver: ["caregiver", "personal care", "home health", "cna", "hha", "pca"]
    };
    const terms = aliases[targetRole] || [targetRole];
    if (terms.some((term) => roleText.includes(term))) { score += 35; reasons.push("related credential"); }
  }
  const openingZip = clean(opening.zip);
  const caregiverZip = clean(c.zip);
  const openingState = clean(opening.state).toLowerCase();
  const caregiverState = clean(c.state).toLowerCase();
  const openingCity = clean(opening.city).toLowerCase();
  const caregiverCity = clean(c.city).toLowerCase();
  if (openingZip && caregiverZip && openingZip === caregiverZip) { score += 25; reasons.push("same ZIP"); }
  else if (openingCity && caregiverCity && openingCity === caregiverCity && openingState === caregiverState) { score += 20; reasons.push("same city"); }
  else if (openingState && caregiverState && openingState === caregiverState) { score += 10; reasons.push("same state"); }
  const days = ageDays(c.last_confirmed_at);
  const status = clean(c.work_status);
  if (status === "actively_looking" && days !== null) {
    if (days <= 7) { score += 25; reasons.push("recently confirmed"); }
    else if (days <= 30) { score += 18; reasons.push("confirmed this month"); }
    else if (days <= 90) { score += 8; reasons.push("older availability"); }
  }
  const targetShift = clean(opening.shift_preferences);
  const candidateShift = clean(c.shift_preferences);
  if (targetShift && candidateShift) {
    const targetTerms = splitTerms(targetShift);
    if (targetTerms.some((term) => candidateShift.toLowerCase().includes(term))) { score += 10; reasons.push("shift overlap"); }
  }
  if (Number(opening.transportation_required || 0) === 1) {
    if (clean(c.transportation) || Number(c.willing_to_drive || 0) === 1) { score += 5; reasons.push("transportation"); }
  }
  return { score: Math.min(100, score), reasons };
}
async function requireWorkspace(env: Env, id: string) {
  if (!env.DB || !id) return null;
  return env.DB.prepare("SELECT id, company_name, contact_name, email, phone, zip, roles_needed, status, created_at FROM employer_leads WHERE id = ?").bind(id).first();
}
async function handleHealth(env: Env) {
  if (!env.DB) return json({ ok:false, service:"carejoys", database:"not_configured" }, { status:503 });
  try {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{name:string}>();
    const caregiverCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM caregivers").first<{count:number}>();
    const employerCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM employer_leads").first<{count:number}>();
    const schoolCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM school_leads").first<{count:number}>();
    return json({ ok:true, service:"carejoys", build:"legacy-migration-v1", database:"ready", tables:(tables.results||[]).map(r=>r.name), counts:{caregivers:Number(caregiverCount?.count||0), employers:Number(employerCount?.count||0), schools:Number(schoolCount?.count||0)}, timestamp:new Date().toISOString() });
  } catch (error) {
    return json({ ok:false, service:"carejoys", database:"error", error:error instanceof Error?error.message:"Database check failed" }, { status:500 });
  }
}
async function handleEmployer(request: Request, env: Env) {
  if (!env.DB) return json({ok:false,error:"Database not configured yet"},{status:503});
  const data=await readJson(request);
  if (rejectBot(data)) return json({ok:true},{status:201});
  const error=requireFields(data,["companyName","contactName","email","zip"]);
  if(error) return json({ok:false,error},{status:400});
  const email=clean(data!.email,320).toLowerCase();
  if(!emailLooksValid(email)) return json({ok:false,error:"Enter a valid email address"},{status:400});
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO employer_leads (id,company_name,contact_name,email,phone,zip,roles_needed,hiring_notes,status) VALUES (?,?,?,?,?,?,?,?,'active')")
    .bind(id,clean(data!.companyName,200),clean(data!.contactName,200),email,clean(data!.phone,40),clean(data!.zip,20),clean(data!.rolesNeeded,500),clean(data!.hiringNotes,1500)).run();
  return json({ok:true,id,workspaceId:id,workspaceUrl:`/app?workspace=${id}`},{status:201});
}
async function handleCaregiver(request: Request, env: Env) {
  if (!env.DB) return json({ok:false,error:"Database not configured yet"},{status:503});
  const data=await readJson(request);
  if(rejectBot(data)) return json({ok:true},{status:201});
  const error=requireFields(data,["firstName","lastName","email","phone","zip","role"]);
  if(error) return json({ok:false,error},{status:400});
  const email=clean(data!.email,320).toLowerCase();
  if(!emailLooksValid(email)) return json({ok:false,error:"Enter a valid email address"},{status:400});
  const id=crypto.randomUUID();
  const smsConsent=data!.smsConsent===true?1:0;
  await env.DB.prepare("INSERT INTO caregivers (id,first_name,last_name,display_name,email,phone,zip,role,shift_preferences,desired_wage,transportation,source,work_status,last_confirmed_at,sms_consent,sms_consent_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'organic','actively_looking',CURRENT_TIMESTAMP,?,?)")
    .bind(id,clean(data!.firstName,120),clean(data!.lastName,120),`${clean(data!.firstName,120)} ${clean(data!.lastName,120)}`.trim(),email,clean(data!.phone,40),clean(data!.zip,20),clean(data!.role,80),clean(data!.shifts,500),clean(data!.desiredWage,80),clean(data!.transportation,80),smsConsent,smsConsent?new Date().toISOString():null).run();
  return json({ok:true,id},{status:201});
}
async function handleSchool(request: Request, env: Env) {
  if(!env.DB) return json({ok:false,error:"Database not configured yet"},{status:503});
  const data=await readJson(request);
  if(rejectBot(data)) return json({ok:true},{status:201});
  const error=requireFields(data,["organizationName","contactName","email"]);
  if(error) return json({ok:false,error},{status:400});
  const email=clean(data!.email,320).toLowerCase();
  if(!emailLooksValid(email)) return json({ok:false,error:"Enter a valid email address"},{status:400});
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO school_leads (id,organization_name,contact_name,email,phone,city,state,program_types,graduating_count,notes,status) VALUES (?,?,?,?,?,?,?,?,?,?,'new')")
    .bind(id,clean(data!.organizationName,250),clean(data!.contactName,200),email,clean(data!.phone,40),clean(data!.city,120),clean(data!.state,80),clean(data!.programTypes,500),clean(data!.graduatingCount,50),clean(data!.notes,1500)).run();
  return json({ok:true,id},{status:201});
}
async function searchCandidates(url: URL, env: Env) {
  if(!env.DB) return json({ok:false,error:"Database not configured yet"},{status:503});
  const role=clean(url.searchParams.get("role"),80).toLowerCase();
  const zip=clean(url.searchParams.get("zip"),20);
  const state=clean(url.searchParams.get("state"),40).toLowerCase();
  const shift=clean(url.searchParams.get("shift"),120).toLowerCase();
  const freshness=clean(url.searchParams.get("freshness"),30);
  const result=await env.DB.prepare("SELECT id,first_name,last_name,display_name,city,state,zip,role,certifications,specialties,languages,years_experience,desired_wage,hourly_rate_min,hourly_rate_max,shift_preferences,travel_distance_miles,transportation,willing_to_drive,work_status,last_confirmed_at,source FROM caregivers WHERE is_active=1 ORDER BY CASE WHEN last_confirmed_at IS NULL THEN 1 ELSE 0 END, last_confirmed_at DESC LIMIT 250").all<Record<string,unknown>>();
  let rows=result.results||[];
  if(role) rows=rows.filter(c=>[clean(c.role),clean(c.certifications),clean(c.specialties)].join(" ").toLowerCase().includes(role));
  if(zip) rows=rows.filter(c=>clean(c.zip)===zip);
  if(state) rows=rows.filter(c=>clean(c.state).toLowerCase()===state);
  if(shift) rows=rows.filter(c=>clean(c.shift_preferences).toLowerCase().includes(shift));
  if(freshness==="confirmed") rows=rows.filter(c=>clean(c.work_status)==="actively_looking" && (ageDays(c.last_confirmed_at)??999)<=30);
  return json({ok:true,total:rows.length,candidates:rows.slice(0,100).map(c=>({
    id:c.id,
    name:publicName(c.first_name,c.last_name,c.display_name),
    city:c.city,state:c.state,zip:c.zip,role:c.role,certifications:c.certifications,specialties:c.specialties,languages:c.languages,
    yearsExperience:c.years_experience,desiredWage:c.desired_wage,rateMin:c.hourly_rate_min,rateMax:c.hourly_rate_max,
    shifts:c.shift_preferences,travelMiles:c.travel_distance_miles,transportation:c.transportation,willingToDrive:!!c.willing_to_drive,
    workStatus:c.work_status,lastConfirmedAt:c.last_confirmed_at,freshness:freshnessLabel(c.work_status,c.last_confirmed_at),source:c.source
  }))});
}
async function getWorkspace(id:string, env:Env) {
  const workspace=await requireWorkspace(env,id);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const openings=await env.DB!.prepare("SELECT * FROM openings WHERE employer_id=? ORDER BY created_at DESC").bind(id).all();
  const pipelineCount=await env.DB!.prepare("SELECT COUNT(*) AS count FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=?").bind(id).first<{count:number}>();
  return json({ok:true,workspace,openings:openings.results||[],pipelineCount:Number(pipelineCount?.count||0)});
}
async function createOpening(id:string,request:Request,env:Env) {
  const workspace=await requireWorkspace(env,id);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const data=await readJson(request);
  const error=requireFields(data,["title","role"]);
  if(error) return json({ok:false,error},{status:400});
  const openingId=crypto.randomUUID();
  await env.DB!.prepare("INSERT INTO openings (id,employer_id,title,role,city,state,zip,pay_min,pay_max,shift_preferences,transportation_required,requirements,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'open')")
    .bind(openingId,id,clean(data!.title,200),clean(data!.role,80),clean(data!.city,120),clean(data!.state,80),clean(data!.zip,20),Number(data!.payMin||0)||null,Number(data!.payMax||0)||null,clean(data!.shifts,300),data!.transportationRequired===true?1:0,clean(data!.requirements,1200)).run();
  return json({ok:true,id:openingId},{status:201});
}
async function matchOpening(workspaceId:string,openingId:string,env:Env) {
  const workspace=await requireWorkspace(env,workspaceId);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const opening=await env.DB!.prepare("SELECT * FROM openings WHERE id=? AND employer_id=?").bind(openingId,workspaceId).first<Record<string,unknown>>();
  if(!opening) return json({ok:false,error:"Opening not found"},{status:404});
  const result=await env.DB!.prepare("SELECT * FROM caregivers WHERE is_active=1").all<Record<string,unknown>>();
  const scored=(result.results||[]).map(c=>({c,...scoreCandidate(opening,c)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,50);
  for(const item of scored){
    const pipelineId=crypto.randomUUID();
    await env.DB!.prepare("INSERT OR IGNORE INTO candidate_pipeline (id,opening_id,caregiver_id,stage,match_reason,match_score,source) VALUES (?,?,?,'matched',?,?, 'carejoys_match')")
      .bind(pipelineId,openingId,item.c.id,JSON.stringify(item.reasons),item.score).run();
  }
  return json({ok:true,matched:scored.length,top:scored.slice(0,10).map(x=>({id:x.c.id,name:publicName(x.c.first_name,x.c.last_name,x.c.display_name),score:x.score,reasons:x.reasons,freshness:freshnessLabel(x.c.work_status,x.c.last_confirmed_at),city:x.c.city,state:x.c.state,role:x.c.role}))});
}
async function getPipeline(workspaceId:string,url:URL,env:Env) {
  const workspace=await requireWorkspace(env,workspaceId);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const openingId=clean(url.searchParams.get("openingId"),80);
  let sql="SELECT cp.id,cp.opening_id,cp.stage,cp.match_score,cp.match_reason,cp.contacted_at,cp.responded_at,cp.qualified_at,cp.interview_at,cp.hired_at,o.title,o.role AS opening_role,c.id AS caregiver_id,c.first_name,c.last_name,c.display_name,c.city,c.state,c.zip,c.role,c.certifications,c.specialties,c.years_experience,c.desired_wage,c.shift_preferences,c.work_status,c.last_confirmed_at FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id JOIN caregivers c ON c.id=cp.caregiver_id WHERE o.employer_id=?";
  const args:unknown[]=[workspaceId];
  if(openingId){ sql+=" AND cp.opening_id=?"; args.push(openingId); }
  sql+=" ORDER BY cp.match_score DESC, cp.created_at DESC LIMIT 250";
  const rows=await env.DB!.prepare(sql).bind(...args).all<Record<string,unknown>>();
  return json({ok:true,pipeline:(rows.results||[]).map(r=>({...r,name:publicName(r.first_name,r.last_name,r.display_name),freshness:freshnessLabel(r.work_status,r.last_confirmed_at),first_name:undefined,last_name:undefined,display_name:undefined}))});
}
async function updatePipeline(workspaceId:string,pipelineId:string,request:Request,env:Env) {
  const workspace=await requireWorkspace(env,workspaceId);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const data=await readJson(request);
  const stage=clean(data?.stage,40);
  const allowed=["matched","contacted","interested","qualified","interview","hired","rejected"];
  if(!allowed.includes(stage)) return json({ok:false,error:"Invalid stage"},{status:400});
  const owned=await env.DB!.prepare("SELECT cp.id FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE cp.id=? AND o.employer_id=?").bind(pipelineId,workspaceId).first();
  if(!owned) return json({ok:false,error:"Pipeline record not found"},{status:404});
  const timestampColumn:Record<string,string>={contacted:"contacted_at",interested:"responded_at",qualified:"qualified_at",interview:"interview_at",hired:"hired_at"};
  const col=timestampColumn[stage];
  if(col) await env.DB!.prepare(`UPDATE candidate_pipeline SET stage=?, ${col}=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(stage,pipelineId).run();
  else await env.DB!.prepare("UPDATE candidate_pipeline SET stage=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(stage,pipelineId).run();
  return json({ok:true});
}

async function importLegacy(request:Request,env:Env){
  if(!env.DB) return json({ok:false,error:"Database not configured"},{status:503});
  const existing=await env.DB.prepare("SELECT COUNT(*) AS count FROM caregivers").first<{count:number}>();
  if(Number(existing?.count||0)!==0) return json({ok:false,error:"Legacy bootstrap is already closed"},{status:409});
  const data=await readJson(request);
  if(clean(data?.migration,80)!=="carekoya-legacy-47") return json({ok:false,error:"Invalid migration payload"},{status:400});
  const profiles=Array.isArray(data?.profiles)?data!.profiles as Record<string,unknown>[]:[];
  if(profiles.length!==47) return json({ok:false,error:"Expected exactly 47 legacy profiles"},{status:400});
  let imported=0, skipped=0;
  for(const p of profiles){
    const legacyId=clean(p.id,120);
    const display=clean(p.displayName,160)||"Caregiver";
    if(!legacyId){skipped++;continue;}
    const parts=display.split(/\s+/).filter(Boolean);
    const first=parts[0]||"Caregiver";
    const last=parts.length>1?parts.slice(1).join(" "):"";
    const certs=Array.isArray(p.certifications)?(p.certifications as unknown[]).map(x=>clean(x,100)).filter(Boolean):[];
    const specialties=Array.isArray(p.specialties)?(p.specialties as unknown[]).map(x=>clean(x,120)).filter(Boolean):[];
    const languages=Array.isArray(p.languages)?(p.languages as unknown[]).map(x=>clean(x,80)).filter(Boolean):[];
    const availability=Array.isArray(p.availabilityTypes)?(p.availabilityTypes as unknown[]).map(x=>clean(x,80)).filter(Boolean):[];
    const certText=certs.join(" ").toLowerCase();
    const role=certText.includes("cna")?"CNA":certText.includes("home health aide")?"HHA":certText.includes("personal care aide")?"PCA":"Caregiver";
    await env.DB.prepare(`INSERT INTO caregivers
      (id,legacy_floot_id,first_name,last_name,display_name,email,phone,city,state,zip,role,certifications,specialties,languages,bio,years_experience,hourly_rate_min,hourly_rate_max,shift_preferences,travel_distance_miles,willing_to_drive,profile_photo_url,source,source_detail,work_status,last_confirmed_at,sms_consent,is_active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Floot CareKoya profile','unknown',NULL,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(legacy_floot_id) DO UPDATE SET
        display_name=excluded.display_name,email=excluded.email,phone=excluded.phone,city=excluded.city,state=excluded.state,zip=excluded.zip,
        role=excluded.role,certifications=excluded.certifications,specialties=excluded.specialties,languages=excluded.languages,bio=excluded.bio,
        years_experience=excluded.years_experience,hourly_rate_min=excluded.hourly_rate_min,hourly_rate_max=excluded.hourly_rate_max,
        shift_preferences=excluded.shift_preferences,travel_distance_miles=excluded.travel_distance_miles,willing_to_drive=excluded.willing_to_drive,
        profile_photo_url=excluded.profile_photo_url,updated_at=CURRENT_TIMESTAMP`)
      .bind(
        crypto.randomUUID(),legacyId,first,last,display,clean(p.email,320).toLowerCase()||null,clean(p.phone,40)||null,
        clean(p.city,120)||null,clean(p.state,80)||null,clean(p.zip,20)||null,role,
        JSON.stringify(certs),JSON.stringify(specialties),JSON.stringify(languages),clean(p.bio,2000)||null,
        Number(p.yearsExperience||0)||null,Number(p.hourlyRateMin||0)||null,Number(p.hourlyRateMax||0)||null,
        availability.join(", ")||null,Number(p.travelDistanceMiles||0)||null,p.willingToDrive===true?1:0,clean(p.profilePhotoUrl,1000)||null,
        "legacy_carekoya"
      ).run();
    imported++;
  }
  return json({ok:true,imported,skipped});
}

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==="/api/health") return handleHealth(env);
    if(request.method==="POST"&&url.pathname==="/api/employers") return handleEmployer(request,env);
    if(request.method==="POST"&&url.pathname==="/api/caregivers") return handleCaregiver(request,env);
    if(request.method==="POST"&&url.pathname==="/api/schools") return handleSchool(request,env);
    if(request.method==="GET"&&url.pathname==="/api/candidates") return searchCandidates(url,env);
    if(request.method==="GET"&&url.pathname==="/api/internal/bootstrap-legacy-47") return json({ok:true,ready:true});
    if(request.method==="POST"&&url.pathname==="/api/internal/bootstrap-legacy-47") return importLegacy(request,env);

    let m=url.pathname.match(/^\/api\/workspace\/([^/]+)$/);
    if(request.method==="GET"&&m) return getWorkspace(m[1],env);
    m=url.pathname.match(/^\/api\/workspace\/([^/]+)\/openings$/);
    if(request.method==="POST"&&m) return createOpening(m[1],request,env);
    m=url.pathname.match(/^\/api\/workspace\/([^/]+)\/openings\/([^/]+)\/match$/);
    if(request.method==="POST"&&m) return matchOpening(m[1],m[2],env);
    m=url.pathname.match(/^\/api\/workspace\/([^/]+)\/pipeline$/);
    if(request.method==="GET"&&m) return getPipeline(m[1],url,env);
    m=url.pathname.match(/^\/api\/workspace\/([^/]+)\/pipeline\/([^/]+)$/);
    if(request.method==="PATCH"&&m) return updatePipeline(m[1],m[2],request,env);

    if(url.pathname.startsWith("/api/")) return json({ok:false,error:"Not found"},{status:404});
    return env.ASSETS.fetch(request);
  }
};