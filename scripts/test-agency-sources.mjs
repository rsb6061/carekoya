import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baseOrganizationKey, groupAgencies, inferredRoles, nppesHeader, nppesRecord, organizationFields,
  ownSiteDomain, parseCsvLine, parseStates, phone10, stateCode
} from './lib/agency-sources.mjs';

const HEADER=['NPI','Entity Type Code','Provider Organization Name (Legal Business Name)','Provider Other Organization Name',
  'Provider Other Organization Name Type Code','Provider First Line Business Practice Location Address',
  'Provider Second Line Business Practice Location Address','Provider Business Practice Location Address City Name',
  'Provider Business Practice Location Address State Name','Provider Business Practice Location Address Postal Code',
  'Provider Business Practice Location Address Telephone Number','NPI Deactivation Date','NPI Reactivation Date',
  'Authorized Official First Name','Authorized Official Last Name','Last Update Date',
  'Healthcare Provider Taxonomy Code_1','Healthcare Provider Taxonomy Code_2'];
const csv=fields=>fields.map(f=>'"'+String(f).replaceAll('"','""')+'"').join(',');
const nppesRow=over=>{
  const base={'NPI':'1234567890','Entity Type Code':'2','Provider Organization Name (Legal Business Name)':'BLUE RIDGE CARE LLC',
    'Provider Other Organization Name':'BLUE RIDGE HOME CARE','Provider Other Organization Name Type Code':'3',
    'Provider First Line Business Practice Location Address':'100 MAIN ST','Provider Business Practice Location Address City Name':'RICHMOND',
    'Provider Business Practice Location Address State Name':'VA','Provider Business Practice Location Address Postal Code':'232191234',
    'Provider Business Practice Location Address Telephone Number':'8045550100','Authorized Official First Name':'JANE',
    'Authorized Official Last Name':'DOE','Last Update Date':'2026-08-01','Healthcare Provider Taxonomy Code_1':'253Z00000X'};
  const row={...base,...over};
  return HEADER.map(h=>row[h]??'');
};

test('state codes and phones normalize',()=>{
  assert.equal(stateCode('Virginia'),'VA');
  assert.equal(stateCode('va'),'VA');
  assert.equal(stateCode('Narnia'),'');
  assert.deepEqual(parseStates('va, DC'),['VA','DC']);
  assert.throws(()=>parseStates('VA,XX'));
  assert.equal(phone10('+1 (804) 555-0100'),'8045550100');
  assert.equal(phone10('555-0100'),'');
});

test('CSV lines with quotes and commas split correctly',()=>{
  assert.deepEqual(parseCsvLine('"a","b, c","say ""hi""",""'),['a','b, c','say "hi"','']);
});

test('NPPES rows become agencies only for active organizations with a home care taxonomy in the wanted state',()=>{
  const index=nppesHeader(HEADER);
  const r=nppesRecord(nppesRow({}),index,['VA']);
  assert.equal(r.name,'Blue Ridge Home Care');
  assert.equal(r.legalName,'Blue Ridge Care LLC');
  assert.equal(r.zip,'23219');
  assert.equal(r.phone,'(804) 555-0100');
  assert.equal(r.providerType,'In Home Supportive Care Agency');
  assert.equal(r.score,100);
  assert.equal(r.contactName,'Jane Doe');
  assert.equal(nppesRecord(nppesRow({'Entity Type Code':'1'}),index,['VA']),null,'individuals are skipped');
  assert.equal(nppesRecord(nppesRow({}),index,['MD']),null,'other states are skipped');
  assert.equal(nppesRecord(nppesRow({'Healthcare Provider Taxonomy Code_1':'207Q00000X'}),index,['VA']),null,'non-agency taxonomies are skipped');
  assert.equal(nppesRecord(nppesRow({'NPI Deactivation Date':'2025-01-01'}),index,['VA']),null,'deactivated NPIs are skipped');
  assert.ok(nppesRecord(nppesRow({'NPI Deactivation Date':'2025-01-01','NPI Reactivation Date':'2025-06-01'}),index,['VA']));
  const both=nppesRecord(nppesRow({'Healthcare Provider Taxonomy Code_2':'251E00000X'}),index,['VA']);
  assert.equal(both.providerType,'In Home Supportive Care Agency, Home Health Agency');
  assert.throws(()=>nppesHeader(HEADER.filter(h=>h!=='NPI')),/missing column: NPI/);
  assert.equal(parseCsvLine(csv(nppesRow({}))).length,HEADER.length);
});

test('only a site of its own counts as an agency domain',()=>{
  assert.equal(ownSiteDomain('https://www.sunrisecare.com/'),'sunrisecare.com');
  assert.equal(ownSiteDomain('https://www.homeinstead.com/location/123/'),'');
});

test('Maryland licence rows keep the organization keys they had before',()=>{
  assert.equal(baseOrganizationKey({source:'maryland_ohcq_rsa',name:'Sunrise Care, LLC',email:'info@sunrisecare.com',city:'Towson',state:'MD'}),'domain:sunrisecare.com');
  assert.equal(baseOrganizationKey({source:'maryland_ohcq_rsa',name:'Sunrise Care, LLC',email:'sunrise@gmail.com',city:'Towson',state:'MD'}),'name:sunrisecare|state:md|city:towson');
});

test('NPI and Google rows for the same agency merge, licence-list organizations never merge into each other',()=>{
  const rows=[
    {id:'a',source:'nppes',name:'Blue Ridge Home Care',phone:'(804) 555-0100',city:'Richmond',state:'VA',zip:'23219',npi:'1',provider_type:'In Home Supportive Care Agency',caregiver_relevance_score:100},
    {id:'b',source:'google_business',name:'Blue Ridge Home Care Richmond',phone:'+1 804-555-0100',city:'Richmond',state:'VA',zip:'23220',website:'https://blueridgecare.example/',google_place_id:'p1',rating:4.5,review_count:10,provider_type:'Google listing: Home help service agency',caregiver_relevance_score:85},
    {id:'c',source:'maryland_ohcq_rsa',name:'Alpha Care',email:'a@alpha.example',phone:'410-555-0199',city:'Towson',state:'MD'},
    {id:'d',source:'maryland_ohcq_rsa',name:'Beta Care',email:'b@beta.example',phone:'410-555-0199',city:'Towson',state:'MD'},
    {id:'e',source:'google_business',name:'Franchise A',phone:'800-555-0000',city:'Norfolk',state:'VA',provider_type:'Google listing: x'},
    {id:'f',source:'google_business',name:'Franchise B',phone:'800-555-0000',city:'Norfolk',state:'VA',provider_type:'Google listing: x'}
  ];
  const groups=groupAgencies(rows);
  const groupOf=id=>groups.find(g=>g.rows.some(r=>r.id===id));
  assert.equal(groupOf('a'),groupOf('b'),'same local phone merges NPI and Google rows');
  assert.equal(groupOf('a').key,'name:blueridgehomecare|state:va|city:richmond','the NPI row names the organization');
  assert.notEqual(groupOf('c'),groupOf('d'),'two licensed agencies sharing a phone stay separate');
  assert.notEqual(groupOf('e'),groupOf('f'),'toll-free numbers never merge');
  const f=organizationFields(groupOf('a'));
  assert.equal(f.name,'Blue Ridge Home Care Richmond','the Google title is the display name');
  assert.equal(f.primaryDomain,'blueridgecare.example');
  assert.equal(f.npi,'1');
  assert.equal(f.rating,4.5);
  assert.equal(f.sources,'google_business, nppes');
  assert.deepEqual(inferredRoles(f.providerTypes).sort(),['Caregiver','HHA','PCA']);
});
