/// <reference types="vite/client" />

export type ParsedResume = {
  text:string;
  firstName:string;
  lastName:string;
  email:string;
  phone:string;
  zip:string;
  role:string;
  certifications:string[];
  specialties:string[];
  languages:string[];
};

const clean=(v:string)=>v.replace(/\s+/g,' ').trim();
const unique=(items:string[])=>Array.from(new Set(items.filter(Boolean)));

function findEmail(text:string){
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||'';
}
function findPhone(text:string){
  const match=text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
  return match?.[0]?.replace(/\s+/g,' ').trim()||'';
}
function findZip(text:string){
  return text.match(/\b(?:20[6-9]|21[0-9])\d{2}\b/)?.[0]||text.match(/\b\d{5}(?:-\d{4})?\b/)?.[0]||'';
}
function findName(text:string,email:string,phone:string){
  const lines=text.split(/\r?\n/).map(clean).filter(Boolean).slice(0,12);
  for(const line of lines){
    if(line===email||line.includes('@')||line.includes(phone)||/resume|curriculum|objective|summary|profile|professional/i.test(line))continue;
    if(/\d{3}/.test(line)||line.length>60)continue;
    const words=line.replace(/[^A-Za-z' -]/g,'').trim().split(/\s+/).filter(Boolean);
    if(words.length>=2&&words.length<=4&&words.every(w=>w.length>1)){
      return {firstName:words[0],lastName:words[words.length-1]};
    }
  }
  return {firstName:'',lastName:''};
}
function detectRole(text:string){
  const t=text.toLowerCase();
  const roles:[string,RegExp][]=[
    ['CNA',/\b(cna|cna-i|certified nursing assistant|nursing assistant)\b/i],
    ['GNA',/\b(gna|geriatric nursing assistant)\b/i],
    ['HHA',/\b(hha|home health aide)\b/i],
    ['PCA',/\b(pca|personal care aide|personal care assistant)\b/i],
    ['DSP',/\b(dsp|direct support professional|direct care worker)\b/i],
    ['Caregiver',/\b(caregiver|care giver|companion caregiver|private duty caregiver)\b/i]
  ];
  for(const [role,re] of roles)if(re.test(t))return role;
  return 'Caregiver';
}
function detectCertifications(text:string){
  const rules:[string,RegExp][]=[
    ['CNA',/\b(cna|certified nursing assistant)\b/i],
    ['CNA-I',/\bcna[- ]?i\b/i],
    ['GNA',/\b(gna|geriatric nursing assistant)\b/i],
    ['HHA',/\b(hha|home health aide)\b/i],
    ['CMT',/\b(cmt|certified medication technician)\b/i],
    ['CPR',/\bcpr\b/i],
    ['BLS',/\bbls\b|basic life support/i],
    ['First Aid',/first aid/i]
  ];
  return unique(rules.filter(([,re])=>re.test(text)).map(([name])=>name));
}
function detectSpecialties(text:string){
  const rules:[string,RegExp][]=[
    ['Dementia / Alzheimer’s',/dementia|alzheimer/i],
    ['ADLs',/\badls?\b|activities of daily living/i],
    ['Bathing & dressing',/bathing|dressing|grooming/i],
    ['Toileting',/toileting|incontinence care/i],
    ['Transfers',/transfer assistance|patient transfer|transfers/i],
    ['Hoyer lift',/hoyer/i],
    ['Gait belt',/gait belt/i],
    ['Vital signs',/vital signs|blood pressure|temperature|pulse/i],
    ['Hospice',/hospice|end[- ]of[- ]life/i],
    ['Companionship',/companionship|companion care/i],
    ['Meal preparation',/meal prep|meal preparation|cooking/i],
    ['Medication reminders',/medication reminder/i],
    ['Medication administration',/medication administration|medication technician/i],
    ['Light housekeeping',/housekeeping|laundry/i],
    ['Transportation',/transportation|driving clients|appointments/i],
    ['Developmental disabilities',/developmental disabilit|intellectual disabilit|autism/i],
    ['Behavioral support',/behavioral support|behavior plan/i],
    ['Wound care',/wound care/i]
  ];
  return unique(rules.filter(([,re])=>re.test(text)).map(([name])=>name));
}
function detectLanguages(text:string){
  const names=['English','Spanish','French','Arabic','Amharic','Haitian Creole','Mandarin','Cantonese','Korean','Vietnamese','Tagalog','Russian'];
  return names.filter(x=>new RegExp('\\b'+x.replace(' ','\\s+')+'\\b','i').test(text));
}
function structure(text:string):ParsedResume{
  const email=findEmail(text);
  const phone=findPhone(text);
  const name=findName(text,email,phone);
  return {
    text,
    firstName:name.firstName,
    lastName:name.lastName,
    email,
    phone,
    zip:findZip(text),
    role:detectRole(text),
    certifications:detectCertifications(text),
    specialties:detectSpecialties(text),
    languages:detectLanguages(text)
  };
}

async function pdfText(file:File){
  const pdfjs=await import('pdfjs-dist');
  const worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
  const data=new Uint8Array(await file.arrayBuffer());
  const pdf=await pdfjs.getDocument({data}).promise;
  const pages:string[]=[];
  for(let i=1;i<=Math.min(pdf.numPages,12);i++){
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    pages.push(content.items.map((item:any)=>typeof item.str==='string'?item.str:'').join(' '));
  }
  return pages.join('\n');
}

async function docxText(file:File){
  const mammoth=await import('mammoth/mammoth.browser');
  const result=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
  return result.value||'';
}

export async function parseResumeFile(file:File):Promise<ParsedResume>{
  if(file.size>8*1024*1024)throw new Error('Please upload a resume smaller than 8 MB.');
  const name=file.name.toLowerCase();
  let text='';
  if(file.type==='application/pdf'||name.endsWith('.pdf'))text=await pdfText(file);
  else if(name.endsWith('.docx')||file.type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document')text=await docxText(file);
  else if(name.endsWith('.txt')||file.type==='text/plain')text=await file.text();
  else throw new Error('Upload a PDF, DOCX, or TXT resume.');
  text=text.replace(/\u0000/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim().slice(0,50000);
  if(text.length<40)throw new Error('We could not read enough text from that resume. Try another PDF/DOCX or start from scratch.');
  return structure(text);
}
