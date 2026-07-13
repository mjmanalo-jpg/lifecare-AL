import { validateSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:8000";

/**
 * GET /api/camera/tapo-feed
 * Proxies the Tapo MJPEG stream from the FastAPI backend.
 * This avoids mixed-content blocks when the Vercel frontend (HTTPS)
 * needs to consume the local backend's HTTP stream.
 */
export async function GET() {
  const role = await validateSession();
  if (!role) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/camera/tapo_feed`, {
      headers: { Accept: "multipart/x-mixed-replace" },
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `Backend returned ${res.status}` }),
        { status: res.status, headers: { "Content-Type": "application/json" } }
      );
    }

    // Stream the backend's MJPEG body directly to the client.
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
    console.error("[Camera Proxy] Tapo feed error:", err);
    return new Response(
      JSON.stringify({ error: "Backend unreachable" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
