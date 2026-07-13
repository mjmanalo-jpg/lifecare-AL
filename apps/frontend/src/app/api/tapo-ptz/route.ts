import { NextRequest, NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tapo-ptz
 * Body: { pan: number (-100 to 100), tilt: number (-100 to 100) }
 *
 * Sends PTZ (Pan-Tilt-Zoom) commands to Tapo IP camera.
 * In demo mode: returns success without action.
 * In production: sends commands to the actual Tapo camera API.
 */

export async function POST(request: NextRequest) {
  const role = await validateSession();
  if (!role) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { pan, tilt } = body;

    // Validate inputs
    if (pan === undefined || tilt === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: pan, tilt" },
        { status: 400 }
      );
    }

    const clampedPan = Math.max(-100, Math.min(100, Number(pan)));
    const clampedTilt = Math.max(-100, Math.min(100, Number(tilt)));

    const backendUrl = process.env.BACKEND_API_URL || "http://localhost:8000";

    try {
      const response = await fetch(`${backendUrl}/api/v1/camera/move_position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pan: clampedPan,
          tilt: clampedTilt,
        }),
      });

      if (!response.ok) {
        console.warn(`[Tapo] Proxy PTZ command failed: ${response.statusText}`);
      } else {
        const result = await response.json();
        if (result.status === "error") {
          console.warn(`[Tapo] Proxy PTZ error response: ${result.error}`);
        }
      }
    } catch (tapoError) {
      console.warn("[Tapo] Proxy PTZ network error:", tapoError);
    }

    return NextResponse.json(
      { success: true, pan: clampedPan, tilt: clampedTilt },
      { status: 200 }
    );
  } catch (error) {
    console.error("PTZ command failed:", error);
    const message = error instanceof Error ? error.message : "Failed to send PTZ command";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
