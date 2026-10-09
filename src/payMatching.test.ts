import { describe,expect,it } from 'vitest';
import { parseHourlyMinimum,jobMeetsPayFloor } from './payMatching';

describe('hourly pay match enforcement',()=>{
 it('parses free-text signup wage fields consistently',()=>{
   expect(parseHourlyMinimum('$20–24/hr')).toBe(20);
   expect(parseHourlyMinimum('$23+/hr')).toBe(23);
   expect(parseHourlyMinimum('25 per hour')).toBe(25);
   expect(parseHourlyMinimum('$50,000/year')).toBeNull();
   expect(parseHourlyMinimum('negotiable')).toBeNull();
 });
 it('excludes underpaid or undisclosed jobs when the worker specifies a floor',()=>{
   const worker={desired_wage:'$22+/hr'};
   expect(jobMeetsPayFloor(worker,{pay_min:17,pay_max:20,pay_period:'hour'})).toBe(false);
   expect(jobMeetsPayFloor(worker,{pay_min:22,pay_max:25,pay_period:'hour'})).toBe(true);
   expect(jobMeetsPayFloor(worker,{pay_min:null,pay_max:null,pay_period:'hour'})).toBe(false);
   expect(jobMeetsPayFloor(worker,{pay_min:800,pay_max:1000,pay_period:'week'})).toBe(false);
 });
 it('allows listings without disclosed pay if the worker has no requested minimum',()=>{
   expect(jobMeetsPayFloor({},{})).toBe(true);
 });
});
