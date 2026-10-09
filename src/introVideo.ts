// Optional intro video on a caregiver's profile, hosted on Cloudflare Stream through the Worker binding.
// The browser uploads straight to Stream (a one-time direct upload URL), so video bytes never pass through
// the Worker. Videos need signed URLs to play, and employers see one only after an admin approves it.

type Row=Record<string,unknown>;
type Statement={
  bind(...values:unknown[]):Statement;
  run():Promise<unknown>;
  all<T=Row>():Promise<{results?:T[]}>;
  first<T=Row>():Promise<T|null>;
};
type StreamVideo={readyToStream:boolean;status:{state:string;errorReasonText?:string};duration:number;thumbnail:string;preview?:string};
type StreamVideoHandle={details():Promise<StreamVideo>;delete():Promise<void>;generateToken():Promise<string>};
export type StreamBinding={
  video(id:string):StreamVideoHandle;
  createDirectUpload(params:{maxDurationSeconds:number;expiry?:string;creator?:string;meta?:Record<string,string>;requireSignedURLs?:boolean}):Promise<{uploadURL:string;id:string}>;
};
export type IntroVideoEnv={DB?:{prepare(query:string):Statement};STREAM?:StreamBinding};
type VideoRow={caregiver_id:string;stream_uid:string|null;pending_uid:string|null;status:string;duration_seconds:number|null};

export const INTRO_VIDEO_MAX_SECONDS=60;
/** SQL column for caregiver rows aliased `c`: 1 when an approved intro video is on file. */
export const HAS_INTRO_VIDEO_SQL="EXISTS(SELECT 1 FROM caregiver_intro_videos iv WHERE iv.caregiver_id=c.id AND iv.status='approved') AS has_intro_video";

const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const notEnabled=()=>json({ok:false,error:'Intro videos aren’t turned on yet.'},{status:503});

async function videoRow(env:IntroVideoEnv,caregiverId:string){
  return env.DB!.prepare('SELECT caregiver_id,stream_uid,pending_uid,status,duration_seconds FROM caregiver_intro_videos WHERE caregiver_id=?').bind(caregiverId).first<VideoRow>();
}
async function removeFromStream(env:IntroVideoEnv,uid:string|null){
  if(!uid||!env.STREAM)return;
  try{await env.STREAM.video(uid).delete()}catch(error){console.warn('stream delete failed',uid,error)}
}
/** A short-lived signed iframe URL, or null while Stream is still processing the upload. */
async function playback(env:IntroVideoEnv,uid:string){
  const handle=env.STREAM!.video(uid);
  const details=await handle.details();
  if(!details.readyToStream)return null;
  // Every video URL Stream returns is on the account's customer-<code>.cloudflarestream.com host.
  const host=new URL(details.preview||details.thumbnail).host;
  return 'https://'+host+'/'+await handle.generateToken()+'/iframe';
}

/** /api/me/video: the signed-in caregiver's own intro video. GET status, POST upload | complete | delete. */
export async function handleMyVideo(request:Request,env:IntroVideoEnv,caregiverId:string,action:string){
  if(request.method==='GET'&&!action){
    const row=await videoRow(env,caregiverId);
    if(!row?.stream_uid)return json({ok:true,enabled:!!env.STREAM,video:row?.status==='rejected'?{status:'rejected'}:null});
    const playbackUrl=env.STREAM?await playback(env,row.stream_uid).catch(()=>null):null;
    return json({ok:true,enabled:!!env.STREAM,video:{status:row.status,processing:!playbackUrl,playbackUrl,durationSeconds:row.duration_seconds}});
  }
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},{status:405});
  if(action==='delete'){
    const row=await videoRow(env,caregiverId);
    if(row){
      await removeFromStream(env,row.stream_uid);
      await removeFromStream(env,row.pending_uid);
      await env.DB!.prepare('DELETE FROM caregiver_intro_videos WHERE caregiver_id=?').bind(caregiverId).run();
    }
    return json({ok:true});
  }
  if(!env.STREAM)return notEnabled();
  if(action==='upload'){
    const body=await request.json().catch(()=>null) as {consent?:unknown}|null;
    if(body?.consent!==true)return json({ok:false,error:'Please agree to share your video with employers first.'},{status:400});
    const previous=await videoRow(env,caregiverId);
    await removeFromStream(env,previous?.pending_uid||null);
    const upload=await env.STREAM.createDirectUpload({
      maxDurationSeconds:INTRO_VIDEO_MAX_SECONDS,requireSignedURLs:true,creator:caregiverId,meta:{caregiverId},
      expiry:new Date(Date.now()+60*60*1000).toISOString()
    });
    await env.DB!.prepare(`INSERT INTO caregiver_intro_videos(caregiver_id,pending_uid,status,consent_at) VALUES (?,?,'uploading',CURRENT_TIMESTAMP)
      ON CONFLICT(caregiver_id) DO UPDATE SET pending_uid=excluded.pending_uid,consent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
      .bind(caregiverId,upload.id).run();
    return json({ok:true,uploadURL:upload.uploadURL,maxSeconds:INTRO_VIDEO_MAX_SECONDS});
  }
  if(action==='complete'){
    const row=await videoRow(env,caregiverId);
    if(!row?.pending_uid)return json({ok:false,error:'Start the upload again.'},{status:400});
    const details=await env.STREAM.video(row.pending_uid).details().catch(()=>null);
    if(!details||details.status.state==='pendingupload')return json({ok:false,error:'The upload didn’t finish. Please try again.'},{status:400});
    if(details.status.state==='error')return json({ok:false,error:'That video couldn’t be processed. Keep it under a minute and try again.'},{status:400});
    await removeFromStream(env,row.stream_uid);
    await env.DB!.prepare(`UPDATE caregiver_intro_videos SET stream_uid=pending_uid,pending_uid=NULL,status='review',duration_seconds=?,
      submitted_at=CURRENT_TIMESTAMP,reviewed_at=NULL,reviewed_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE caregiver_id=?`)
      .bind(details.duration>0?Math.round(details.duration):null,caregiverId).run();
    return json({ok:true,status:'review'});
  }
  return json({ok:false,error:'Not found'},{status:404});
}

/** An approved caregiver's intro video for a signed-in, approved employer (the caller checks the employer). */
export async function employerIntroVideo(env:IntroVideoEnv,caregiverId:string){
  if(!env.STREAM)return notEnabled();
  const row=await videoRow(env,caregiverId);
  if(!row?.stream_uid||row.status!=='approved')return json({ok:false,error:'Video not found'},{status:404});
  const playbackUrl=await playback(env,row.stream_uid).catch(()=>null);
  if(!playbackUrl)return json({ok:false,error:'This video is still processing.'},{status:409});
  return json({ok:true,playbackUrl});
}

/** Videos waiting on an admin, oldest first, each with a player link once Stream has processed it. */
export async function adminIntroVideos(env:IntroVideoEnv){
  const rows=await env.DB!.prepare(`SELECT v.caregiver_id,v.stream_uid,v.duration_seconds,v.submitted_at,c.first_name,c.last_name,c.role,c.city,c.state
    FROM caregiver_intro_videos v JOIN caregivers c ON c.id=v.caregiver_id
    WHERE v.status='review' AND v.stream_uid IS NOT NULL ORDER BY v.submitted_at LIMIT 50`).all<Row>();
  const videos=await Promise.all((rows.results||[]).map(async (r:Row)=>({
    caregiverId:r.caregiver_id,name:[r.first_name,r.last_name].filter(Boolean).join(' ')||'Caregiver',
    role:r.role,place:[r.city,r.state].filter(Boolean).join(', '),durationSeconds:r.duration_seconds,submittedAt:r.submitted_at,
    playbackUrl:env.STREAM?await playback(env,String(r.stream_uid)).catch(()=>null):null
  })));
  return json({ok:true,enabled:!!env.STREAM,videos});
}

/** Approve a video for employers, or reject it (the video is deleted from Stream so nothing unapproved is kept). */
export async function reviewIntroVideo(env:IntroVideoEnv,caregiverId:string,decision:'approve'|'reject',reviewer:string){
  const row=await videoRow(env,caregiverId);
  if(!row?.stream_uid||row.status!=='review')return json({ok:false,error:'Nothing to review for this caregiver.'},{status:404});
  if(decision==='reject')await removeFromStream(env,row.stream_uid);
  await env.DB!.prepare(`UPDATE caregiver_intro_videos SET status=?,stream_uid=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE caregiver_id=?`)
    .bind(decision==='approve'?'approved':'rejected',decision==='approve'?row.stream_uid:null,reviewer,caregiverId).run();
  return json({ok:true,status:decision==='approve'?'approved':'rejected'});
}
