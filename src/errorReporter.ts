// Tells CareJoys when something breaks in a visitor's browser (src/monitoring.ts emails new problems):
// JavaScript crashes, React crashes while drawing a page, CareJoys API calls that fail with a 5xx or never reach
// the server, and API calls still waiting after 20 seconds (a button stuck on "Saving…").
// Only the error, the page path and the browser are sent: never form contents, query strings or response bodies.
const ENDPOINT='/api/client-errors';
const MAX_REPORTS=10;
const SLOW_MS=20000;
// "Apply for me" drives an employer's site and can take a minute; admin tools run long jobs on purpose.
const SLOW_OK=/^\/api\/(me\/apply-agent|admin)\//;
let sent=0;
const seen=new Set<string>();

type Report={kind:'error'|'rejection'|'react'|'api'|'api_slow';message:string;source?:string;stack?:string};

export function reportClientError(report:Report){
  try{
    const key=report.kind+'|'+report.message;
    if(sent>=MAX_REPORTS||seen.has(key))return;
    seen.add(key);sent++;
    const detail={...report,message:report.message.slice(0,500),stack:(report.stack||'').slice(0,2000),path:window.location.pathname};
    // For the click-through test (e2e/flows.spec.ts), which fails on any report.
    window.dispatchEvent(new CustomEvent('carejoys:error-report',{detail}));
    const body=JSON.stringify(detail);
    if(!navigator.sendBeacon?.(ENDPOINT,new Blob([body],{type:'application/json'})))
      void nativeFetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true}).catch(()=>{});
  }catch{}
}

let nativeFetch:typeof fetch=(...args)=>fetch(...args);

function apiPath(input:RequestInfo|URL){
  try{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,window.location.href);
    if(url.origin!==window.location.origin||!url.pathname.startsWith('/api/')||url.pathname===ENDPOINT||url.pathname==='/api/events')return '';
    // Ids in the path would make every job its own error; keep the route's shape.
    return url.pathname.replace(/\/[^/]*\d[^/]*(?=\/|$)/g,'/:id');
  }catch{return ''}
}

export function installErrorReporter(){
  window.addEventListener('error',event=>{
    // Failed <img>/<script> loads also fire 'error' but carry no message; only real script errors count.
    if(!event.message)return;
    const at=event.filename?event.filename+':'+event.lineno+':'+event.colno:'';
    reportClientError({kind:'error',message:event.message,source:at,stack:event.error instanceof Error?event.error.stack:''});
  });
  window.addEventListener('unhandledrejection',event=>{
    const reason=event.reason;
    if(reason instanceof Error&&reason.name==='AbortError')return;
    const message=reason instanceof Error?reason.message||reason.name:typeof reason==='string'?reason:'';
    if(!message)return;
    reportClientError({kind:'rejection',message,source:reason instanceof Error?firstFrame(reason.stack):'',stack:reason instanceof Error?reason.stack:''});
  });
  const original=window.fetch.bind(window);
  nativeFetch=original;
  window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const path=apiPath(input);
    if(!path)return original(input,init);
    const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    const slow=SLOW_OK.test(path)?0:window.setTimeout(()=>reportClientError({kind:'api_slow',message:`${method} ${path} still waiting after ${SLOW_MS/1000}s`}),SLOW_MS);
    try{
      const response=await original(input,init);
      if(response.status>=500)reportClientError({kind:'api',message:`${method} ${path} returned ${response.status}`});
      return response;
    }catch(error){
      // The visitor going offline or leaving the page is not a CareJoys bug.
      if(!(error instanceof Error&&error.name==='AbortError')&&navigator.onLine!==false)
        reportClientError({kind:'api',message:`${method} ${path} did not reach CareJoys (${error instanceof Error?error.message:String(error)})`});
      throw error;
    }finally{if(slow)window.clearTimeout(slow)}
  };
}

function firstFrame(stack?:string){
  const m=(stack||'').match(/(https?:\/\/[^\s)]+:\d+:\d+)/);
  return m?m[1]:'';
}

/** For React's root: crashes while drawing a page, which otherwise leave a blank screen and no trace. */
export function reactErrorHandler(error:unknown,info?:{componentStack?:string}){
  const err=error instanceof Error?error:new Error(String(error));
  reportClientError({kind:'react',message:err.message||err.name,source:firstFrame(err.stack),stack:(err.stack||'')+(info?.componentStack?'\n--- component stack ---'+info.componentStack:'')});
}
