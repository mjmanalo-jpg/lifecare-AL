import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listWorkspaces } from "@/lib/tenant";

export async function GET() {
  const session = await getSession();
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaces = await listWorkspaces(session.userId);
  return workspaces ? NextResponse.json(workspaces) : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}