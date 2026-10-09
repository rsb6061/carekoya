/** Anonymous first-party visitor identifier; no personal details in event records. */
const KEY='cj:worker-funnel:v1';
export function workerVisitorId(){
 try {
  const raw=localStorage.getItem(KEY);
  if(raw){const x=JSON.parse(raw) as {id?:string;created?:number};
   if(typeof x.id==='string'&&/^[0-9a-f-]{36}$/.test(x.id)&&typeof x.created==='number'&&Date.now()>=x.created&&Date.now()-x.created<30*86400000)return x.id;
  }
  const id=crypto.randomUUID();
  localStorage.setItem(KEY,JSON.stringify({id,created:Date.now()}));
  return id;
 }catch{return ''}
}
