import argparse, hashlib, json, re, subprocess, sys
from pathlib import Path

SOURCE="maryland_mbon_natp"
SOURCE_URL="https://mbon.maryland.gov/Documents/approved-cna-training-programs-grid.pdf"

def clean(v):
    return re.sub(r"\s+"," ",str(v or "").replace("\n"," ")).strip()

def esc(v):
    if v is None or v == "": return "NULL"
    return "'" + str(v).replace("'","''") + "'"

def slugify(v):
    s=clean(v).lower()
    s=re.sub(r"[^a-z0-9]+","-",s).strip("-")
    return s[:72] or "program"

def parse_city_state_zip(address):
    s=clean(address)
    m=re.search(r"([A-Za-z .'-]+?)[,.]?\s+(MD|Maryland)\s+(\d{5})(?:-\d{4})?\b",s,re.I)
    if not m:
        return "","MD",""
    city=clean(m.group(1))
    # Keep only trailing city phrase after likely street/unit content.
    city=re.split(r"\b(?:Suite|Ste\.?|#|Room|Rm\.?|P\.O\. Box|PO Box)\b",city,flags=re.I)[-1].strip(" ,.")
    words=city.split()
    if len(words)>5:
        city=" ".join(words[-4:])
    return city,"MD",m.group(3)

def row_key(program,address,program_type):
    raw="|".join([clean(program).lower(),clean(address).lower(),clean(program_type).lower()])
    return hashlib.sha256(raw.encode()).hexdigest()

def program_id(key):
    return "tp_"+hashlib.sha256((SOURCE+"|"+key).encode()).hexdigest()[:24]

def referral_slug(program,city,key):
    base=slugify(program)
    if city:
        base=(base+"-"+slugify(city))[:82].strip("-")
    return base+"-"+key[:6]

HEADER_LABELS=[
    "Program Provider","Type of Provider","Address of Program","Current Status",
    "Type of Program","Date Last Approved","Renewal Due","Date Closed","Date Withdrawn"
]

def extract_rows(pdf_path):
    proc=subprocess.run(
        ["pdftotext","-layout","-nopgbrk",str(pdf_path),"-"],
        check=True,capture_output=True,text=True
    )
    text=proc.stdout
    updated_match=re.search(r"Last Updated\\s+(\\d{1,2}/\\d{1,2}/\\d{4})",text,re.I)
    source_updated=updated_match.group(1) if updated_match else ""

    raw_lines=text.splitlines()
    header=next((line for line in raw_lines if all(label in line for label in HEADER_LABELS)),None)
    if not header:
        raise RuntimeError("Could not locate training-program table header")
    starts=[header.find(label) for label in HEADER_LABELS]
    if any(x<0 for x in starts):
        raise RuntimeError("Could not determine training-program column positions")

    def cells(line):
        padded=line+" "*(starts[-1]+80-len(line))
        vals=[]
        for i,start in enumerate(starts):
            stop=starts[i+1] if i+1<len(starts) else len(padded)
            vals.append(clean(padded[start:stop]))
        return vals

    lines=[]
    for line in raw_lines:
        low=clean(line).lower()
        if not low: continue
        if "program provider" in low and "type of provider" in low: continue
        if low.startswith("approved nursing assistant training programs"): continue
        if low.startswith("certified medicine aide programs"): continue
        if low.startswith("certified nursing assistant training programs"): continue
        if low.startswith("closed training programs"): continue
        if low.startswith("cna-only training programs"): continue
        if low.startswith("last updated"): continue
        lines.append(line)

    anchors=[]
    for idx,line in enumerate(lines):
        row=cells(line)
        if re.search(r"\\b(?:Approved|Closed|Withdrawn Approval)\\b",row[3],re.I):
            anchors.append(idx)

    records=[]
    for pos,anchor in enumerate(anchors):
        prev_anchor=anchors[pos-1] if pos>0 else -1
        next_anchor=anchors[pos+1] if pos+1<len(anchors) else len(lines)
        top=(prev_anchor+anchor)//2+1
        bottom=(anchor+next_anchor)//2
        grouped=[cells(lines[i]) for i in range(top,bottom+1) if 0<=i<len(lines)]

        cols=[]
        for col in range(9):
            parts=[row[col] for row in grouped if row[col]]
            cols.append(clean(" ".join(parts)))

        program,provider,address,status,ptype,last_approved,renewal,closed,withdrawn=cols
        if "nursing assistant" not in ptype.lower():
            continue
        if not program or not provider:
            continue

        city,state,zip_code=parse_city_state_zip(address)
        key=row_key(program,address,ptype)
        active=(
            status.lower()=="approved"
            and "only training program" not in ptype.lower()
            and "-dt" not in ptype.lower()
        )
        records.append({
            "id":program_id(key),"source_key":key,"program_name":program,
            "provider_type":provider,"address":address,"city":city,"state":state,"zip":zip_code,
            "current_status":status,"program_type":ptype,"date_last_approved":last_approved,
            "renewal_due":renewal,"date_closed":closed,"date_withdrawn":withdrawn,
            "source_updated_at":source_updated,"is_active":1 if active else 0,
            "referral_slug":referral_slug(program,city,key),
        })

    unique={}
    for r in records:
        unique[r["source_key"]]=r
    if not unique:
        print("No parsed records. Column starts:",starts,file=sys.stderr)
        for line in lines[:100]:
            print(cells(line),file=sys.stderr)
    return list(unique.values()),source_updated

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("output")
    args=ap.parse_args()

    records,updated=extract_rows(args.pdf)
    if not records:
        raise SystemExit("No training-program rows parsed from PDF")

    relevant=[r for r in records if "nursing assistant" in r["program_type"].lower() and "-dt" not in r["program_type"].lower()]
    active=[r for r in relevant if r["is_active"]]
    print(json.dumps({
        "sourceUpdated":updated,
        "parsedRows":len(records),
        "nursingAssistantRows":len(relevant),
        "activeNursingAssistantPrograms":len(active),
        "providerTypes":{},
    }))
    providers={}
    for r in active:
        providers[r["provider_type"]]=providers.get(r["provider_type"],0)+1
    print(json.dumps({"activeProviderTypes":providers},sort_keys=True))

    out=[]
    out.append("UPDATE training_programs SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE source="+esc(SOURCE)+";")
    for r in records:
        out.append(f"""INSERT INTO training_programs (
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
            out.append(f"""INSERT INTO school_referral_codes(id,training_program_id,slug,status,updated_at)
              VALUES ({esc(rid)},{esc(r['id'])},{esc(r['referral_slug'])},'active',CURRENT_TIMESTAMP)
              ON CONFLICT(slug) DO UPDATE SET training_program_id=excluded.training_program_id,status='active',updated_at=CURRENT_TIMESTAMP;""")
    Path(args.output).write_text("\n".join(out))
    print("SQL written",args.output)

if __name__=="__main__":
    main()
