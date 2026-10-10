// One candidate list for the employer dashboard: caregivers matched to openings and caregivers who applied to the
// agency, with one set of stages. Pure, so the browser and the tests share it.
import type { MatchRow } from './MatchList';
import type { TalentCandidate } from './TalentCard';

export type InboxStage='new'|'contacted'|'interview'|'hired'|'not_fit';
/** An application as /api/agency/inbox returns it. */
export type InboxItem={
  id:string;caregiverId:string;stage:InboxStage;createdAt:string;viewed:boolean;source:string;note:string|null;notes:string;contactLocked?:boolean;resumeUrl?:string|null;
  job:{id:string;title:string;url:string}|null;profile?:TalentCandidate|null;
  caregiver:{name:string;email:string;phone:string;city:string;state:string;zip:string;role:string;certifications:string;photoUrl:string|null};
};

const STAGE_FROM_INBOX:Record<InboxStage,string>={new:'interested',contacted:'interested',interview:'interview',hired:'hired',not_fit:'rejected'};
/** The inbox stage an employer's mark on an application saves as. */
export const INBOX_STAGE_FOR:Record<'interview'|'hired'|'rejected'|'restore'|'reached',InboxStage>={interview:'interview',hired:'hired',rejected:'not_fit',restore:'new',reached:'contacted'};

export const APPLICATION_PREFIX='app:';

export function applicationRow(item:InboxItem):MatchRow{
  const c=item.caregiver;
  return {
    id:APPLICATION_PREFIX+item.id,application_id:item.id,kind:'application',opening_id:'',caregiver_id:item.caregiverId,
    stage:STAGE_FROM_INBOX[item.stage]||'interested',reached:item.stage==='contacted',
    rejected_reason:item.stage==='not_fit'?'employer_not_a_fit':null,response_value:'interested',responded_at:item.createdAt,
    title:item.job?.title||'',name:c.name,city:c.city,state:c.state,role:c.role,profilePhotoUrl:c.photoUrl||undefined,
    contact_email:c.email||null,contact_phone:c.phone||null,contact_locked:!!item.contactLocked,resume_url:item.resumeUrl||null,
    employer_notes:item.notes||'',source_label:item.source,caregiver_note:item.note,profile:item.profile||null,match_reasons:[]
  };
}

/**
 * Applications first (newest first), then matches. A match nobody has invited yet is dropped when the same caregiver
 * already applied: they're in the list once, as an applicant, and never get an invitation for a job they asked about.
 */
export function mergeCandidates(pipeline:MatchRow[],applications:InboxItem[]):MatchRow[]{
  const applied=new Set(applications.map(a=>a.caregiverId).filter(Boolean));
  const matches=pipeline.map(r=>({...r,kind:'match' as const})).filter(r=>!(r.stage==='matched'&&applied.has(r.caregiver_id)));
  return [...applications.map(applicationRow),...matches];
}

/** Stage counts across both sources, for the summary chips. */
export function stageCounts(rows:MatchRow[]){
  const by=(s:string)=>rows.filter(p=>p.stage===s).length;
  return {matched:by('matched'),contacted:by('contacted'),interested:by('interested'),interview:by('interview'),hired:by('hired')};
}

/** What CareJoys has done for the employer, for the results line: invitations, yeses, applications and hires. */
export function resultsOf(rows:MatchRow[]){
  const matches=rows.filter(r=>r.kind!=='application');
  return {
    invited:matches.filter(r=>!!r.contacted_at).length,
    yes:matches.filter(r=>r.response_value==='interested').length,
    applied:rows.filter(r=>r.kind==='application').length,
    hired:rows.filter(r=>r.stage==='hired').length
  };
}
