import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PHI-free deploy identifier. A stale PWA client (iOS especially pins an
// installed app to its last-loaded bundle) polls this; when the id changes under
// a running client, it reloads to pick up the new build. Deliberately public —
// no tenant context — so it works pre-login and carries no clinical data. Vercel
// sets VERCEL_GIT_COMMIT_SHA per deploy; "dev" locally means "never auto-reload".
export function GET() {
  const v = process.env.VERCEL_GIT_COMMIT_SHA || "dev";
  return NextResponse.json({ v }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
