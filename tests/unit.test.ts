import { describe, expect, it } from 'vitest';
import { boundingBox, fallbackStateForZip, haversineMiles, normalizeZip } from '../src/geo';
import { commuteRadiusMiles, freshnessLabel, scoreCandidate } from '../src/matching';
import { dailyCap, outreachEnabled, remainingToday } from '../src/outreach';
import { adminEmails, adminFromRequest, secretsMatch } from '../src/admin';
import { withUnsubscribe, caregiverActivationEmail } from '../src/email';

const NOW=Date.parse('2026-10-01T12:00:00Z');
const BALTIMORE={lat:39.2946,lng:-76.6252};   // 21201
const TOWSON={lat:39.4015,lng:-76.6019};      // 21204, ~7 mi
const DC={lat:38.9,lng:-77.03};               // ~35 mi

describe('geo', ()=>{
  it('computes great-circle miles', ()=>{
    expect(haversineMiles(BALTIMORE,BALTIMORE)).toBe(0);
    expect(haversineMiles(BALTIMORE,TOWSON)).toBeGreaterThan(6);
    expect(haversineMiles(BALTIMORE,TOWSON)).toBeLessThan(9);
    expect(haversineMiles(BALTIMORE,DC)).toBeGreaterThan(30);
    expect(haversineMiles(BALTIMORE,DC)).toBeLessThan(40);
  });
  it('bounding box contains every point within the radius', ()=>{
    const box=boundingBox(BALTIMORE,10);
    expect(TOWSON.lat).toBeGreaterThan(box.minLat);
    expect(TOWSON.lat).toBeLessThan(box.maxLat);
    expect(DC.lat).toBeLessThan(box.minLat);
  });
  it('normalizes ZIPs and falls back to Maryland prefixes', ()=>{
    expect(normalizeZip(' 21201-1234')).toBe('21201');
    expect(normalizeZip('abc')).toBe('');
    expect(fallbackStateForZip('21201')).toBe('MD');
    expect(fallbackStateForZip('10001')).toBe('');
  });
});

describe('scoreCandidate', ()=>{
  const opening={role:'CNA',zip:'21201',state:'MD',geo_lat:BALTIMORE.lat,geo_lng:BALTIMORE.lng,shift_preferences:'nights'};
  const fresh={role:'CNA',work_status:'actively_looking',last_confirmed_at:'2026-09-30T12:00:00Z',shift_preferences:'Nights, weekends'};

  it('scores a nearby, fresh, credentialed caregiver highly with a distance reason', ()=>{
    const r=scoreCandidate(opening,{...fresh,geo_lat:TOWSON.lat,geo_lng:TOWSON.lng},NOW);
    expect(r.score).toBe(22+40+25+10);
    expect(r.reasons).toContain('7 mi away');
    expect(r.distanceMiles).toBeGreaterThan(6);
  });
  it('excludes caregivers outside their commute radius', ()=>{
    const r=scoreCandidate(opening,{...fresh,geo_lat:DC.lat,geo_lng:DC.lng,travel_distance_miles:20},NOW);
    expect(r.score).toBe(0);
    expect(r.reasons).toEqual(['outside commute radius']);
  });
  it('honors a long commute radius', ()=>{
    expect(scoreCandidate(opening,{...fresh,geo_lat:DC.lat,geo_lng:DC.lng,travel_distance_miles:50},NOW).score).toBeGreaterThan(0);
  });
  it('falls back to ZIP/city/state when coordinates are missing and rejects other states', ()=>{
    const noGeo={role:'CNA',zip:'21201',state:'MD'};
    expect(scoreCandidate(noGeo,{...fresh,zip:'21201',state:'MD'},NOW).reasons).toContain('same ZIP');
    expect(scoreCandidate(noGeo,{...fresh,zip:'90001',state:'CA'},NOW).score).toBe(0);
  });
  it('gives related-credential credit through aliases', ()=>{
    const r=scoreCandidate({...opening,role:'caregiver'},{role:'HHA',geo_lat:BALTIMORE.lat,geo_lng:BALTIMORE.lng},NOW);
    expect(r.reasons).toContain('related credential');
  });
  it('clamps commute radius', ()=>{
    expect(commuteRadiusMiles({})).toBe(25);
    expect(commuteRadiusMiles({travel_distance_miles:1})).toBe(5);
    expect(commuteRadiusMiles({travel_distance_miles:500})).toBe(100);
  });
  it('labels freshness', ()=>{
    expect(freshnessLabel('actively_looking','2026-09-28T12:00:00Z',NOW)).toBe('Confirmed 3d ago');
    expect(freshnessLabel('actively_looking','2026-05-01T12:00:00Z',NOW)).toBe('Availability unconfirmed');
    expect(freshnessLabel('not_looking',null,NOW)).toBe('Not currently looking');
  });
});

describe('outreach caps', ()=>{
  it('is off unless explicitly enabled', ()=>{
    expect(outreachEnabled({})).toBe(false);
    expect(outreachEnabled({OUTREACH_ENABLED:'false'})).toBe(false);
    expect(outreachEnabled({OUTREACH_ENABLED:'TRUE'})).toBe(true);
  });
  it('parses caps with defaults, zero to pause, and a ceiling', ()=>{
    expect(dailyCap({},'reactivation')).toBe(50);
    expect(dailyCap({},'agency_teasers')).toBe(10);
    expect(dailyCap({REACTIVATION_DAILY_CAP:'0'},'reactivation')).toBe(0);
    expect(dailyCap({AGENCY_TEASER_DAILY_CAP:'9999'},'agency_teasers')).toBe(500);
    expect(dailyCap({REACTIVATION_DAILY_CAP:'nope'},'reactivation')).toBe(50);
    expect(remainingToday(50,48)).toBe(2);
    expect(remainingToday(10,12)).toBe(0);
  });
});

describe('admin auth', ()=>{
  it('parses the admin allowlist', ()=>{
    expect(adminEmails({ADMIN_EMAILS:'A@x.com, b@y.org;not-an-email'})).toEqual(['a@x.com','b@y.org']);
  });
  it('compares secrets', async()=>{
    expect(await secretsMatch('abc','abc')).toBe(true);
    expect(await secretsMatch('abc','abd')).toBe(false);
    expect(await secretsMatch('','')).toBe(false);
  });
  it('accepts the admin bearer token and rejects everything else', async()=>{
    const req=(auth?:string)=>new Request('https://carejoys.com/api/admin/overview',{headers:auth?{authorization:auth}:{}});
    expect(await adminFromRequest(req('Bearer s3cret'),{ADMIN_TOKEN:'s3cret'})).toEqual({via:'token',email:''});
    expect(await adminFromRequest(req('Bearer wrong'),{ADMIN_TOKEN:'s3cret'})).toBeNull();
    expect(await adminFromRequest(req(),{})).toBeNull();
  });
});

describe('email', ()=>{
  it('adds an unsubscribe link to html and text', ()=>{
    const msg=withUnsubscribe(caregiverActivationEmail('Ana','https://carejoys.com/activate?token=x'),'https://carejoys.com/api/unsubscribe?token=y');
    expect(msg.html).toContain('https://carejoys.com/api/unsubscribe?token=y');
    expect(msg.html.indexOf('Unsubscribe')).toBeLessThan(msg.html.lastIndexOf('</div>'));
    expect(msg.text).toContain('Unsubscribe: https://carejoys.com/api/unsubscribe?token=y');
  });
});
