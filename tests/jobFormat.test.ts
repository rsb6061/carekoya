import { describe,expect,it } from 'vitest';
import { agoLabel,freshnessLine,jobDates,parsePostedDate } from '../src/jobFormat';

const seen='2026-10-23 12:00:00';
const now=new Date('2026-10-23T15:00:00Z');

describe('posted dates from career pages',()=>{
  it('reads ISO, US and long dates',()=>{
    expect(parsePostedDate('2026-10-20',seen)?.toISOString().slice(0,10)).toBe('2026-10-20');
    expect(parsePostedDate('2026-10-23T13:13:53+00:00',seen)?.toISOString().slice(0,10)).toBe('2026-10-23');
    expect(parsePostedDate('10/20/2026',seen)?.toISOString().slice(0,10)).toBe('2026-10-20');
    expect(parsePostedDate('October 12, 2026 at 1:22:39 PM GMT+0',seen)?.toISOString().slice(0,10)).toBe('2026-10-12');
  });
  it('resolves Workday relative dates against the day the job was read',()=>{
    expect(parsePostedDate('Posted 10 Days Ago',seen)?.toISOString().slice(0,10)).toBe('2026-10-13');
    expect(parsePostedDate('Posted Yesterday',seen)?.toISOString().slice(0,10)).toBe('2026-10-22');
    expect(parsePostedDate('Posted Today',seen)?.toISOString().slice(0,10)).toBe('2026-10-23');
    expect(parsePostedDate('Posted 30+ Days Ago',seen)?.toISOString().slice(0,10)).toBe('2026-09-23');
    expect(parsePostedDate('Posted 3 Hours Ago',seen)?.toISOString().slice(0,10)).toBe('2026-10-23');
  });
  it('drops dates that cannot be right',()=>{
    expect(parsePostedDate('',seen)).toBeNull();
    expect(parsePostedDate('soon',seen)).toBeNull();
    expect(parsePostedDate('1999-01-01',seen)).toBeNull();
    expect(parsePostedDate('2027-01-01',seen)).toBeNull();
  });
  it('falls back to when CareJoys first saw the job',()=>{
    const d=jobDates({datePosted:'',firstSeenAt:'2026-10-01 08:00:00',lastSeenAt:seen,lastCheckedAt:seen});
    expect(d.posted?.toISOString().slice(0,10)).toBe('2026-10-01');
    expect(d.checked?.toISOString().slice(0,10)).toBe('2026-10-23');
  });
});

describe('freshness line',()=>{
  it('words the age the way people say it',()=>{
    expect(agoLabel(new Date('2026-10-23T01:00:00Z'),now)).toBe('today');
    expect(agoLabel(new Date('2026-10-22T01:00:00Z'),now)).toBe('yesterday');
    expect(agoLabel(new Date('2026-10-20T01:00:00Z'),now)).toBe('3 days ago');
    expect(agoLabel(new Date('2026-10-02T01:00:00Z'),now)).toBe('3 weeks ago');
    expect(agoLabel(new Date('2026-07-02T01:00:00Z'),now)).toBe('3 months ago');
    expect(agoLabel(new Date('2025-07-02T01:00:00Z'),now)).toBe('over a year ago');
  });
  it('shows posted and checked together',()=>{
    expect(freshnessLine({datePosted:'Posted 3 Days Ago',lastSeenAt:seen,lastCheckedAt:seen},now)).toBe('Posted 3 days ago · Checked today');
    expect(freshnessLine({datePosted:'',firstSeenAt:'',lastSeenAt:'',lastCheckedAt:''},now)).toBe('');
  });
});
