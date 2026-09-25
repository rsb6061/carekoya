import argparse, hashlib, json, re, subprocess, unicodedata
from pathlib import Path

SOURCE="maryland_mbon_natp"
SOURCE_URL="https://mbon.maryland.gov/Documents/approved-cna-training-programs-grid.pdf"
PROVIDERS=[
    "Developmental Disabilities Administration","Freestanding Program","Dialysis Facility",
    "Nursing Home","High School","EMT to CNA","Hospital","College"
]
MONTH=r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Janauary|Seprember)"
STATUS_RE=re.compile(r"\b(Withdrawn Approval|Approved|Closed)\b",re.I)
DATE_RE=re.compile(r"\b"+MONTH+r"\s+\d{4}\b",re.I)

def clean(v): return re.sub(r"\s+"," ",str(v or "").replace("\x0c"," ")).strip()
def esc(v): return "NULL" if v is None or v=="" else "'" + str(v).replace("'","''") + "'"
def slugify(v):
    s=unicodedata.normalize("NFKD",clean(v)).encode("ascii","ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+","-",s).strip("-")[:72] or "program"
def key_for(name,address,ptype): return hashlib.sha256((clean(name).lower()+"|"+clean(address).lower()+"|"+clean(ptype).lower()).encode()).hexdigest()
def pid(key): return "tp_"+hashlib.sha256((SOURCE+"|"+key).encode()).hexdigest()[:24]
def referral_slug(name,city,key):
    base=slugify(name)
    if city: base=(base+"-"+slugify(city))[:82].strip("-")
    return base+"-"+key[:6]

def parse_city_state_zip(text):
    matches=list(re.finditer(r"([A-Za-z][A-Za-z .\-'’]+?),?\s+(?:MD|Maryland),?\s*(\d{5})(?:-\d{4})?",clean(text),re.I))
    if not matches: return "","MD",""
    m=matches[-1]
    city=clean(m.group(1))
    # City is the tail immediately before state; strip obvious address/unit tokens if they leaked in.
    city=re.split(r"\b(?:Suite|Ste\.?|Room|Rm\.?|Floor|P\.O\. Box|PO Box|#\s*\w+)\b",city,flags=re.I)[-1].strip(" ,.")
    words=city.split()
    if len(words)>4: city=" ".join(words[-4:])
    return city,"MD",m.group(2)

def detect_provider(window_text):
    lower=window_text.lower()
    hits=[]
    for p in PROVIDERS:
        for m in re.finditer(re.escape(p.lower()),lower):
            hits.append((m.start(),p))
    return hits[-1][1] if hits else ""

def extract(pdf_path):
    proc=subprocess.run(["pdftotext","-layout","-nopgbrk",str(pdf_path),"-"],check=True,capture_output=True,text=True)
    text=proc.stdout
    updated=re.search(r"Last Updated\s+(\d{1,2}/\d{1,2}/\d{4})",text,re.I)
    source_updated=updated.group(1) if updated else ""

    raw=text.splitlines()
    # Header geometry: the provider column begins around the second header label, address around third, status around fourth.
    header=next((line for line in raw if "Program Provider" in line and "Type of Provider" in line and "Address of Program" in line),None)
    if not header: raise RuntimeError("Could not locate MBON table header")
    provider_x=header.find("Type of Provider")
    address_x=header.find("Address of Program")
    status_x=header.find("Current Status")
    if min(provider_x,address_x,status_x)<0: raise RuntimeError("Could not determine MBON table geometry")

    def ignorable(line):
        low=clean(line).lower()
        return (not low or low.startswith("approved nursing assistant training programs") or
            ("program provider" in low and "type of provider" in low) or
            low.startswith("certified medicine aide programs") or
            low.startswith("certified nursing assistant training programs") or
            low.startswith("closed training programs") or low.startswith("cna-only training programs") or
            low.startswith("last updated"))

    lines=[line for line in raw if not ignorable(line)]
    anchors=[i for i,line in enumerate(lines) if STATUS_RE.search(line) and len(DATE_RE.findall(line))>=1]

    records=[]
    seen=set()
    for n,anchor in enumerate(anchors):
        prev=anchors[n-1] if n else -1
        nxt=anchors[n+1] if n+1<len(anchors) else len(lines)
        top=max(prev+1,(prev+anchor)//2+1)
        bottom=min(nxt-1,(anchor+nxt)//2)
        window=lines[top:bottom+1]
        anchor_line=lines[anchor]
        sm=STATUS_RE.search(anchor_line)
        if not sm: continue
        status=sm.group(1)

        # The program/provider/address columns can wrap vertically. Collect only their geometric slices.
        name_parts=[];provider_parts=[];address_parts=[]
        for line in window:
            padded=line+" "*(status_x+4-len(line))
            left=clean(padded[:provider_x])
            mid=clean(padded[provider_x:address_x])
            addr=clean(padded[address_x:status_x])
            if left and not re.match(r"^\d",left) and not re.search(r"\bMD\s+\d{5}\b",left,re.I):
                name_parts.append(left)
            if mid: provider_parts.append(mid)
            if addr: address_parts.append(addr)

        name=clean(" ".join(dict.fromkeys(name_parts)))
        provider_blob=clean(" ".join(provider_parts))
        address_blob=clean(" ".join(address_parts))
        full_window=clean(" ".join(window))
        provider=detect_provider(provider_blob+" "+full_window)
        if not provider:
            continue

        # Remove provider text if PDF geometry caused it to leak into the program name.
        name=re.sub(r"\b"+re.escape(provider)+r"\b.*$","",name,flags=re.I).strip()
        if not name:
            # Fallback: use anchor prefix before provider/status.
            prefix=clean(anchor_line[:sm.start()])
            idx=prefix.lower().rfind(provider.lower())
            name=clean(prefix[:idx] if idx>0 else prefix)

        tail=clean(anchor_line[sm.end():])
        # Sometimes long program-type/date text wraps to the next physical line.
        if len(DATE_RE.findall(tail))<2:
            for extra in window[window.index(anchor_line)+1:] if anchor_line in window else []:
                tail=clean(tail+" "+clean(extra[status_x:]))
                if len(DATE_RE.findall(tail))>=2: break

        dates=list(DATE_RE.finditer(tail))
        if not dates: continue
        program_type=clean(tail[:dates[0].start()])
        if "nursing assistant" not in program_type.lower(): continue
        date_values=[clean(m.group(0)).replace("Janauary","January").replace("Seprember","September") for m in dates]
        last_approved=date_values[0] if len(date_values)>0 else ""
        renewal=date_values[1] if len(date_values)>1 else ""
        trailing=clean(tail[dates[1].end():]) if len(dates)>1 else ""

        # Address/city may straddle the provider/address columns, so parse location from the whole window.
        city,state,zip_code=parse_city_state_zip(full_window)
        address=address_blob or full_window
        key=key_for(name,address,program_type)
        if key in seen: continue
        seen.add(key)
        supply_relevant="-dt" not in program_type.lower()
        active=status.lower()=="approved" and supply_relevant
        records.append({
            "id":pid(key),"source_key":key,"program_name":name,"provider_type":provider,
            "address":address,"city":city,"state":state,"zip":zip_code,
            "current_status":status,"program_type":program_type,"date_last_approved":last_approved,
            "renewal_due":renewal,"date_closed":trailing if status.lower()=="closed" else "",
            "date_withdrawn":trailing if status.lower().startswith("withdrawn") else "",
            "source_updated_at":source_updated,"is_active":1 if active else 0,
            "referral_slug":referral_slug(name,city,key)
        })
    return records,source_updated

def main():
    ap=argparse.ArgumentParser();ap.add_argument("pdf");ap.add_argument("output");args=ap.parse_args()
    records,updated=extract(args.pdf)
    if len(records)<50:
        raise SystemExit(f"Only {len(records)} nursing-assistant rows parsed; refusing partial directory import")
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

if __name__=="__main__": main()
