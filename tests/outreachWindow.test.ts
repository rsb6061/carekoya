import { describe, expect, it } from 'vitest';
import { outreachSlice, outreachExtraToday, OUTREACH_FIRST_UTC_HOUR, OUTREACH_LAST_UTC_HOUR } from '../src/replyYesOutreach';

describe('agency outreach send window', () => {
  it('sends nothing overnight US time', () => {
    for (const hour of [0, 1, 5, 9, 12, 22, 23]) expect(outreachSlice(60, hour)).toBe(0);
  });
  it('spreads the daily cap over US working hours and reaches it', () => {
    let total = 0;
    for (let hour = 0; hour < 24; hour++) total += outreachSlice(60, hour);
    expect(outreachSlice(60, OUTREACH_FIRST_UTC_HOUR)).toBe(7);
    expect(outreachSlice(60, OUTREACH_LAST_UTC_HOUR)).toBe(7);
    expect(total).toBeGreaterThanOrEqual(60);
  });
  it('sends nothing when the cap is zero', () => {
    expect(outreachSlice(0, 15)).toBe(0);
  });
  it('shares what is left of the day over the runs still to come', () => {
    // 110 for the day with 75 left at 17:00 UTC: five runs (17-21) of 15.
    expect(outreachSlice(110, 17, 75)).toBe(15);
    expect(outreachSlice(60, 21, 3)).toBe(7);
    expect(outreachSlice(110, 22, 75)).toBe(0);
  });
  it('adds the one-day extra on its date only', () => {
    expect(outreachExtraToday('2026-10-24:50', new Date('2026-10-24T16:00:00Z'))).toBe(50);
    expect(outreachExtraToday('2026-10-24:50', new Date('2026-10-25T13:00:00Z'))).toBe(0);
    expect(outreachExtraToday('', new Date('2026-10-24T16:00:00Z'))).toBe(0);
  });
});
