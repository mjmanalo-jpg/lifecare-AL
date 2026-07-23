import { backendAuthHeaders } from "@/lib/backendAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:8000";

/**
 * GET /api/camera/feed
 * Proxies the local webcam MJPEG stream from the FastAPI backend.
 * Used as a fallback when the browser's getUserMedia is unavailable.
 */
export async function GET() {
  const authHeaders = await backendAuthHeaders();
  if (!authHeaders) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/camera/feed`, {
      headers: { ...authHeaders, Accept: "multipart/x-mixed-replace" },
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `Backend returned ${res.status}` }),
        { status: res.status, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!res.body) {
      return new Response(JSON.stringify({ error: "No stream body" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[Camera Proxy] Feed error:", err);
    return new Response(
      JSON.stringify({ error: "Backend unreachable" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
