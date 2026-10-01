type Row=Record<string,unknown>;
type Statement={bind(...values:unknown[]):Statement;run():Promise<{success:boolean;meta?:Record<string,unknown>}>;first<T=Row>():Promise<T|null>};
type DB={prepare(query:string):Statement};

const ORIGIN='https://carejoys.com';
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';

async function sha256Hex(value:string){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/** SQL predicate (bind one lower-cased email) that is true when the address has unsubscribed. */
export const SUPPRESSED_EMAIL_SQL='EXISTS (SELECT 1 FROM email_suppressions es WHERE es.email=?)';

export async function isSuppressed(db:DB,email:string){
  const row=await db.prepare('SELECT email FROM email_suppressions WHERE email=? LIMIT 1').bind(email.trim().toLowerCase()).first();
  return !!row;
}

/** Issues a one-time unsubscribe link for `email` and returns it with RFC 8058 one-click headers. */
export async function unsubscribeLink(db:DB,email:string,source:string){
  const token=crypto.randomUUID()+'-'+crypto.randomUUID();
  await db.prepare('INSERT INTO email_unsubscribe_tokens(token_hash,email,source) VALUES (?,?,?)')
    .bind(await sha256Hex(token),email.trim().toLowerCase(),source).run();
  const link=ORIGIN+'/api/unsubscribe?token='+encodeURIComponent(token);
  return {link,headers:{'List-Unsubscribe':`<${link}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}};
}

const page=(title:string,body:string)=>new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} | CareJoys</title>
<style>body{margin:0;background:#f7f0e6;font-family:Arial,Helvetica,sans-serif;color:#1b153c}main{max-width:480px;margin:12vh auto;padding:32px 24px;background:#fffdf9;border:1px solid #d8d2ff;border-radius:24px}h1{font-family:Georgia,serif;font-weight:400}p{color:#5f5972;line-height:1.6}button{background:#4255ff;color:#fff;border:0;border-radius:999px;padding:14px 22px;font-weight:700;font-size:16px;cursor:pointer}</style></head>
<body><main><div style="font-weight:700;margin-bottom:20px">CareJoys</div><h1>${title}</h1>${body}</main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});

/** GET shows a confirm button (so link scanners don't unsubscribe people); POST unsubscribes, including mail-client one-click. */
export async function handleUnsubscribe(request:Request,db:DB|undefined){
  if(!db)return page('Unavailable','<p>Please try again later.</p>');
  const url=new URL(request.url);
  const token=clean(url.searchParams.get('token'),300);
  const row=token?await db.prepare('SELECT email FROM email_unsubscribe_tokens WHERE token_hash=? LIMIT 1').bind(await sha256Hex(token)).first<Row>():null;
  if(!row)return page('Link not recognized','<p>This unsubscribe link is invalid. Reply to any CareJoys email and we will remove you.</p>');
  if(request.method!=='POST'){
    return page('Unsubscribe from CareJoys emails?',`<p>We'll stop sending outreach emails to this address. Sign-in links and messages you ask for will still arrive.</p><form method="post"><button type="submit">Unsubscribe</button></form>`);
  }
  await db.prepare("INSERT INTO email_suppressions(email,reason,source) VALUES (?,'unsubscribe','email_link') ON CONFLICT(email) DO NOTHING").bind(clean(row.email,320)).run();
  return page("You're unsubscribed",'<p>You will no longer receive CareJoys outreach emails at this address.</p>');
}
