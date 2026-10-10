import { employerSession, type FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
export type BillingEnv=FeatureEnv&{
  STRIPE_SECRET_KEY?:string;
  STRIPE_PRICE_ID?:string;
  /** Optional yearly price for the same plan; checkout offers it when set. */
  STRIPE_PRICE_ID_YEARLY?:string;
  /** "1" once Stripe Tax is active with a business address; checkout then adds tax and collects address and tax ID. */
  STRIPE_AUTOMATIC_TAX?:string;
  STRIPE_WEBHOOK_SECRET?:string;
  FREE_CONTACTS?:string;
};

const ORIGIN='https://carejoys.com';
export const DEFAULT_FREE_CONTACTS=5;
const MAX_LOCATIONS=100;
// past_due keeps access while Stripe retries the card; Stripe's retry settings end it as unpaid or canceled.
const ACTIVE_STATUSES=new Set(['active','trialing','past_due']);
// A subscription that still exists in Stripe. A new checkout would start a second one, so these go to the billing portal.
const OPEN_STATUSES=new Set(['active','trialing','past_due','unpaid','incomplete','paused']);
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});

/** Billing is inert (no limits, no upgrade UI) until both Stripe settings exist. */
export function billingEnabled(env:BillingEnv){
  return !!(clean(env.STRIPE_SECRET_KEY)&&clean(env.STRIPE_PRICE_ID));
}
export function freeContacts(env:BillingEnv){
  const raw=clean(env.FREE_CONTACTS);
  if(!raw)return DEFAULT_FREE_CONTACTS;
  const n=Math.floor(Number(raw));
  return Number.isFinite(n)?Math.max(0,n):DEFAULT_FREE_CONTACTS;
}

// Every introduction an employer has had: a caregiver who said yes to one of their openings, or who sent their
// profile to the employer's claimed agency from a job page or an AI assistant. `at` orders them, earliest first.
const INTRODUCTIONS_SQL=`SELECT cp.id,julianday(COALESCE(cp.response_at,cp.responded_at,cp.updated_at)) AS at FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id
    WHERE o.employer_id=? AND cp.response_value='interested'
  UNION ALL
  SELECT ai.id,julianday(ai.created_at) AS at FROM agency_interests ai JOIN agency_organizations ao ON ao.id=ai.organization_id
    WHERE ao.claimed_employer_id=?`;

/**
 * The employer's introductions: an introduction is a caregiver who said they're interested in one of the employer's
 * openings or sent their profile to the employer's agency, which is what /pricing sells. Inviting, matching and browsing stay free. Once the free introductions are
 * used, new invitations wait for a subscription.
 */
export async function contactAllowance(env:BillingEnv,employerId:string){
  if(!billingEnabled(env)||!env.DB)return {enabled:false,subscribed:false,status:'',used:0,free:0,remaining:Infinity};
  const billing=await env.DB.prepare('SELECT status FROM employer_billing WHERE employer_id=? LIMIT 1').bind(employerId).first<Row>();
  const status=clean(billing?.status,40);
  const subscribed=ACTIVE_STATUSES.has(status);
  const used=asNum((await env.DB.prepare(`SELECT COUNT(*) AS count FROM (${INTRODUCTIONS_SQL})`).bind(employerId,employerId).first<Row>())?.count);
  const free=freeContacts(env);
  return {enabled:true,subscribed,status,used,free,remaining:subscribed?Infinity:Math.max(0,free-used)};
}

/**
 * Introductions (pipeline ids and agency interest ids) past the free ones, while the employer has no subscription. Their contact details
 * stay hidden until the employer upgrades. The earliest yeses are the free ones.
 */
export async function lockedIntroductions(env:BillingEnv,employerId:string):Promise<Set<string>>{
  const allowance=await contactAllowance(env,employerId);
  if(!allowance.enabled||allowance.subscribed||allowance.used<=allowance.free||!env.DB)return new Set();
  const rows=await env.DB.prepare(`SELECT id FROM (${INTRODUCTIONS_SQL}) ORDER BY at ASC,id ASC LIMIT -1 OFFSET ?`)
    .bind(employerId,employerId,allowance.free).all<Row>();
  return new Set((rows.results||[]).map(r=>clean(r.id,100)));
}

export async function billingStatus(request:Request,env:BillingEnv){
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const allowance=await contactAllowance(env,clean(employer.id,100));
  return json({ok:true,enabled:allowance.enabled,subscribed:allowance.subscribed,freeContacts:allowance.free,contactsUsed:allowance.used,
    freeContactsRemaining:Number.isFinite(allowance.remaining)?allowance.remaining:null,
    paymentIssue:allowance.status==='past_due'||allowance.status==='unpaid',yearly:allowance.enabled&&!!clean(env.STRIPE_PRICE_ID_YEARLY)});
}

async function stripe(env:BillingEnv,path:string,params:Record<string,string>,idempotencyKey?:string){
  const headers:Record<string,string>={authorization:'Bearer '+env.STRIPE_SECRET_KEY,'content-type':'application/x-www-form-urlencoded'};
  if(idempotencyKey)headers['idempotency-key']=idempotencyKey;
  const res=await fetch('https://api.stripe.com/v1/'+path,{
    method:'POST',
    headers,
    body:new URLSearchParams(params)
  });
  const body=await res.json() as Row&{error?:{message?:string}};
  if(!res.ok)throw new Error(body.error?.message||'Stripe request failed');
  return body;
}

export async function createCheckout(request:Request,env:BillingEnv){
  if(!billingEnabled(env))return json({ok:false,error:'Billing is not set up yet'},{status:503});
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const existing=await env.DB!.prepare('SELECT stripe_customer_id,status FROM employer_billing WHERE employer_id=? LIMIT 1').bind(employer.id).first<Row>();
  const customer=clean(existing?.stripe_customer_id,100);
  // Already subscribed (or a card is failing): fix it in the portal instead of starting a second subscription.
  if(customer&&OPEN_STATUSES.has(clean(existing?.status,40))){
    try{
      const portal=await stripe(env,'billing_portal/sessions',{customer,return_url:ORIGIN+'/app'});
      return json({ok:true,url:portal.url});
    }catch(error){return json({ok:false,error:error instanceof Error?error.message:'Could not open billing'},{status:502})}
  }
  const body=await request.json().catch(()=>({})) as {plan?:unknown;locations?:unknown};
  const yearly=body?.plan==='yearly'&&clean(env.STRIPE_PRICE_ID_YEARLY);
  // Priced per location: checkout asks how many, and the billing portal can change it later.
  const locations=Math.min(MAX_LOCATIONS,Math.max(1,Math.floor(asNum(body?.locations))||1));
  const params:Record<string,string>={
    mode:'subscription',
    'line_items[0][price]':yearly||env.STRIPE_PRICE_ID!,
    'line_items[0][quantity]':String(locations),
    'line_items[0][adjustable_quantity][enabled]':'true',
    'line_items[0][adjustable_quantity][minimum]':'1',
    'line_items[0][adjustable_quantity][maximum]':String(MAX_LOCATIONS),
    client_reference_id:clean(employer.id,100),
    'subscription_data[metadata][employer_id]':clean(employer.id,100),
    success_url:ORIGIN+'/app?billing=success',
    cancel_url:ORIGIN+'/app?billing=cancelled'
  };
  if(customer)params.customer=customer;else params.customer_email=clean(employer.email,320);
  if(['1','true'].includes(clean(env.STRIPE_AUTOMATIC_TAX).toLowerCase())){
    params['automatic_tax[enabled]']='true';
    params.billing_address_collection='required';
    params['tax_id_collection[enabled]']='true';
    // A returning customer's address and business name are saved back to them for tax.
    if(customer){params['customer_update[address]']='auto';params['customer_update[name]']='auto';}
  }
  try{
    // A double-click within the same minute gets the same checkout instead of a second one.
    const key=['checkout',clean(employer.id,100),params['line_items[0][price]'],locations,Math.floor(Date.now()/60000)].join(':');
    const session=await stripe(env,'checkout/sessions',params,key);
    return json({ok:true,url:session.url});
  }catch(error){return json({ok:false,error:error instanceof Error?error.message:'Could not start checkout'},{status:502})}
}

export async function createPortal(request:Request,env:BillingEnv){
  if(!billingEnabled(env))return json({ok:false,error:'Billing is not set up yet'},{status:503});
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const row=await env.DB!.prepare('SELECT stripe_customer_id FROM employer_billing WHERE employer_id=? LIMIT 1').bind(employer.id).first<Row>();
  const customer=clean(row?.stripe_customer_id,100);
  if(!customer)return json({ok:false,error:'No subscription found'},{status:404});
  try{
    const session=await stripe(env,'billing_portal/sessions',{customer,return_url:ORIGIN+'/app'});
    return json({ok:true,url:session.url});
  }catch(error){return json({ok:false,error:error instanceof Error?error.message:'Could not open billing'},{status:502})}
}

const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');

/** Verifies a `Stripe-Signature` header (v1 HMAC-SHA256 over `${t}.${payload}`) within a 5-minute tolerance. */
export async function verifyStripeSignature(payload:string,header:string,secret:string,nowSeconds=Math.floor(Date.now()/1000)){
  if(!header||!secret)return false;
  const parts=header.split(',').map(p=>p.split('=')).filter(p=>p.length===2);
  const t=Number(parts.find(([k])=>k==='t')?.[1]);
  const sigs=parts.filter(([k])=>k==='v1').map(([,v])=>v);
  if(!Number.isFinite(t)||!sigs.length||Math.abs(nowSeconds-t)>300)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expected=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${t}.${payload}`)));
  return sigs.some(sig=>{
    if(sig.length!==expected.length)return false;
    let diff=0;for(let i=0;i<sig.length;i++)diff|=sig.charCodeAt(i)^expected.charCodeAt(i);
    return diff===0;
  });
}

export async function handleStripeWebhook(request:Request,env:BillingEnv){
  if(!env.DB||!env.STRIPE_WEBHOOK_SECRET)return json({ok:false,error:'Webhook not configured'},{status:503});
  const payload=await request.text();
  if(!(await verifyStripeSignature(payload,request.headers.get('stripe-signature')||'',env.STRIPE_WEBHOOK_SECRET)))return json({ok:false,error:'Invalid signature'},{status:400});
  const event=JSON.parse(payload) as {type?:string;data?:{object?:Row}};
  const obj=event.data?.object||{};
  if(event.type==='checkout.session.completed'){
    const employerId=clean(obj.client_reference_id,100);
    if(employerId){
      await env.DB.prepare(`INSERT INTO employer_billing(employer_id,stripe_customer_id,stripe_subscription_id,status,updated_at) VALUES (?,?,?,'active',CURRENT_TIMESTAMP)
        ON CONFLICT(employer_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,status='active',updated_at=CURRENT_TIMESTAMP`)
        .bind(employerId,clean(obj.customer,100)||null,clean(obj.subscription,100)||null).run();
    }
  }else if(event.type==='customer.subscription.updated'||event.type==='customer.subscription.deleted'||event.type==='customer.subscription.created'){
    const status=event.type==='customer.subscription.deleted'?'canceled':clean(obj.status,40)||'none';
    const periodEnd=asNum(obj.current_period_end)?new Date(asNum(obj.current_period_end)*1000).toISOString():null;
    const employerId=clean((obj.metadata as Row|undefined)?.employer_id,100);
    const updated=await env.DB.prepare('UPDATE employer_billing SET status=?,current_period_end=COALESCE(?,current_period_end),stripe_subscription_id=?,updated_at=CURRENT_TIMESTAMP WHERE stripe_subscription_id=? OR stripe_customer_id=?')
      .bind(status,periodEnd,clean(obj.id,100),clean(obj.id,100),clean(obj.customer,100)).run();
    if(!asNum(updated.meta?.changes)&&employerId){
      await env.DB.prepare(`INSERT INTO employer_billing(employer_id,stripe_customer_id,stripe_subscription_id,status,current_period_end) VALUES (?,?,?,?,?)
        ON CONFLICT(employer_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,status=excluded.status,current_period_end=excluded.current_period_end,updated_at=CURRENT_TIMESTAMP`)
        .bind(employerId,clean(obj.customer,100)||null,clean(obj.id,100),status,periodEnd).run();
    }
  }
  return json({ok:true});
}
