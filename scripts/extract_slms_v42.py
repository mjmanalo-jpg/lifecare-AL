#!/usr/bin/env python3
"""Extract SLMS v4.2 rule tables from the governing workbook into committed JSON.

Source of truth: `SLMS_v4.2_AS_Goals_Tasks_24-Hour_Routine (2).xlsx` (repo root).
Outputs (apps/frontend/src/lib/lifecare/data/):
  - loc_bundles.json           (LOC Standard Routine Bundles, 61 events)
  - condition_pathways.json    (Conditional Bundle Activation, 20 pathways)
  - result_schemas.json        (Care Event Result Fields, 16 event types)
  - as_care_delivery_map.json  (AS Care Delivery Map, 14 domains x 0-4)

The app has NO runtime dependency on this script or openpyxl — the committed JSON
is the artifact. Re-run + re-commit when the workbook version changes.

Requires: pip install openpyxl   (Foundations spec 2026-09-05-slms-routine-foundations-design.md)
"""
import json, os, re, sys
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(ROOT, "SLMS_v4.2_AS_Goals_Tasks_24-Hour_Routine (2).xlsx")
OUT = os.path.join(ROOT, "apps", "frontend", "src", "lib", "lifecare", "data")
SRC_VERSION = "SLMS_v4.2_(2)"

wb = openpyxl.load_workbook(XLSX, data_only=True)


def clean(v):
    if v is None:
        return ""
    return str(v).replace("\r", "").strip()


def rows_after_header(sheet_name, header_token):
    """Return list of row-tuples (as clean str lists) after the header row whose
    first cells contain header_token; stops at the first all-empty row."""
    ws = wb[sheet_name]
    grid = [[clean(c) for c in row] for row in ws.iter_rows(values_only=True)]
    hdr_idx = next(i for i, r in enumerate(grid) if header_token in r)
    headers = grid[hdr_idx]
    out = []
    for r in grid[hdr_idx + 1:]:
        if not any(r):
            continue
        out.append((headers, r))
    return out


def as_dict(headers, row):
    d = {}
    for h, v in zip(headers, row):
        if h:
            d[h] = v
    return d


def split_list(s, seps=(";", "\n", ",")):
    if not s:
        return []
    parts = [s]
    for sep in seps:
        parts = [p for chunk in parts for p in chunk.split(sep)]
    return [p.strip(" •").strip() for p in parts if p.strip(" •").strip()]


def yesno(s):
    return clean(s).lower().startswith("y")


def parse_domains(s):
    """Extract AS-## codes; map 'All active domains' etc. to the 'ALL' sentinel."""
    out = []
    for t in split_list(s):
        m = re.match(r"(AS-\d+)", t)
        if m:
            out.append(m.group(1))
    if not out and s and "all" in s.lower():
        out = ["ALL"]
    return out


# ---- result-schema key mapping (bundle category/careEvent -> 1 of 16 schemas) ----
# Ambiguous mappings are flagged resultSchemaKeyReview:true for SOP review (spec risk note).
SCHEMA_KEYS = {
    "ADL / Personal Care", "Toileting / Continence", "Meal / Supplement", "Hydration",
    "Mobility / Walking", "Transfer", "Repositioning", "Vital Signs", "Blood Glucose",
    "Medication Support", "Behavior Support", "Pain Support", "Activity / Engagement",
    "Sleep / Safety Round", "Skin Check", "General Observation",
}


def schema_key_for(category, care_event):
    c = category.lower()
    e = care_event.lower()
    review = False
    if "transfer" in e:
        key = "Transfer"
    elif "mobility" in c or "walk" in e or "ambulat" in e:
        key = "Mobility / Walking"
    elif "reposition" in c or "position" in e:
        key = "Repositioning"
    elif "toilet" in c or "contin" in c:
        key = "Toileting / Continence"
    elif "nutrition" in c or "meal" in e or "feed" in e:
        key = "Meal / Supplement"
    elif "hydrat" in c:
        key = "Hydration"
    elif "medication" in c:
        key = "Medication Support"
    elif "glucose" in e:
        key = "Blood Glucose"
    elif "clinical" in c or "vital" in e or "monitor" in e:
        key = "Vital Signs"; review = ("glucose" in e)
    elif "skin" in c:
        key = "Skin Check"
    elif "pain" in c or "comfort" in c:
        key = "Pain Support"
    elif "behavior" in c or "cognition" in c:
        key = "Behavior Support"; review = True  # cognition/behavior split ambiguous
    elif "activity" in c:
        key = "Activity / Engagement"
    elif "sleep" in c or "round" in e or "supervis" in e or "overnight" in e:
        key = "Sleep / Safety Round"
    elif "personal care" in c or "hygiene" in e or "dress" in e:
        key = "ADL / Personal Care"
    elif "safety" in c:
        key = "Sleep / Safety Round" if ("round" in e or "supervis" in e) else "General Observation"; review = True
    elif "handover" in c or "observation" in c:
        key = "General Observation"
    else:
        key = "General Observation"; review = True
    assert key in SCHEMA_KEYS, key
    return key, review


def build_loc_bundles():
    out = []
    for headers, row in rows_after_header("LOC Standard Routine Bundles", "Bundle Event ID"):
        d = as_dict(headers, row)
        bid = clean(d.get("Bundle Event ID"))
        if not bid or not re.match(r"^LOC\d", bid):
            continue
        category = clean(d.get("Routine Category"))
        care_event = clean(d.get("Standard Care Event"))
        key, review = schema_key_for(category, care_event)
        out.append({
            "bundleEventId": bid,
            "finalLoc": clean(d.get("Final LOC")),
            "category": category,
            "careEvent": care_event,
            "purpose": clean(d.get("Baseline Purpose")),
            "defaultAssistancePattern": clean(d.get("Default Assistance Pattern")),
            "frequencyMethod": clean(d.get("Default Frequency Method")),
            "defaultTimeShift": clean(d.get("Default Time / Shift")),
            "requiredResult": clean(d.get("Required Result")),
            "completionControl": clean(d.get("Completion Control")),
            "orderRequired": yesno(d.get("Clinical Order Required?")),
            "activationRule": clean(d.get("Activation / Suppression Rule")),
            "asDomains": parse_domains(clean(d.get("AS Domains Refined By"))),
            "criticality": clean(d.get("Default Criticality")),
            "implementationNote": clean(d.get("Implementation Note")),
            "resultSchemaKey": key,
            **({"resultSchemaKeyReview": True} if review else {}),
            "sourceWorkbookVersion": SRC_VERSION,
        })
    return out


def build_condition_pathways():
    out = []
    for headers, row in rows_after_header("Conditional Bundle Activation", "Bundle ID"):
        d = as_dict(headers, row)
        bid = clean(d.get("Bundle ID"))
        if not bid or bid == "Bundle ID":
            continue
        pathway = clean(d.get("Pathway / Condition"))
        out.append({
            "bundleId": bid,
            "pathway": pathway,
            "intensity": clean(d.get("Pathway Intensity")),
            "crossLoc": yesno(d.get("Applies Across LOC?")),
            "memoryPathway": bid.startswith("MC") or pathway.lower().startswith("memory"),
            "linkedDomains": parse_domains(clean(d.get("Linked AS Domain(s)"))),
            "activationCriteria": clean(d.get("Activation Criteria")),
            "doesNotActivateFrom": clean(d.get("Does NOT Activate From")),
            "actionType": clean(d.get("Action Type")),
            "careEvent": clean(d.get("Care Event")),
            "caregiverInstruction": clean(d.get("Caregiver Instruction")),
            "frequencyMethod": clean(d.get("Frequency Method")),
            "shiftTrigger": clean(d.get("Shift / Trigger")),
            "requiredResult": clean(d.get("Required Result")),
            "orderRequired": yesno(d.get("Order Required?")),
            "escalationTrigger": clean(d.get("Escalation Trigger")),
            "priority": clean(d.get("Priority")),
            "reviewStopRule": clean(d.get("Review / Stop Rule")),
            "nursingApprovalRequired": yesno(d.get("Nursing Approval Required")),
            "sourceWorkbookVersion": SRC_VERSION,
        })
    return out


def build_result_schemas():
    out = []
    for headers, row in rows_after_header("Care Event Result Fields", "Care Event Type"):
        d = as_dict(headers, row)
        et = clean(d.get("Care Event Type"))
        if not et or et == "Care Event Type":
            continue
        out.append({
            "eventType": et,
            "quickChartCategory": clean(d.get("Quick Chart Category")),
            "requiredFields": split_list(clean(d.get("Required Structured Fields"))),
            "optionalFields": split_list(clean(d.get("Optional Fields"))),
            "completionButton": clean(d.get("Completion Button")),
            "allowedExceptions": split_list(clean(d.get("Allowed Exceptions"))),
            "autoEscalationExamples": clean(d.get("Auto-Escalation Examples")),
            "units": clean(d.get("Units / Value Format")),
            "countsCompleteWhen": clean(d.get("Counts as Complete When")),
            "developerValidation": clean(d.get("Developer Validation")),
            "sourceWorkbookVersion": SRC_VERSION,
        })
    return out


def build_care_delivery_map():
    out = []
    for headers, row in rows_after_header("AS Care Delivery Map", "Domain Code"):
        d = as_dict(headers, row)
        code = clean(d.get("Domain Code"))
        lvl = clean(d.get("AS Level"))
        if not re.match(r"^AS-\d", code) or lvl not in {"0", "1", "2", "3", "4"}:
            continue
        out.append({
            "domainCode": code,
            "domain": clean(d.get("Approved v4.2 Domain")),
            "asLevel": int(lvl),
            "defaultGoal": clean(d.get("Default Goal / Preference")),
            "caregiverTasks": split_list(clean(d.get("Caregiver Tasks / Interventions")), seps=("\n",)),
            "nurseOversight": clean(d.get("Nurse Tasks / Oversight")),
            "suggestedFrequency": clean(d.get("Suggested Frequency / Trigger")),
            "careEventType": clean(d.get("Care Event Type")),
            "escalationTrigger": clean(d.get("Escalation / Reassessment Trigger")),
            "activationRule": clean(d.get("Activation Rule")),
            "sourceWorkbookVersion": SRC_VERSION,
        })
    return out


def write(name, data):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"  {name}: {len(data)} rows")


if __name__ == "__main__":
    print("Extracting SLMS v4.2 rule tables ->", OUT)
    write("loc_bundles.json", build_loc_bundles())
    write("condition_pathways.json", build_condition_pathways())
    write("result_schemas.json", build_result_schemas())
    write("as_care_delivery_map.json", build_care_delivery_map())
    print("Done.")
