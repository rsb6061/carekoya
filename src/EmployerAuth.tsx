import { useEffect, useState } from 'react';
import './activation.css';

async function post(path:string,data:Record<string,unknown>){
  const res=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const body=await res.json() as {ok?:boolean;error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}

export function EmployerAuth(){
  const token=new URLSearchParams(window.location.search).get('token')||'';
  const [status,setStatus]=useState<'loading'|'success'|'error'>('loading');
  const [message,setMessage]=useState('');

  useEffect(()=>{
    if(!token){setStatus('error');setMessage('This sign-in link is missing.');return;}
    post('/api/auth/verify',{token}).then(()=>{
      setStatus('success');
      window.setTimeout(()=>window.location.replace('/app'),450);
    }).catch(err=>{
      setMessage(err instanceof Error?err.message:'This sign-in link is invalid.');
      setStatus('error');
    });
  },[token]);

  return <div className="activation-shell">
    <div className="activation-card activation-success">
      <div className="activation-kicker">CareJoys employer access</div>
      {status==='loading'&&<><h1>Signing you in…</h1><p>Verifying your secure CareJoys link.</p></>}
      {status==='success'&&<><div className="success-mark">✓</div><h1>You’re signed in.</h1><p>Opening your recruiting workspace now.</p></>}
      {status==='error'&&<><h1>This link can’t be used.</h1><p>{message}</p><a className="btn" href="/app">Request a new sign-in link</a></>}
    </div>
  </div>;
}
