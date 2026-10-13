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
  yearsExperience:number|null;
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
// A name typed in capitals (YOLANDA BRIGHTWATER) is stored the way people write it (Yolanda Brightwater).
const nameCase=(w:string)=>w===w.toUpperCase()||w===w.toLowerCase()?w.toLowerCase().replace(/(^|[-'])([a-z])/g,(_,a,b)=>a+b.toUpperCase()):w;
function findName(text:string,email:string,phone:string){
  const lines=text.split(/\r?\n/).map(clean).filter(Boolean).slice(0,12);
  for(const line of lines){
    if(line===email||line.includes('@')||(phone&&line.includes(phone))||/resume|curriculum|objective|summary|profile|professional|experience|education|skills/i.test(line))continue;
    if(/\d{3}/.test(line)||line.length>60)continue;
    const words=line.replace(/[^A-Za-z' -]/g,'').trim().split(/\s+/).filter(Boolean);
    if(words.length>=2&&words.length<=4&&words.every(w=>w.length>1)){
      return {firstName:nameCase(words[0]),lastName:nameCase(words[words.length-1])};
    }
  }
  return {firstName:'',lastName:''};
}
/** "Spokane, WA 12345": the ZIP that follows a state, before any other 5-digit number. */
function findZip(text:string){
  return text.match(/\b[A-Z]{2}\.?,?\s+(\d{5})(?:-\d{4})?\b/)?.[1]||text.match(/\b(?:20[6-9]|21[0-9])\d{2}\b/)?.[0]||text.match(/\b\d{5}(?:-\d{4})?\b/)?.[0]||'';
}
/** "14 years of experience", "14 years across…": the largest such number, capped at 60. */
function findYears(text:string){
  const years=[...text.matchAll(/\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/gi)].map(m=>Number(m[1])).filter(n=>n>0&&n<=60);
  return years.length?Math.max(...years):null;
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
export function structure(text:string):ParsedResume{
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
    languages:detectLanguages(text),
    yearsExperience:findYears(text)
  };
}

type PdfItem={str?:string;hasEOL?:boolean;transform?:number[]};
/** Rebuilds a PDF page's lines: a new line wherever the PDF ends one or the text moves down the page.
 *  Joining everything with spaces made the whole page one line, so the name at the top was never found. */
export function pdfItemsText(items:PdfItem[]){
  let out='',lastY:number|null=null;
  for(const item of items){
    const y=item.transform?.[5]??null;
    if(lastY!=null&&y!=null&&Math.abs(y-lastY)>2&&!out.endsWith('\n'))out+='\n';
    else if(out&&!out.endsWith('\n')&&!out.endsWith(' ')&&item.str)out+=' ';
    out+=item.str||'';
    if(item.hasEOL)out+='\n';
    if(y!=null)lastY=y;
  }
  return out;
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
    pages.push(pdfItemsText(content.items as PdfItem[]));
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
