import { useEffect, useState } from 'react';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { directoryPath, jobsHubPath, parseDirectoryPath, usState } from './usStates';
import { CaregiverOnboarding } from './CaregiverOnboarding';
import './styles.css';

// Serves /caregivers, /caregivers/{state}[/{city}] and /caregiver/{id}: the public caregiver directory.
// What each card shows is decided on the server (src/publicDirectory.ts); this only lays it out.
export type PublicCaregiverCard={
  id:string;name:string;role:string;certifications:string[];specialties:string[];languages:string[];yearsExperience:number|null;payFloor:number|null;
  shifts:string;hours:string[];startAvailability:string;careSettings:string[];preferredSettings:string[];travelMiles:number|null;ownCar:boolean;bio:string;
  city:string;state:string;stateSlug:string;citySlug:string;zipArea:string;verifiedEmail:boolean;availability:string;lastConfirmedAt:string|null;profileUpdatedAt:string|null;photoUrl:string|null;
};
type Directory={total:number;page:number;pages:number;city:string;minListed:number;maxAgeDays:number;
  state:{code:string;name:string;slug:string}|null;states:{code:string;name:string;slug:string;count:number}[];cities:{city:string;slug:string;count:number}[];cards:PublicCaregiverCard[]};

const START:Record<string,string>={now:'Can start right away','2_weeks':'Can start within 2 weeks','1_month':'Can start within a month',later:'Starting later than a month'};

function ago(iso:string|null){
  if(!iso)return '';
  const t=Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(iso)?iso.replace(' ','T')+'Z':iso);
  if(!Number.isFinite(t))return '';
  const days=Math.max(0,Math.floor((Date.now()-t)/86400000));
  return days===0?'today':days===1?'yesterday':days+' days ago';
}

/** One caregiver as employers and search engines see them. `full` adds the longer sections for the profile page. */
export function CaregiverCard({card,full=false,invite=true}:{card:PublicCaregiverCard;full?:boolean;invite?:boolean}){
  const place=[card.city,card.state].filter(Boolean).join(', ')+(card.zipArea?' · '+card.zipArea:'');
  const href='/caregiver/'+encodeURIComponent(card.id);
  return <article className="job caregiver-card">
    <div className="caregiver-card-main">
      <div className="caregiver-card-head">
        {card.photoUrl?<img className="caregiver-card-photo" src={card.photoUrl} alt="" width={56} height={56}/>:<div className="caregiver-card-photo caregiver-card-initial" aria-hidden="true">{card.name.charAt(0)}</div>}
        <div>
          <h3>{full?card.name:<a href={href}>{card.name}</a>}</h3>
          <div className="meta">{[card.role,place].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div className="job-tags">
        {card.verifiedEmail&&<span className="pill pill-good">Verified email</span>}
        <span className="pill pill-good">{card.availability}</span>
        {card.payFloor!==null&&<span className="pill">${card.payFloor}+/hr</span>}
        {card.hours.map(h=><span className="pill" key={h}>{h}</span>)}
        {card.yearsExperience?<span className="pill">{card.yearsExperience} yrs</span>:null}
        {card.certifications.map(c=><span className="pill" key={c}>{c}</span>)}
      </div>
      {card.bio&&<p className="caregiver-card-bio">{full?card.bio:card.bio.length>220?card.bio.slice(0,220).replace(/\s+\S*$/,'')+'…':card.bio}</p>}
      {(full||card.careSettings.length>0)&&<dl className="caregiver-card-facts">
        {card.careSettings.length>0&&<><dt>Worked in</dt><dd>{card.careSettings.join(', ')}</dd></>}
        {full&&card.preferredSettings.length>0&&<><dt>Wants to work in</dt><dd>{card.preferredSettings.join(', ')}</dd></>}
        {full&&card.specialties.length>0&&<><dt>Experienced with</dt><dd>{card.specialties.join(', ')}</dd></>}
        {full&&card.shifts&&<><dt>Shifts</dt><dd>{card.shifts}</dd></>}
        {full&&card.startAvailability&&<><dt>Start</dt><dd>{START[card.startAvailability]||card.startAvailability}</dd></>}
        {full&&card.languages.length>0&&<><dt>Languages</dt><dd>{card.languages.join(', ')}</dd></>}
        {full&&(card.travelMiles||card.ownCar)&&<><dt>Getting to work</dt><dd>{[card.ownCar?'Own car':'',card.travelMiles?'up to '+card.travelMiles+' miles':''].filter(Boolean).join(', ')}</dd></>}
      </dl>}
      <div className="meta caregiver-card-fresh">{[card.lastConfirmedAt?'Availability confirmed '+ago(card.lastConfirmedAt):'',card.profileUpdatedAt?'Profile updated '+ago(card.profileUpdatedAt):''].filter(Boolean).join(' · ')}</div>
    </div>
    {invite&&<div className="public-job-actions">
      <a className="btn job-apply-primary" href="/hire-caregivers">Invite to interview</a>
      <span className="apply-where">Free for employers; contact details after {card.name.split(' ')[0]} says yes</span>
    </div>}
  </article>;
}

export function CaregiverDirectory(){
  const path=window.location.pathname;
  const profile=path.match(/^\/caregiver\/([^/]+)\/?$/);
  if(profile)return <CaregiverProfilePage id={decodeURIComponent(profile[1])}/>;
  return <DirectoryPage/>;
}

function Explainer(){
  return <section className="section"><div className="wrap">
    <h2>How the caregiver directory works</h2>
    <div className="jobs">
      <div className="job"><div><h3>Caregivers choose to be listed</h3><div className="meta">A profile appears here only after the caregiver ticks “List my profile”. They can hide it any time.</div></div><div className="meta">01</div></div>
      <div className="job"><div><h3>Only people who are looking now</h3><div className="meta">Every listed caregiver verified their email and confirmed they are looking within the last 30 days. We check in every two weeks.</div></div><div className="meta">02</div></div>
      <div className="job"><div><h3>No contact details until they say yes</h3><div className="meta">Employers see a first name, role, area and availability, then invite. Phone and email come with the caregiver’s yes.</div></div><div className="meta">03</div></div>
    </div>
  </div></section>;
}

function DirectoryPage(){
  const parsed=parseDirectoryPath(window.location.pathname);
  const state=parsed?.state||null;
  const citySlug=parsed?.citySlug||'';
  const params=new URLSearchParams(window.location.search);
  const [page,setPage]=useState(Math.max(1,Number(params.get('page')||1)||1));
  const [data,setData]=useState<Directory|null>(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    setLoading(true);
    const q=new URLSearchParams({page:String(page)});
    if(state)q.set('state',state.code);
    if(citySlug)q.set('city',citySlug);
    fetch('/api/public/caregivers?'+q.toString()).then(r=>r.json()).then((d:any)=>{if(Array.isArray(d?.cards))setData(d)}).catch(()=>{}).finally(()=>setLoading(false));
  },[state?.code,citySlug,page]);
  const place=state?(data?.city?data.city+', '+state.code:state.name):'';
  const heading=state?'Caregivers looking for work in '+place:'Caregivers looking for work near you';
  return <div>
    <SiteHeader/>
    <main className="maryland-caregiver-page">
      <section className="caregiver-campaign-hero"><div className="wrap caregiver-campaign-grid">
        <div>
          <div className="hub-breadcrumb"><a href="/">CareJoys</a> › {state?<><a href="/caregivers">Caregivers</a> › {data?.city?<><a href={directoryPath(state)}>{state.name}</a> › {data.city}</>:state.name}</>:'Caregivers'}</div>
          <div className="modal-kicker">For employers</div>
          <h1>{heading}</h1>
          <p>CNAs, GNAs, HHAs, PCAs and caregivers who chose to list their profile. Each one verified their email and confirmed they are looking in the last {data?.maxAgeDays||30} days.</p>
          <div className="hero-actions"><a className="btn" href="/hire-caregivers">Invite caregivers to interview</a>{state&&<a className="btn secondary" href={jobsHubPath(state,data?.city?citySlug:'')}>Caregiver jobs in {place}</a>}</div>
        </div>
        <div className="campaign-form-card" id="caregiver-profile">
          <div className="modal-kicker">Caregivers</div>
          <h2 className="campaign-form-title">Get listed here, free</h2>
          <CaregiverOnboarding referralSlug="" />
        </div>
      </div></section>

      <section className="section caregiver-jobs-section" id="listed"><div className="wrap">
        <div className="section-heading"><div>
          <div className="modal-kicker">Listed now</div>
          <h2>{state?(data?.total?data.total+' caregiver'+(data.total===1?'':'s')+' in '+place:'Caregivers in '+place):'Browse by state'}</h2>
        </div></div>
        {loading&&!data?<div className="empty"><strong>Loading…</strong></div>
          :!data?null
          :state?(data.cards.length?<>
              <div className="jobs caregiver-public-job-list">{data.cards.map(c=><CaregiverCard card={c} key={c.id}/>)}</div>
              {data.pages>1&&<nav className="hub-pager" aria-label="Pages">
                <button className="btn secondary" disabled={data.page<=1} onClick={()=>{setPage(data.page-1);window.scrollTo({top:0})}}>Previous</button>
                <span>Page {data.page} of {data.pages}</span>
                <button className="btn secondary" disabled={data.page>=data.pages} onClick={()=>{setPage(data.page+1);window.scrollTo({top:0})}}>Next</button>
              </nav>}
            </>:<div className="empty"><strong>No caregivers are listed in {place} yet.</strong><div>Caregivers: <a className="text-link" href="#caregiver-profile">get listed</a> and employers nearby can find you. Employers: <a className="text-link" href="/hire-caregivers">tell us what you need</a> and we’ll match you as caregivers list.</div></div>)
          :(data.states.length?<div className="job-tags hub-city-tags">{data.states.map(s=><a className="pill" key={s.code} href={directoryPath(usState(s.code))}>{s.name} ({s.count})</a>)}</div>
            :<div className="empty"><strong>The first caregivers are listing now.</strong><div>Caregivers: <a className="text-link" href="#caregiver-profile">get listed</a>. Employers: <a className="text-link" href="/hire-caregivers">tell us what you need</a>.</div></div>)}
        {state&&data&&!data.city&&data.cities.length>0&&<div className="hub-cities">
          <h3>Caregivers by city</h3>
          <div className="job-tags">{data.cities.map(c=><a className="pill" key={c.slug} href={directoryPath(state,c.slug)}>{c.city} ({c.count})</a>)}</div>
        </div>}
        {state&&<p className="hub-other-states"><a className="text-link" href="/caregivers">Caregivers in other states →</a></p>}
      </div></section>
      <Explainer/>
    </main>
    <SiteFooter/>
  </div>;
}

function CaregiverProfilePage({id}:{id:string}){
  const [card,setCard]=useState<PublicCaregiverCard|null>(null);
  const [status,setStatus]=useState<'loading'|'ok'|'gone'|'missing'>('loading');
  useEffect(()=>{
    fetch('/api/public/caregivers/'+encodeURIComponent(id)).then(async r=>{
      const d=await r.json() as any;
      if(r.ok&&d?.card){setCard(d.card);setStatus('ok')}else setStatus(d?.gone?'gone':'missing');
    }).catch(()=>setStatus('missing'));
  },[id]);
  const state=card?usState(card.state):null;
  return <div>
    <SiteHeader/>
    <main className="maryland-caregiver-page"><section className="section"><div className="wrap">
      <div className="hub-breadcrumb"><a href="/">CareJoys</a> › <a href="/caregivers">Caregivers</a>{state&&<> › <a href={directoryPath(state)}>{state.name}</a>{card?.citySlug&&<> › <a href={directoryPath(state,card.citySlug)}>{card.city}</a></>}</>}</div>
      {status==='loading'?<div className="empty"><strong>Loading…</strong></div>
        :status==='ok'&&card?<>
          <div className="modal-kicker">Caregiver profile</div>
          <h1>{card.name}</h1>
          <div className="jobs caregiver-public-job-list"><CaregiverCard card={card} full/></div>
          <p className="muted caregiver-card-own">Is this you? <a className="text-link" href="/login?next=/dashboard/settings">Sign in</a> to change or hide your listing.</p>
        </>
        :<div className="empty"><strong>{status==='gone'?'This caregiver is no longer listed.':'We couldn’t find that caregiver.'}</strong><div><a className="text-link" href="/caregivers">Browse caregivers looking for work</a></div></div>}
    </div></section></main>
    <SiteFooter/>
  </div>;
}
