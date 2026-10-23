import { describe, expect, it } from 'vitest';
import { outreachSlice, OUTREACH_FIRST_UTC_HOUR, OUTREACH_LAST_UTC_HOUR } from '../src/replyYesOutreach';

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
});
