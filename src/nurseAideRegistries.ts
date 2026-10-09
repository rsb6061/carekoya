// Shared by the Worker and the browser bundle, so it must stay free of server-only imports.
// Official sources only. Re-check every link before changing REGISTRIES_CHECKED.
import { US_STATES, slugify } from './usStates';

type RegistryContact={agency:string;registryUrl:string;lookupUrl:string|null;phone:string|null;lookupLabel?:string};
// `also` holds a second registry for states that split them (North Carolina's Nurse Aide II).
export type NurseAideRegistry=RegistryContact&{code:string;note?:string;also?:RegistryContact};

export const REGISTRIES_CHECKED='2026-10-09';
export const REGISTRY_PATH='/resources/nurse-aide-registry-by-state';

const DATA:Record<string,Omit<NurseAideRegistry,'code'>>={
  AL:{"agency": "Alabama Department of Public Health", "registryUrl": "https://dph1.adph.state.al.us/NurseAideRegistry/Contacts.aspx", "lookupUrl": "https://dph1.adph.state.al.us/NurseAideRegistry/", "phone": "(334) 206-5169"},
  AK:{"agency": "Alaska Board of Nursing", "registryUrl": "https://commerce.alaska.gov/web/cbpl/ProfessionalLicensing/NurseAideRegistry", "lookupUrl": "https://www.commerce.alaska.gov/cbp/main/Search/Professional", "phone": "(907) 269-8160"},
  AZ:{"agency": "Arizona State Board of Nursing", "registryUrl": "https://www.azbn.gov/services/license-verification/", "lookupUrl": "https://azbn.boardsofnursing.org/licenselookup", "phone": "(602) 771-7800"},
  AR:{"agency": "Arkansas Department of Human Services", "registryUrl": "https://humanservices.arkansas.gov/divisions-shared-services/provider-services-quality-assurance/occupational-licensing/cna-nha-training-program/", "lookupUrl": "https://ar.tmutest.com/search", "phone": "(888) 401-0465"},
  CA:{"agency": "California Department of Public Health", "registryUrl": "https://www.cdph.ca.gov/Programs/CHCQ/LCP/Pages/CNA.aspx", "lookupUrl": "https://cvl.cdph.ca.gov/", "phone": "(916) 327-2445"},
  CO:{"agency": "Colorado State Board of Nursing", "registryUrl": "https://dpo.colorado.gov/Nursing", "lookupUrl": "https://apps2.colorado.gov/dora/licensing/Lookup/LicenseLookup.aspx", "phone": "(303) 894-7800"},
  CT:{"agency": "Connecticut Department of Public Health", "registryUrl": "https://portal.ct.gov/dph/practitioner-licensing--investigations/nurseaide/nurse-aide-registration", "lookupUrl": "https://registry.prometric.com/registry/publicCT", "phone": "(860) 509-7603"},
  DE:{"agency": "Delaware Division of Health Care Quality", "registryUrl": "https://dhss.delaware.gov/dhcq/cna-registry/", "lookupUrl": "https://registry.prometric.com/publicDE", "phone": "(302) 421-7400"},
  DC:{"agency": "DC Health, Board of Nursing", "registryUrl": "https://dchealth.dc.gov/service/certified-nurse-aide", "lookupUrl": "https://cna365.examroom.ai/registry/?StateCode=DC", "phone": "(888) 274-6060"},
  FL:{"agency": "Florida Board of Nursing", "registryUrl": "https://floridasnursing.gov/certified-nursing-assistant/", "lookupUrl": "https://mqa-internet.doh.state.fl.us/MQASearchServices/Home", "phone": "(850) 488-0595"},
  GA:{"agency": "Georgia Nurse Aide Registry (Department of Community Health)", "registryUrl": "https://nurseaide.allianthealth.org/", "lookupUrl": "https://nurseaide.allianthealth.org/PageLinks?g=CNA", "phone": "(678) 527-3010"},
  HI:{"agency": "Hawaii Professional and Vocational Licensing", "registryUrl": "https://cca.hawaii.gov/pvl/programs/nurse/", "lookupUrl": "https://registry.prometric.com/registry/publicHI", "phone": "(800) 967-1200"},
  ID:{"agency": "Idaho Department of Health and Welfare", "registryUrl": "https://healthandwelfare.idaho.gov/providers/certified-nurse-assistant/about-certified-nurse-assistant-registry", "lookupUrl": "https://registry.prometric.com/publicID", "phone": "(800) 748-2480"},
  IL:{"agency": "Illinois Department of Public Health, Health Care Worker Registry", "registryUrl": "https://dph.illinois.gov/topics-services/health-care-regulation/health-care-worker-registry.html", "lookupUrl": "https://hcwrpub.dph.illinois.gov/Search.aspx", "phone": "(217) 785-5133"},
  IN:{"agency": "Indiana Department of Health", "registryUrl": "https://www.in.gov/health/ltc/aide-training-and-certification/cna/", "lookupUrl": "https://mylicense.in.gov/eVerification/", "phone": "(317) 233-7442"},
  IA:{"agency": "Iowa Department of Inspections, Appeals and Licensing", "registryUrl": "https://dial.iowa.gov/licenses/health/direct-care-worker-registry", "lookupUrl": "https://dia-hfd.iowa.gov/", "phone": "(515) 381-7835"},
  KS:{"agency": "Kansas Department for Aging and Disability Services", "registryUrl": "https://kdads.ks.gov/licensing-policy/health-occupations-credentialing", "lookupUrl": "https://ksdadsv7prod.glsuite.us/glsuiteweb/clients/ksdads/public/CertificationVerification.aspx", "phone": "(785) 296-6877"},
  KY:{"agency": "Kentucky Board of Nursing", "registryUrl": "https://kbn.ky.gov/state-registered-nurse-aide/Pages/default.aspx", "lookupUrl": "https://kybn.boardsofnursing.org/licenselookup", "phone": "(502) 429-3300"},
  LA:{"agency": "Louisiana Department of Health", "registryUrl": "https://ldh.la.gov/cnadsw", "lookupUrl": "https://tlc.dhh.la.gov/", "phone": "(225) 342-0138"},
  ME:{"agency": "Maine Department of Health and Human Services", "registryUrl": "https://www.maine.gov/dhhs/dlc/cna-registry", "lookupUrl": "https://www.pfr.maine.gov/almsonline/almsquery/SearchIndividual.aspx?board=6719", "phone": "(207) 287-3707"},
  MD:{"agency": "Maryland Board of Nursing", "registryUrl": "https://health.maryland.gov/mbon/Pages/nursing-assistant-certification.aspx", "lookupUrl": "https://mdchart.health.maryland.gov/CHART/s/license-lookup", "phone": "(410) 585-1900", "note": "Covers CNA-I and CNA-II."},
  MA:{"agency": "Massachusetts Department of Public Health", "registryUrl": "https://www.mass.gov/how-to/check-nurse-aide-certification", "lookupUrl": "https://checkahealthlicense.mass.gov", "phone": "(617) 753-8144"},
  MI:{"agency": "Michigan Department of Licensing and Regulatory Affairs", "registryUrl": "https://www.michigan.gov/lara/bureau-list/bchs/nurse-aide-registry", "lookupUrl": "https://nurseaideregistry.apps.lara.state.mi.us/", "phone": "(517) 284-8961"},
  MN:{"agency": "Minnesota Department of Health", "registryUrl": "https://www.health.state.mn.us/facilities/providers/nursingassistant/checkregistry.html", "lookupUrl": "https://nar.web.health.state.mn.us/certificate-search", "phone": "(651) 201-4200"},
  MS:{"agency": "Mississippi State Department of Health", "registryUrl": "https://msdh.ms.gov/page/30,0,83,74.html", "lookupUrl": "https://ms.tmutest.com/search", "phone": "(601) 364-2718"},
  MO:{"agency": "Missouri Department of Health and Senior Services", "registryUrl": "https://health.mo.gov/providers/cna-cmt-lima-insulin-registry/", "lookupUrl": "https://mo.tmutest.com/search", "phone": "(573) 526-5686"},
  MT:{"agency": "Montana Department of Public Health and Human Services", "registryUrl": "https://dphhs.mt.gov/oig/certification/cna", "lookupUrl": "https://mt-reports.com/portal/searchcertificate.aspx", "phone": "(406) 444-4980"},
  NE:{"agency": "Nebraska Department of Health and Human Services", "registryUrl": "https://dhhs.ne.gov/licensure/Pages/Nurse-Aide.aspx", "lookupUrl": "https://www.nebraska.gov/LISSearch/search.cgi", "phone": "(402) 471-4322"},
  NV:{"agency": "Nevada State Board of Nursing", "registryUrl": "https://nevadanursingboard.org/", "lookupUrl": "https://nvbn.boardsofnursing.org/licenselookup", "phone": "(888) 590-6726"},
  NH:{"agency": "New Hampshire Board of Nursing", "registryUrl": "https://www.oplc.nh.gov/new-hampshire-board-nursing", "lookupUrl": "https://nhlicenses.nh.gov/Verification/", "phone": "(603) 271-2323"},
  NJ:{"agency": "New Jersey Department of Health", "registryUrl": "https://www.nj.gov/health/healthfacilities/certification-licensing/nurse-aide-pc-assistant/", "lookupUrl": "https://njna.psiexams.com/", "phone": "(877) 774-4243"},
  NM:{"agency": "New Mexico Health Care Authority", "registryUrl": "https://www.hca.nm.gov/certified-nurse-aide-registry/", "lookupUrl": "https://nm.tmutest.com/search", "phone": null},
  NY:{"agency": "New York State Department of Health", "registryUrl": "https://www.health.ny.gov/health_care/consumer_information/nurse_aide_registry/", "lookupUrl": "https://registry.prometric.com/registry/public", "phone": "(800) 918-8818", "note": "Phone is the 24-hour verification line."},
  NC:{"agency": "NC Division of Health Service Regulation (Nurse Aide I)", "lookupLabel": "Nurse Aide I lookup", "registryUrl": "https://info.ncdhhs.gov/dhsr/hcpr/", "lookupUrl": "https://ncnar.ncdhhs.gov/verify_listings1.jsp", "phone": "(919) 855-3969", "also": {"agency": "North Carolina Board of Nursing (Nurse Aide II)", "lookupLabel": "Nurse Aide II lookup", "registryUrl": "https://www.ncbon.com/nurse-aide-ii", "lookupUrl": "https://portal.ncbon.com/licenseverification/search.aspx", "phone": "(919) 782-3211"}},
  ND:{"agency": "North Dakota Department of Health and Human Services", "registryUrl": "https://www.hhs.nd.gov/health-facilities/nurse-aide-registry", "lookupUrl": "https://services.ndhhs.gov/nurseaide/verify/", "phone": "(701) 328-2353"},
  OH:{"agency": "Ohio Department of Health", "registryUrl": "https://odh.ohio.gov/know-our-programs/nurse-aide-registry", "lookupUrl": "https://nurseaideregistry.odh.ohio.gov/Public/PublicNurseAideSearch", "phone": "(800) 582-5908"},
  OK:{"agency": "Oklahoma State Department of Health", "registryUrl": "https://oklahoma.gov/health/services/licensing-inspections/health-resources-development-service/nurse-aide-registry.html", "lookupUrl": "https://www.phin.state.ok.us/NARSWBSearch/Views/LandingView.aspx?id=5006", "phone": "(405) 426-8150"},
  OR:{"agency": "Oregon State Board of Nursing", "registryUrl": "https://www.oregon.gov/osbn/pages/primary_source_verification.aspx", "lookupUrl": "https://osbn.boardsofnursing.org/licenselookup", "phone": "(971) 673-0685"},
  PA:{"agency": "Pennsylvania Department of Health", "registryUrl": "https://www.pa.gov/agencies/health/business-registration-and-regulation/nurse-aide.html", "lookupUrl": "https://cna365.examroom.ai/registry/?StateCode=PA", "phone": "(888) 204-6249"},
  RI:{"agency": "Rhode Island Department of Health", "registryUrl": "https://health.ri.gov/nursing-assistant", "lookupUrl": "https://healthri.mylicense.com/verification/", "phone": "(401) 222-5888"},
  SC:{"agency": "South Carolina Department of Health and Human Services", "registryUrl": "https://scdhhs.gov/resources/programs-and-initiatives/long-term-living/nursing-facilities/nurse-aide", "lookupUrl": "https://cna365.examroom.ai/registry/?StateCode=SC", "phone": "(888) 549-0820"},
  SD:{"agency": "South Dakota Board of Nursing", "registryUrl": "https://www.sduap.org/", "lookupUrl": "https://www.sduap.org/verify/", "phone": "(605) 362-2760"},
  TN:{"agency": "Tennessee Health Facilities Commission", "registryUrl": "https://www.tn.gov/hfc/division-of-licensure-and-regulation/nurse-aide-information.html", "lookupUrl": "https://cna365.examroom.ai/registry/?StateCode=TN", "phone": "(615) 532-5171"},
  TX:{"agency": "Texas Health and Human Services Commission", "registryUrl": "https://www.hhs.texas.gov/doing-business-hhs/licensing-credentialing-regulation/credentialing/nurse-aide-registry", "lookupUrl": "https://tulip.hhs.texas.gov/TULIP/s/public-search", "phone": "(512) 438-2050"},
  UT:{"agency": "Utah Nursing Assistant Registry", "registryUrl": "https://utahcnaregistry.com/", "lookupUrl": "https://ut.tmutest.com/search", "phone": "(801) 547-9947"},
  VT:{"agency": "Vermont Office of Professional Regulation", "registryUrl": "https://sos.vermont.gov/nursing/", "lookupUrl": "https://sos.vermont.gov/opr/find-a-professional", "phone": "(802) 828-1505", "note": "Vermont calls CNAs Licensed Nursing Assistants (LNAs)."},
  VA:{"agency": "Virginia Board of Nursing", "registryUrl": "https://www.dhp.virginia.gov/Boards/Nursing/", "lookupUrl": "https://dhp.virginiainteractive.org/Lookup/Index", "phone": "(804) 367-4515"},
  WA:{"agency": "Washington State Board of Nursing", "registryUrl": "https://nursing.wa.gov/education/nursing-assistant-training/na-program-student-info/nursing-assistant-certification-nac-information", "lookupUrl": "https://wahelms.my.site.com/s/license-search", "phone": "(360) 236-4703", "note": "Washington calls CNAs Nursing Assistants-Certified (NA-C)."},
  WV:{"agency": "West Virginia Office of Health Facility Licensure and Certification", "registryUrl": "https://ohflac.wvdhhr.org/Programs/NA.html", "lookupUrl": "https://ohflac.wvdhhr.org/Apps/Lookup/NALookup", "phone": "(304) 558-0050"},
  WI:{"agency": "Wisconsin Department of Health Services", "registryUrl": "https://www.dhs.wisconsin.gov/caregiver/nurse-aide/index.htm", "lookupUrl": "https://wi.tmutest.com/", "phone": "(888) 401-0465"},
  WY:{"agency": "Wyoming Department of Health", "registryUrl": "https://health.wyo.gov/aging/hls/certified-nurse-aides/", "lookupUrl": "https://cnaregistry.health.wyo.gov", "phone": "(307) 777-7123"}
};

export const NURSE_AIDE_REGISTRIES:ReadonlyArray<NurseAideRegistry&{name:string;slug:string}>=US_STATES
  .filter(([code])=>DATA[code])
  .map(([code,name])=>({code,name,slug:slugify(name),...DATA[code]}));
