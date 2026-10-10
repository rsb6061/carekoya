import { expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Shared by the click-through specs. Each test fails if the page throws a JavaScript error, a CareJoys API call
// returns a 5xx, or the error reporter (src/errorReporter.ts) would have sent an alert.
export type Watch={problems:string[];allow:RegExp[];allowed:string[]};
export async function watch(page:Page,allow:RegExp[]=[]):Promise<Watch>{
  const w:Watch={problems:[],allow,allowed:[]};
  page.on('pageerror',e=>w.problems.push('JavaScript error: '+e.message));
  // src/errorReporter.ts announces every report it sends, so the test sees exactly what an alert would contain.
  await page.exposeFunction('__e2eErrorReport',(body:string)=>{if(w.allow.some(a=>a.test(body)))w.allowed.push(body);else w.problems.push('Error report: '+body)});
  await page.addInitScript(()=>window.addEventListener('carejoys:error-report',e=>(window as any).__e2eErrorReport(JSON.stringify((e as CustomEvent).detail))));
  page.on('response',r=>{
    const u=new URL(r.url());
    if(u.pathname.startsWith('/api/')&&r.status()>=500&&!w.allow.some(a=>a.test(r.request().method()+' '+u.pathname+' '+r.status())))
      w.problems.push(`API ${r.request().method()} ${u.pathname} returned ${r.status()}`);
  });
  return w;
}
export const clean=(w:Watch)=>expect(w.problems,'no JavaScript errors or failed API calls').toEqual([]);

// Signed in as a seeded account (e2e/prepare.mjs), with the same cookies a real sign-in sets.
export async function signIn(page:Page,account:{session:string},employer=false){
  const names=['__Host-cj_account',...(employer?['__Host-cj_session']:[])];
  await page.context().addCookies(names.map(name=>({name,value:account.session,domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Strict' as const})));
}


// Local email (e2e/wrangler.e2e.jsonc) lands as files; the newest one sent after `since` that matches.
const MAIL_DIR=join(process.cwd(),'e2e','.wrangler','tmp','email');
export async function emailLink(since:number,pattern:RegExp){
  for(let i=0;i<40;i++){
    const files:string[]=[];
    try{for(const run of readdirSync(MAIL_DIR))for(const f of readdirSync(join(MAIL_DIR,run,'email-text')).map(f=>join(MAIL_DIR,run,'email-text',f)))files.push(f)}catch{}
    const fresh=files.map(f=>({f,t:statSync(f).mtimeMs})).filter(x=>x.t>=since-1000).sort((a,b)=>b.t-a.t);
    for(const {f} of fresh){const m=readFileSync(f,'utf8').match(pattern);if(m)return m[0].replace(/^https?:\/\/[^/]+/,'');}
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('No email matching '+pattern+' was sent');
}
