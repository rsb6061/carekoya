// Test accounts and jobs for the click-through test. Everything lives in a throwaway local database.
export const PORT=8799;
export const BASE='http://localhost:'+PORT;
export const CAREGIVER={email:'e2e-caregiver@example.test',session:'e2e-caregiver-session',id:'e2e-caregiver'};
export const NEW_CAREGIVER={email:'e2e-new-caregiver@example.test',session:'e2e-new-caregiver-session'};
export const EMPLOYER={email:'e2e-employer@example.test',session:'e2e-employer-session',id:'e2e-employer'};
// Lever is one of the job sites "Apply for me" can fill in (src/applyAgentRules.ts).
export const JOBS={applyForMe:'e2e-job-lever',external:'e2e-job-external'};
export const ADMIN={email:'owner@carejoys.test',session:'e2e-admin-session'};
// A legacy caregiver's emailed "are you still looking?" link, and an agency's emailed "caregivers near you" link.
export const LINKS={activation:'e2e-activation-token',agencyTeaser:'e2e-agency-teaser-token'};
export const TRAINING={slug:'harbor-cna-academy'};
