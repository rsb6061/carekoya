import fs from 'node:fs';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/import-maryland-rsa.mjs input.xlsx output.sql');
  process.exit(1);
}

const SOURCE = 'maryland_ohcq_rsa';
const SOURCE_URL = 'https://health.maryland.gov/ohcq/docs/Provider-Listings/Excel/Residential-Service-Agencies-EXCEL.xlsx';

const wb = XLSX.readFile(inputPath, { cellDates: false });
const sheetName = wb.SheetNames[0];
if (!sheetName) throw new Error('Workbook has no sheets');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
if (!rows.length) throw new Error('Workbook contains no rows');

const normalize = (s='') => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const headerMap = new Map();
for (const key of Object.keys(rows[0])) headerMap.set(normalize(key), key);

function findKey(...candidates) {
  for (const c of candidates) {
    const n = normalize(c);
    if (headerMap.has(n)) return headerMap.get(n);
  }
  for (const [n,key] of headerMap.entries()) {
    for (const c of candidates) {
      const cn = normalize(c);
      if (n.includes(cn) || cn.includes(n)) return key;
    }
  }
  return null;
}
function val(row,key) {
  if (!key) return '';
  return String(row[key] ?? '').trim();
}
function esc(s) {
  if (s === null || s === undefined || s === '') return 'NULL';
  return "'" + String(s).replaceAll("'", "''") + "'";
}
function makeId(sourceKey) {
  return 'ag_' + crypto.createHash('sha256').update(SOURCE + '|' + sourceKey).digest('hex').slice(0, 24);
}
function sourceKeyFor(rec) {
  if (rec.licenseNumber) return 'license:' + rec.licenseNumber.toLowerCase();
  return 'row:' + crypto.createHash('sha256')
    .update([rec.name, rec.address1, rec.city, rec.state, rec.zip].join('|').toLowerCase())
    .digest('hex');
}

const keys = {
  name: findKey('facility name','provider name','agency name','name','facility'),
  legalName: findKey('legal name','business name'),
  licenseNumber: findKey('license number','license #','license no','lic #','licno'),
  licenseStatus: findKey('license status','status'),
  address1: findKey('address 1','address1','street address','address','street'),
  address2: findKey('address 2','address2','suite','unit'),
  city: findKey('city'),
  state: findKey('state'),
  zip: findKey('zip code','zipcode','zip'),
  county: findKey('county'),
  phone: findKey('phone number','telephone','phone'),
  email: findKey('email address','email'),
  website: findKey('website','web site','url'),
  services: findKey('services','service type','service types','type of service')
};

console.log('Workbook sheet:', sheetName);
console.log('Rows found:', rows.length);
console.log('Headers:', Object.keys(rows[0]));
console.log('Mapped columns:', keys);

const records = [];
const seen = new Set();
for (const row of rows) {
  const rec = {
    name: val(row,keys.name),
    legalName: val(row,keys.legalName),
    licenseNumber: val(row,keys.licenseNumber),
    licenseStatus: val(row,keys.licenseStatus),
    address1: val(row,keys.address1),
    address2: val(row,keys.address2),
    city: val(row,keys.city),
    state: val(row,keys.state) || 'MD',
    zip: val(row,keys.zip),
    county: val(row,keys.county),
    phone: val(row,keys.phone),
    email: val(row,keys.email),
    website: val(row,keys.website),
    services: val(row,keys.services),
    raw: row
  };
  if (!rec.name) continue;
  const sourceKey = sourceKeyFor(rec);
  if (seen.has(sourceKey)) continue;
  seen.add(sourceKey);
  records.push({ ...rec, sourceKey, id: makeId(sourceKey) });
}
if (!records.length) throw new Error('No agency records could be parsed');

const sql = [];
sql.push('BEGIN TRANSACTION;');
sql.push("UPDATE agencies SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE source='maryland_ohcq_rsa';");
for (const r of records) {
  sql.push(`INSERT INTO agencies (
    id,source,source_key,name,legal_name,license_number,license_type,license_status,
    address1,address2,city,state,zip,county,phone,email,website,services,
    source_url,source_row_json,is_active,last_source_sync_at,updated_at
  ) VALUES (
    ${esc(r.id)},${esc(SOURCE)},${esc(r.sourceKey)},${esc(r.name)},${esc(r.legalName)},${esc(r.licenseNumber)},
    'Residential Service Agency',${esc(r.licenseStatus)},${esc(r.address1)},${esc(r.address2)},${esc(r.city)},
    ${esc(r.state)},${esc(r.zip)},${esc(r.county)},${esc(r.phone)},${esc(r.email)},${esc(r.website)},${esc(r.services)},
    ${esc(SOURCE_URL)},${esc(JSON.stringify(r.raw))},1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  )
  ON CONFLICT(source,source_key) DO UPDATE SET
    name=excluded.name,
    legal_name=excluded.legal_name,
    license_number=excluded.license_number,
    license_type=excluded.license_type,
    license_status=excluded.license_status,
    address1=excluded.address1,
    address2=excluded.address2,
    city=excluded.city,
    state=excluded.state,
    zip=excluded.zip,
    county=excluded.county,
    phone=excluded.phone,
    email=excluded.email,
    website=excluded.website,
    services=excluded.services,
    source_url=excluded.source_url,
    source_row_json=excluded.source_row_json,
    is_active=1,
    last_source_sync_at=CURRENT_TIMESTAMP,
    updated_at=CURRENT_TIMESTAMP;`);
}
sql.push('COMMIT;');

fs.writeFileSync(outputPath, sql.join('\n'));
console.log('Unique agencies parsed:', records.length);
console.log('SQL written:', outputPath);
