import argparse, hashlib, json, re, subprocess, unicodedata
from pathlib import Path

SOURCE="maryland_mbon_natp"
SOURCE_URL="https://mbon.maryland.gov/Documents/approved-cna-training-programs-grid.pdf"

PROVIDER_TYPES=[
    "Developmental Disabilities Administration",
    "Freestanding Program",
    "Dialysis Facility",
    "Nursing Home",
    "High School",
    "EMT to CNA",
    "Hospital",
    "College",
]
MONTH=r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Janauary|Seprember)"

def clean(v):
    return re.sub(r"\s+"," ",str(v or "").replace("\x0c"," ")).strip()

def esc(v):
    if v is None or v=="": return "NULL"
    return "'" + str(v).replace("'","''") + "'"

def slugify(v):
    s=unicodedata.normalize("NFKD",clean(v)).encode("ascii","ignore").decode().lower()
    s=re.sub(r"[^a-z0-9]+","-",s).strip("-")
    return s[:72] or "program"

def parse_city_state_zip(address):
    s=clean(address)
    matches=list(re.finditer(r"([A-Za-z][A-Za-z .\-'’]+?),?\s+(?:MD|Maryland),?\s*(\d{5})(?:-\d{4})?",s,re.I))
    if not matches: return "","MD",""
    m=matches[-1]
    city=clean(m.group(1))
    # Keep final city words, not street/unit text accidentally captured.
    city=re.split(r"\b(?:Suite|Ste\.?|Room|Rm\.?|P\.O\. Box|PO Box|Floor|#\s*\w+)\b",city,flags=re.I)[-1].strip(" ,.")
    words=city.split()
    if len(words)>4: city=" ".join(words[-4:])
    return city,"MD",m.group(2)

def key_for(name,address,ptype):
    return hashlib.sha256((clean(name).lower()+"|"+clean(address).lower()+"|"+clean(ptype).lower()).encode()).hexdigest()

def pid(key):
    return "tp_"+hashlib.sha256((SOURCE+"|"+key).encode()).hexdigest()[:24]

def referral_slug(name,city,key):
    base=slugify(name)
    if city: base=(base+"-"+slugify(city))[:82].strip("-")
    return base+"-"+key[:6]

def extract(pdf_path):
    proc=subprocess.run(["pdftotext","-nopgbrk",str(pdf_path),"-"],check=True,capture_output=True,text=True)
    text=proc.stdout
    updated=re.search(r"Last Updated\s+(\d{1,2}/\d{1,2}/\d{4})",text,re.I)
    source_updated=updated.group(1) if updated else ""

    lines=[]
    for raw in text.splitlines():
        line=clean(raw)
        low=line.lower()
        if not line: continue
        if low.startswith("approved nursing assistant training programs"): continue
        if "program provider" in low and "type of provider" in low: continue
        if low.startswith("certified medicine aide programs"): continue
        if low.startswith("certified nursing assistant training programs"): continue
        if low.startswith("closed training programs"): continue
        if low.startswith("cna-only training programs"): continue
        if low.startswith("last updated"): continue
        lines.append(line)

    # A record ends when its status/program/date fields appear. This is more stable than PDF column geometry.
    raw_records=[]
    buf=[]
    end_re=re.compile(r"\b(?:Approved|Closed|Withdrawn Approval)\b.*?\b"+MONTH+r"\s+\d{4}\b",re.I)
    for line in lines:
        buf.append(line)
        joined=clean(" ".join(buf))
        date_count=len(re.findall(r"\b"+MONTH+r"\s+\d{4}\b",joined,re.I))
        if end_re.search(joined) and date_count>=2:
            raw_records.append(joined)
            buf=[]

    records=[]
    seen=set()
    for raw in raw_records:
        status_match=None
        status=""
        for label in ["Withdrawn Approval","Approved","Closed"]:
            m=re.search(r"\b"+re.escape(label)+r"\b",raw,re.I)
            if m and (status_match is None or m.start()<status_match.start()):
                status_match=m;status=label
        if not status_match: continue

        before=clean(raw[:status_match.start()])
        after=clean(raw[status_match.end():])

        # Provider type is the rightmost known type before the status; this handles names like "Atlantic General Hospital".
        best_idx=-1;provider=""
        lower=before.lower()
        for candidate in PROVIDER_TYPES:
            idx=lower.rfind(candidate.lower())
            if idx>best_idx:
                best_idx=idx;provider=candidate
        if best_idx<1: continue

        name=clean(before[:best_idx])
        address=clean(before[best_idx+len(provider):])
        if not name: continue

        dates=list(re.finditer(r"\b"+MONTH+r"\s+(\d{4})\b",after,re.I))
        ptype=clean(after[:dates[0].start()]) if dates else after
        if "nursing assistant" not in ptype.lower(): continue

        date_values=[clean(m.group(0)).replace("Janauary","January").replace("Seprember","September") for m in dates]
        last_approved=date_values[0] if len(date_values)>0 else ""
        renewal=date_values[1] if len(date_values)>1 else ""
        trailing=clean(after[dates[1].end():]) if len(dates)>1 else ""
        closed=trailing if status.lower()=="closed" else ""
        withdrawn=trailing if status.lower().startswith("withdrawn") else ""

        city,state,zip_code=parse_city_state_zip(address)
        key=key_for(name,address,ptype)
        if key in seen: continue
        seen.add(key)

        # CareJoys supply acquisition focuses on CNA/GNA training, not dialysis-tech/CMA-only programs.
        supply_relevant=("nursing assistant" in ptype.lower() and "-dt" not in ptype.lower())
        active=(status.lower()=="approved" and supply_relevant)

        records.append({
            "id":pid(key),"source_key":key,"program_name":name,"provider_type":provider,
            "address":address,"city":city,"state":state,"zip":zip_code,
            "current_status":status,"program_type":ptype,"date_last_approved":last_approved,
            "renewal_due":renewal,"date_closed":closed,"date_withdrawn":withdrawn,
            "source_updated_at":source_updated,"is_active":1 if active else 0,
            "referral_slug":referral_slug(name,city,key),
        })

    return records,source_updated

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("pdf");ap.add_argument("output")
    args=ap.parse_args()

    records,updated=extract(args.pdf)
    if not records:
        raise SystemExit("No nursing-assistant program rows parsed from PDF")

    active=[r for r in records if r["is_active"]]
    providers={}
    for r in active: providers[r["provider_type"]]=providers.get(r["provider_type"],0)+1
    print(json.dumps({"sourceUpdated":updated,"parsedRows":len(records),"activePrograms":len(active),"activeProviderTypes":providers},sort_keys=True))

    statements=[f"UPDATE training_programs SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE source={esc(SOURCE)};"]
    for r in records:
        statements.append(f"""INSERT INTO training_programs (
          id,source,source_key,program_name,provider_type,address,city,state,zip,current_status,program_type,
          date_last_approved,renewal_due,date_closed,date_withdrawn,source_url,source_updated_at,is_active,last_source_sync_at,updated_at
        ) VALUES (
          {esc(r['id'])},{esc(SOURCE)},{esc(r['source_key'])},{esc(r['program_name'])},{esc(r['provider_type'])},{esc(r['address'])},
          {esc(r['city'])},{esc(r['state'])},{esc(r['zip'])},{esc(r['current_status'])},{esc(r['program_type'])},
          {esc(r['date_last_approved'])},{esc(r['renewal_due'])},{esc(r['date_closed'])},{esc(r['date_withdrawn'])},
          {esc(SOURCE_URL)},{esc(r['source_updated_at'])},{r['is_active']},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
        )
        ON CONFLICT(source,source_key) DO UPDATE SET
          program_name=excluded.program_name,provider_type=excluded.provider_type,address=excluded.address,city=excluded.city,
          state=excluded.state,zip=excluded.zip,current_status=excluded.current_status,program_type=excluded.program_type,
          date_last_approved=excluded.date_last_approved,renewal_due=excluded.renewal_due,date_closed=excluded.date_closed,
          date_withdrawn=excluded.date_withdrawn,source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,
          is_active=excluded.is_active,last_source_sync_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP;""")
        if r["is_active"]:
            rid="src_"+hashlib.sha256(("referral|"+r["id"]).encode()).hexdigest()[:24]
            statements.append(f"""INSERT INTO school_referral_codes(id,training_program_id,slug,status,updated_at)
              VALUES ({esc(rid)},{esc(r['id'])},{esc(r['referral_slug'])},'active',CURRENT_TIMESTAMP)
              ON CONFLICT(slug) DO UPDATE SET training_program_id=excluded.training_program_id,status='active',updated_at=CURRENT_TIMESTAMP;""")

    Path(args.output).write_text("\n".join(statements))
    print("SQL written",args.output)

if __name__=="__main__":
    main()
