import { describe, expect, it } from 'vitest';
import { cleanInterviewHours, cleanQuickAnswers, gradeApplication, upcomingInterviewTimes } from '../src/quickApplyShared';

describe('three-step apply grading', () => {
  it('is qualified within 20 miles with every agency question answered', () => {
    const g=gradeApplication({miles:6.2,unanswered:0,role:'CNA',transportation:'own_car',shifts:['days','weekends'],answers:[]});
    expect(g.grade).toBe('qualified');
    expect(g.reason).toBe('CNA · 6 mi · has a car · days, weekends');
  });
  it('asks for review when far away or with a question left open', () => {
    expect(gradeApplication({miles:34,unanswered:0,role:'HHA',transportation:'public_transit',shifts:[],answers:[]}).reason).toBe('HHA · 34 mi · takes transit — check: 34 miles away');
    expect(gradeApplication({miles:null,unanswered:1,role:'CNA',transportation:null,shifts:[],answers:[]}).grade).toBe('review');
  });
  it('keeps only known answers', () => {
    expect(cleanQuickAnswers({workType:'nope',shifts:['days','x','days'],experience:['agency'],transportation:'own_car'}))
      .toEqual({workType:null,shifts:['days'],experience:['agency'],transportation:'own_car',callTimes:[]});
  });
});

describe('interview times an applicant can book', () => {
  const hours=cleanInterviewHours({days:['tue','thu'],start:'10:00',end:'11:00',duration:30,format:'phone',timezone:'America/New_York'})!;
  it('offers the agency days and hours in its own time zone, skipping booked times', () => {
    // Monday 2026-11-16 09:00 New York (14:00 UTC).
    const now=Date.parse('2026-11-16T14:00:00Z');
    const times=upcomingInterviewTimes(hours,now,new Set(['2026-11-17T15:00:00.000Z']),4);
    // Tue 10:00 EST = 15:00 UTC is booked, so Tue 10:30, then Thu 10:00 and 10:30, then next Tue 10:00.
    expect(times).toEqual(['2026-11-17T15:30:00.000Z','2026-11-19T15:00:00.000Z','2026-11-19T15:30:00.000Z','2026-11-24T15:00:00.000Z']);
  });
  it('keeps 12 hours of notice and handles daylight saving', () => {
    const summer=cleanInterviewHours({...hours,days:['mon']})!;
    // Sunday 2026-07-05 22:15 New York: Monday 10:00 EDT (14:00 UTC) is under 12 hours away, so the first is 10:30.
    const times=upcomingInterviewTimes(summer,Date.parse('2026-07-06T02:15:00Z'),new Set(),2);
    expect(times).toEqual(['2026-07-06T14:30:00.000Z','2026-07-13T14:00:00.000Z']);
  });
  it('rejects hours with no days or too short a window', () => {
    expect(cleanInterviewHours({days:[],start:'10:00',end:'12:00'})).toBeNull();
    expect(cleanInterviewHours({days:['mon'],start:'10:00',end:'10:15',duration:30})).toBeNull();
  });
});
