#!/usr/bin/env node
// Delete ALL residents in the UAT community (clean slate) + clear the seeded LOC
// history. Signs in as the UAT Care Manager (the role permitted to edit/delete
// residents) via the Employee login. That session is scoped to the UAT community
// ONLY — it cannot see or touch Rizal/Bambu residents.
//
//   node scripts/clean-uat-residents.mjs --base https://your-app-url --confirm
//
// Env: BASE_URL, ORG_NAME (company), CM_MOBILE, SHARED_PASSWORD.  Node 18+.

const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (f) => process.argv.includes(f);

const BASE_URL   = (arg("--base") || process.env.BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const COMPANY    = process.env.ORG_NAME || "LifeCare UAT";
const CM_MOBILE  = process.env.CM_MOBILE || "+639000000002";
const PASSWORD   = process.env.SHARED_PASSWORD || "LifecareUAT@2026";

let cookie = "";
async function api(path, body, method = "POST") {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  let data; try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}
function sessionIds() {
  const m = /(?:^|;\s*)lcms_session=([^;]+)/.exec(cookie);
  if (!m) return {};
  try { const j = JSON.parse(Buffer.from(m[1].split(".")[0], "base64url").toString("utf8")); return { organizationId: j.activeOrganizationId, communityId: j.activeCommunityId }; }
  catch { return {}; }
}

async function main() {
  console.log(`\n  Target : ${BASE_URL}`);
  console.log(`  Company: ${COMPANY}  (Care Manager ${CM_MOBILE})\n`);
  if (!has("--confirm")) { console.error("Refusing to run without --confirm."); process.exit(1); }

  const cm = await api("/api/auth/mobile-login", { company: COMPANY, mobile: CM_MOBILE, password: PASSWORD });
  if (!cm.ok) { console.error(`✗ Care Manager sign-in failed (${cm.status}): ${cm.data?.error || "unknown"}`); process.exit(1); }
  const { organizationId, communityId } = sessionIds();
  console.log(`✓ Signed in — UAT community ${communityId}`);

  const list = await api("/api/db/residents", null, "GET");
  const residents = Array.isArray(list.data?.data) ? list.data.data : [];
  console.log(`Found ${residents.length} resident(s) in the UAT community.`);

  let deleted = 0;
  for (const r of residents) {
    const d = await api(`/api/db/residents/${r.id}`, null, "DELETE");
    if (d.ok) { deleted++; console.log(`✓ deleted ${r.firstName} ${r.lastName} (${r.roomNumber})`); }
    else console.error(`✗ ${r.firstName} ${r.lastName} — ${d.status}: ${d.data?.error || "unknown"}`);
  }

  // Clear the seeded LOC history so nothing is orphaned (composite id, UAT-scoped).
  const w = await api("/api/db/app-settings", { id: `${organizationId}:${communityId}:loc_history`, key: "loc_history", value: "[]" });
  console.log(`LOC history cleared: ${w.ok ? "yes" : "no (" + w.status + ")"}`);

  const after = await api("/api/db/residents", null, "GET");
  const remaining = Array.isArray(after.data?.data) ? after.data.data.length : "?";
  console.log(`\nDone. Deleted ${deleted}/${residents.length}. Residents now in UAT community: ${remaining}.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
