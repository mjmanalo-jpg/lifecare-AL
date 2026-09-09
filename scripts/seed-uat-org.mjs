#!/usr/bin/env node
// Seed a UAT organization in the running LifeCare app via its own HTTP endpoints
// (no direct DB writes — records go through the app's provisioning code, so
// Supabase Auth users, memberships and tenant scoping are wired correctly).
//
// Creates, all scoped to a NEW isolated org (never touches Rizal/Bambu):
//   • 1 org + community + owner (Facility Admin / org admin)  — register/organization
//   • 6 staff logins, each with the SAME known password       — organization-admin/staff-accounts
//       Nurse · Care Manager · Caregiver · Resident Coordinator · System Admin (SUPERADMIN) · CRM Specialist
//   • 10 synthetic residents (family kept as emergency-contact DATA, no family login)
//   • Level-of-Care history incl. CLINICAL_OVERRIDE entries (the override LOC)
//
// Two login systems (by design):
//   • Org admin  → Organization sign-in (/login): EMAIL + password
//   • Staff      → Employee login: COMPANY + MOBILE + password (email won't work)
// Residents are admitted using the Care Manager staff session (the owner role is
// not permitted to admit residents).
//
// "System Admin" = SUPERADMIN (org-scoped), NOT PLATFORM_ADMIN (which would see
// Rizal/Bambu real PHI). Re-runnable: tolerates an already-created org/staff.
//
//   node scripts/seed-uat-org.mjs --base https://your-app-url --confirm
//
// Env: BASE_URL, ORG_NAME, COMMUNITY_NAME, OWNER_EMAIL, SHARED_PASSWORD,
// EMAIL_DOMAIN, RESIDENT_COUNT.  Node 18+ (global fetch + getSetCookie).

const arg = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (flag) => process.argv.includes(flag);

const BASE_URL        = (arg("--base") || process.env.BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const ORG_NAME        = process.env.ORG_NAME || "LifeCare UAT";
const COMMUNITY_NAME  = process.env.COMMUNITY_NAME || "LifeCare UAT";
const EMAIL_DOMAIN    = process.env.EMAIL_DOMAIN || "lifecare-uat.com";
const OWNER_EMAIL     = process.env.OWNER_EMAIL || `admin@${EMAIL_DOMAIN}`;
const SHARED_PASSWORD = process.env.SHARED_PASSWORD || "LifecareUAT@2026";
const RESIDENT_COUNT  = Number(process.env.RESIDENT_COUNT || 10);

const STAFF = [
  { role: "NURSE",                name: "UAT Nurse",                slug: "nurse",       position: "Nurse" },
  { role: "CARE_MANAGER",         name: "UAT Care Manager",         slug: "caremanager", position: "Care Manager" },
  { role: "CAREGIVER",            name: "UAT Caregiver",            slug: "caregiver",   position: "Caregiver" },
  { role: "RESIDENT_COORDINATOR", name: "UAT Resident Coordinator", slug: "coordinator", position: "Resident Coordinator" },
  { role: "SUPERADMIN",           name: "UAT System Admin",         slug: "systemadmin", position: "System Administrator" },
  { role: "CRM",                  name: "UAT CRM Specialist",       slug: "crm",         position: "CRM Specialist" },
];
const CM_INDEX = STAFF.findIndex((s) => s.role === "CARE_MANAGER"); // admits residents

const staffMobile  = (i) => `+63900000${String(i + 1).padStart(4, "0")}`;
const familyMobile = (i) => `+63911000${String(i + 1).padStart(4, "0")}`;
const CARE_LEVELS = ["INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"]; // coarse enum placeholder; real LOC = loc_history

let cookie = "";
async function api(path, body, method = "POST") {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length) cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  let data; try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}
const orgLogin = (email, password) => api("/api/auth/session", { email, password });
const empLogin = (company, mobile, password) => api("/api/auth/mobile-login", { company, mobile, password });

// Read tenant ids from the signed session cookie (payload is base64url JSON).
function sessionIds() {
  const m = /(?:^|;\s*)lcms_session=([^;]+)/.exec(cookie);
  if (!m) return {};
  try {
    const json = JSON.parse(Buffer.from(m[1].split(".")[0], "base64url").toString("utf8"));
    return { organizationId: json.activeOrganizationId, communityId: json.activeCommunityId };
  } catch { return {}; }
}

async function main() {
  console.log(`\n  Target : ${BASE_URL}`);
  console.log(`  Org    : ${ORG_NAME}  /  Community: ${COMMUNITY_NAME}`);
  console.log(`  Owner  : ${OWNER_EMAIL}    Shared password: ${SHARED_PASSWORD}\n`);
  if (!has("--confirm")) { console.error("Refusing to run without --confirm."); process.exit(1); }

  // 1) Org + community + owner (fresh), or log in as owner if it already exists.
  const reg = await api("/api/register/organization", {
    companyName: ORG_NAME, ownerName: "UAT Facility Admin",
    email: OWNER_EMAIL, password: SHARED_PASSWORD, communityName: COMMUNITY_NAME,
  });
  if (reg.ok) {
    console.log("✓ Org + community + owner created");
  } else if (reg.status === 409) {
    console.log("• Org/owner already exists — signing in as owner to continue");
    const lo = await orgLogin(OWNER_EMAIL, SHARED_PASSWORD);
    if (!lo.ok) { console.error(`✗ Owner sign-in failed (${lo.status}): ${lo.data?.error || "unknown"}`); process.exit(1); }
  } else {
    console.error(`✗ Org creation failed (${reg.status}): ${reg.data?.error || "unknown"}`);
    if (reg.status === 403) console.error("  Public org signup disabled (ENABLE_PUBLIC_ORG_SIGNUP=false) — create it via the platform console.");
    process.exit(1);
  }

  // 2) One login per role, same password (owner/admin session required here).
  const creds = [{ who: "Org Admin (Facility Admin)", login: "Org sign-in /login", id: OWNER_EMAIL, password: SHARED_PASSWORD }];
  for (let i = 0; i < STAFF.length; i++) {
    const s = STAFF[i], email = `${s.slug}@${EMAIL_DOMAIN}`, mobile = staffMobile(i);
    const r = await api("/api/organization-admin/staff-accounts", {
      name: s.name, email, password: SHARED_PASSWORD, position: s.position, role: s.role, communityId: sessionIds().communityId, phone: mobile,
    });
    if (r.ok || r.status === 409) { creds.push({ who: s.position, login: "Employee login", id: `${ORG_NAME} + ${mobile}`, password: SHARED_PASSWORD }); console.log(`${r.ok ? "✓" : "•"} ${s.position.padEnd(22)} ${email}  ${mobile}${r.ok ? "" : " (exists)"}`); }
    else console.error(`✗ ${s.role} failed (${r.status}): ${r.data?.error || "unknown"}`);
  }

  // --staff-only: adding/refreshing logins without re-seeding residents (residents POST is not idempotent).
  if (has("--staff-only")) { console.log("• --staff-only: skipping resident + LOC seeding\n"); printCreds(creds); return; }

  // 3) Switch to the Care Manager (Employee login) — the role permitted to admit residents.
  const cm = await empLogin(ORG_NAME, staffMobile(CM_INDEX), SHARED_PASSWORD);
  if (!cm.ok) { console.error(`✗ Care Manager sign-in failed (${cm.status}): ${cm.data?.error || "unknown"}. Residents not seeded.`); printCreds(creds); return; }
  const { organizationId, communityId } = sessionIds();

  // 4) Synthetic residents (family = emergency-contact DATA only, no login).
  let posted = 0;
  for (let i = 0; i < RESIDENT_COUNT; i++) {
    const letter = String.fromCharCode(65 + i);
    const r = await api("/api/db/residents", {
      firstName: "UAT", lastName: `Resident ${letter}`,
      roomNumber: `UAT-${101 + i}`, careLevel: CARE_LEVELS[i % CARE_LEVELS.length], admissionDate: new Date().toISOString(),
      emergencyContact: `UAT Family ${letter} (sponsor)`, emergencyContactPhone: familyMobile(i),
    });
    if (r.ok) posted++; else console.error(`✗ Resident ${i + 1} failed (${r.status}): ${r.data?.error || "unknown"}`);
  }

  // 5) Read residents back (scoped to UAT community) and seed LOC history incl. overrides.
  const list = await api("/api/db/residents", null, "GET").catch(() => ({ data: null }));
  const residents = Array.isArray(list.data?.data) ? [...list.data.data].sort((a, b) => String(a.roomNumber).localeCompare(String(b.roomNumber))) : [];
  const nowISO = new Date().toISOString();
  const loc = residents.map((res, i) => {
    const override = i >= 5;
    return { id: `loc-uat-${i + 1}`, residentId: res.id, residentName: `${res.firstName} ${res.lastName}`.trim(),
      level: `L${(i % 5) + 1}`, source: override ? "CLINICAL_OVERRIDE" : "ACUITY_APPROVAL", by: "UAT Seed", role: "CARE_MANAGER",
      notes: override ? "UAT seeded clinical override" : "UAT seeded initial LOC", at: nowISO };
  });
  let locOk = false;
  if (loc.length) {
    const w = await api("/api/db/app-settings", { id: `${organizationId}:${communityId}:loc_history`, key: "loc_history", value: JSON.stringify(loc) });
    locOk = w.ok; if (!w.ok) console.error(`✗ LOC history seed failed (${w.status}): ${w.data?.error || "unknown"}`);
  }
  console.log(`✓ Residents: ${posted}/${RESIDENT_COUNT} POSTed, ${residents.length} in directory; LOC history ${locOk ? `seeded (${loc.filter((e) => e.source === "CLINICAL_OVERRIDE").length} overrides)` : "NOT seeded"}\n`);
  printCreds(creds);
}

function printCreds(creds) {
  console.log("LOGIN CREDENTIALS (one shared password):");
  console.log("".padEnd(96, "─"));
  console.log(`  ${"Who".padEnd(26)} ${"How to sign in".padEnd(20)} ${"Identifier".padEnd(34)} Password`);
  for (const c of creds) console.log(`  ${c.who.padEnd(26)} ${c.login.padEnd(20)} ${String(c.id).padEnd(34)} ${c.password}`);
  console.log("".padEnd(96, "─"));
  console.log(`  Org admin: /login with email + password.  Staff: Employee login with Company "${ORG_NAME}" + mobile + password.`);
  console.log("  Then run the UAT flow — see docs/UAT/UAT-TEST-PLAN.md.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
