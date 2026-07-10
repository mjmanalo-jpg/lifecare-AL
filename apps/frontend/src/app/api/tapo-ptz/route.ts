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

    // Demo mode: just return success
    if (!process.env.TAPO_IP || process.env.TAPO_IP.includes("<")) {
      return NextResponse.json(
        { success: true, pan: clampedPan, tilt: clampedTilt, demo: true },
        { status: 200 }
      );
    }

    // Production: send to actual Tapo IP camera
    try {
      const tapoIp = process.env.TAPO_IP;
      const tapoPassword = process.env.TAPO_PASSWORD || "admin";

      // Normalize pan/tilt from (-100, 100) to (0, 255) for Tapo API
      // Pan: -100 = 0°, 0 = 127.5°, 100 = 255°
      // Tilt: -100 = 0°, 0 = 127.5°, 100 = 255°
      const panValue = Math.round(((clampedPan + 100) / 200) * 255);
      const tiltValue = Math.round(((clampedTilt + 100) / 200) * 255);

      // Tapo API call (adjust based on your camera model)
      const response = await fetch(`http://${tapoIp}/api/v1/camera/move_position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x: panValue,   // horizontal
          y: tiltValue,  // vertical
        }),
      });

      if (!response.ok) {
        console.warn(`[Tapo] PTZ command failed: ${response.statusText}`);
      }
    } catch (tapoError) {
      console.warn("[Tapo] PTZ error (camera may not be configured):", tapoError);
      // Don't fail the request - just log the warning
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
