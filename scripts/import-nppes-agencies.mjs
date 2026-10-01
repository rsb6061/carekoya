// Builds a D1 upsert of home care agencies from the NPPES (NPI registry) bulk CSV.
//
//   unzip -p NPPES_Data_Dissemination_*.zip 'npidata_pfile_*[0-9].csv' \
//     | node scripts/import-nppes-agencies.mjs --states VA --output /tmp/nppes-agencies.sql
//
// Reads the CSV from --input or stdin. Pre-filtering with grep for the taxonomy codes is fine as long as the
// header row (it starts with "NPI") is kept.
import fs from 'node:fs';
import readline from 'node:readline';
import { agencyUpsertSql, nppesHeader, nppesRecord, parseCsvLine, parseStates, sql } from './lib/agency-sources.mjs';

const args=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:null).filter(Boolean));
if(!args.output||!args.states){
  console.error('Usage: node scripts/import-nppes-agencies.mjs --states VA[,DC] --output out.sql [--input npidata.csv]');
  process.exit(1);
}
const states=parseStates(args.states);
const input=args.input?fs.createReadStream(args.input):process.stdin;
const lines=readline.createInterface({input,crlfDelay:Infinity});

let index=null,scanned=0;
const records=new Map();
for await (const line of lines){
  if(!index){index=nppesHeader(parseCsvLine(line));continue}
  scanned++;
  const r=nppesRecord(parseCsvLine(line),index,states);
  if(r)records.set(r.id,r);
}
if(!index)throw new Error('NPPES input was empty');
if(!records.size)throw new Error('No NPPES agencies found for '+states.join(',')+'; refusing to write an import that would deactivate every existing row');

const statements=['PRAGMA foreign_keys = ON;'];
// Rows for these states that are no longer in the registry drop out; other states are untouched.
statements.push(`UPDATE agencies SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE source='nppes' AND state IN (${states.map(sql).join(',')});`);
for(const r of records.values())statements.push(agencyUpsertSql(r));
fs.writeFileSync(args.output,statements.join('\n'));

const byType={};
for(const r of records.values())for(const t of r.providerType.split(', '))byType[t]=(byType[t]||0)+1;
console.log(JSON.stringify({states,rowsScanned:scanned,agencies:records.size,byProviderType:byType,output:args.output}));
