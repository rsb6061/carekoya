import fs from 'node:fs';
import crypto from 'node:crypto';

const inputPath = process.argv[2];
const outputPath = process.argv[3] || '/tmp/carejoys-legacy-import.sql';
if (!inputPath) throw new Error('Usage: node scripts/import-floot-to-d1.mjs <export.json> [output.sql]');

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const profiles = Array.isArray(raw.profiles) ? raw.profiles : [];
if (profiles.length !== 47) throw new Error(`Expected 47 profiles, received ${profiles.length}`);

const str = (v) => v === null || v === undefined || v === '' ? 'NULL' : "'" + String(v).replaceAll("'", "''") + "'";
const num = (v) => Number.isFinite(Number(v)) && v !== '' && v !== null ? String(Number(v)) : 'NULL';
const bool = (v) => v === true ? '1' : '0';
const json = (v) => str(JSON.stringify(Array.isArray(v) ? v : []));

const statements = ['BEGIN TRANSACTION;'];

for (const p of profiles) {
  const display = String(p.displayName || 'Caregiver').trim();
  const parts = display.split(/\s+/).filter(Boolean);
  const first = parts[0] || 'Caregiver';
  const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
  const certs = Array.isArray(p.certifications) ? p.certifications : [];
  const certText = certs.join(' ').toLowerCase();
  const role = certText.includes('cna') ? 'CNA'
    : certText.includes('home health aide') ? 'HHA'
    : certText.includes('personal care aide') ? 'PCA'
    : 'Caregiver';
  const shifts = Array.isArray(p.availabilityTypes) ? p.availabilityTypes.join(', ') : null;

  statements.push(`
INSERT INTO caregivers (
  id, legacy_floot_id, first_name, last_name, display_name, email, phone, city, state, zip,
  role, certifications, specialties, languages, bio, years_experience, hourly_rate_min, hourly_rate_max,
  shift_preferences, travel_distance_miles, willing_to_drive, profile_photo_url, source, source_detail,
  work_status, last_confirmed_at, sms_consent, is_active, created_at, updated_at
) VALUES (
  ${str(crypto.randomUUID())}, ${str(p.id)}, ${str(first)}, ${str(last)}, ${str(display)}, ${str(p.email)}, ${str(p.phone)},
  ${str(p.city)}, ${str(p.state)}, ${str(p.zip)}, ${str(role)}, ${json(p.certifications)}, ${json(p.specialties)}, ${json(p.languages)},
  ${str(p.bio)}, ${num(p.yearsExperience)}, ${num(p.hourlyRateMin)}, ${num(p.hourlyRateMax)}, ${str(shifts)},
  ${num(p.travelDistanceMiles)}, ${bool(p.willingToDrive)}, ${str(p.profilePhotoUrl)}, 'legacy_carekoya', 'Floot CareKoya profile',
  'unknown', NULL, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT(legacy_floot_id) DO UPDATE SET
  display_name=excluded.display_name, email=excluded.email, phone=excluded.phone, city=excluded.city, state=excluded.state,
  zip=excluded.zip, role=excluded.role, certifications=excluded.certifications, specialties=excluded.specialties,
  languages=excluded.languages, bio=excluded.bio, years_experience=excluded.years_experience,
  hourly_rate_min=excluded.hourly_rate_min, hourly_rate_max=excluded.hourly_rate_max,
  shift_preferences=excluded.shift_preferences, travel_distance_miles=excluded.travel_distance_miles,
  willing_to_drive=excluded.willing_to_drive, profile_photo_url=excluded.profile_photo_url,
  updated_at=CURRENT_TIMESTAMP;
`);
}

statements.push('COMMIT;');
fs.writeFileSync(outputPath, statements.join('\n'));
console.log(`Prepared ${profiles.length} legacy caregiver rows for D1 import.`);
