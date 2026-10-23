import { describe,expect,it } from 'vitest';
import { publicCaregiverCard,zipArea } from '../src/publicDirectory';
import { parseDirectoryPath,directoryPath,usState } from '../src/usStates';

describe('public caregiver card',()=>{
  const row={id:'cg-1',first_name:'Tanisha',last_name:'Robinson',role:'GNA',certifications:'["CPR"], First Aid',specialties:'Dementia care',languages:'English, Spanish',
    years_experience:6,desired_wage:'$19+/hr',hourly_rate_min:null,shift_preferences:'Days, weekends',employment_types:'full_time,per_diem',start_availability:'now',
    care_settings:'home care,assisted living',preferred_settings:'',travel_distance_miles:15,transportation:'own_car',willing_to_drive:0,
    bio:'Call me at 410-555-0123 or tanisha@example.com. Experienced with hospice.',last_confirmed_at:new Date().toISOString(),profile_updated_at:null,updated_at:'2026-10-20 10:00:00',
    work_status:'actively_looking',auth0_email_verified:1,public_photo:0,profile_photo_url:'/api/caregivers/cg-1/photo',zip:'21215',geo_city:'Baltimore',geo_state:'MD'};
  it('shows a first name and initial, an area, a pay floor and the lists, and nothing that reaches the person',()=>{
    const card=publicCaregiverCard(row);
    expect(card.name).toBe('Tanisha R.');
    expect(card.zipArea).toBe('212xx');
    expect(card.city).toBe('Baltimore');expect(card.state).toBe('MD');expect(card.stateSlug).toBe('maryland');expect(card.citySlug).toBe('baltimore');
    expect(card.payFloor).toBe(19);
    expect(card.certifications).toEqual(['CPR','First Aid']);
    expect(card.hours).toEqual(['Full-time','Per diem']);
    expect(card.ownCar).toBe(true);
    expect(card.bio).not.toContain('410-555');
    expect(card.bio).not.toContain('@');
    expect(card.bio).toContain('Experienced with hospice.');
    expect(card.availability).toBe('Confirmed today');
    expect(card.photoUrl).toBeNull();
    expect(JSON.stringify(card)).not.toContain('Robinson');
    expect(JSON.stringify(card)).not.toContain('21215');
  });
  it('shows the photo only with its own yes',()=>{
    expect(publicCaregiverCard({...row,public_photo:1}).photoUrl).toBe('/api/public/caregivers/cg-1/photo');
    expect(publicCaregiverCard({...row,public_photo:1,profile_photo_url:null}).photoUrl).toBeNull();
  });
  it('never turns a short or missing ZIP into an area',()=>{
    expect(zipArea('2120')).toBe('');expect(zipArea('')).toBe('');expect(zipArea('21201-1234')).toBe('212xx');
  });
});

describe('directory paths',()=>{
  it('parses the directory and rejects anything else',()=>{
    expect(parseDirectoryPath('/caregivers')).toEqual({state:null,citySlug:''});
    expect(parseDirectoryPath('/caregivers/maryland')?.state?.code).toBe('MD');
    expect(parseDirectoryPath('/caregivers/maryland/baltimore')).toEqual({state:usState('MD'),citySlug:'baltimore'});
    expect(parseDirectoryPath('/caregivers/md/baltimore')).toBeNull();
    expect(parseDirectoryPath('/caregiver-jobs/maryland')).toBeNull();
    expect(directoryPath(usState('MD'),'baltimore')).toBe('/caregivers/maryland/baltimore');
    expect(directoryPath()).toBe('/caregivers');
  });
});
