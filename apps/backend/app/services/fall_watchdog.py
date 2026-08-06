"""
Always-on, server-side fall watchdog.

The in-app camera detector (MediaPipe in the browser) only runs while a nurse has
the monitoring tab open. This watchdog runs inside the backend process instead, so
a camera wired to a resident (e.g. the Tapo in Arthur Pendelton's Room 302) is
monitored 24/7 — no login, no open tab required. On a detected fall it POSTs to the
Next.js sensor-ingestion endpoint (`/api/sensors/event`), which records an Incident
and alerts the care team exactly like the in-app detector does.

Detection is classical OpenCV (background subtraction → largest moving blob →
bounding-box aspect ratio + collapse timing). It has NO heavy ML dependency
(cv2 + numpy only), which is why it can run on this Python/OpenCV-only backend.
It reliably catches the canonical "upright → sudden prone → stays down" collapse;
it is intentionally conservative (a cooldown + a stay-down confirmation) to avoid
false alarms. A pose-model upgrade (e.g. MoveNet ONNX) can slot in later behind the
same POST-on-fall contract.
"""
import os
import time
import threading

import cv2
import numpy as np
import requests

from app.api.v1 import camera

# ── Config (env-tunable) ─────────────────────────────────────────────────────
MONITOR_ENABLED = os.getenv("MONITOR_ENABLED", "true").lower() == "true"
# The room this camera is wired to. The sensor endpoint resolves the resident from
# this room within the key's community (Room 302 → Arthur Pendelton).
MONITOR_ROOM = os.getenv("MONITOR_ROOM", "302")
MONITOR_FPS = float(os.getenv("MONITOR_FPS", "8"))
# Facility sensor-ingest key. Matched by the Next endpoint to its community.
SENSOR_KEY = os.getenv("SENSOR_INGEST_API_KEY", "")
FRONTEND_URL = (os.getenv("FRONTEND_URL") or os.getenv("NEXT_PUBLIC_APP_URL") or "http://localhost:3000").rstrip("/")
# Don't raise more than one incident per this window (seconds).
COOLDOWN_S = float(os.getenv("MONITOR_FALL_COOLDOWN", "90"))

# ── Detection thresholds ─────────────────────────────────────────────────────
MIN_AREA_FRAC = float(os.getenv("MONITOR_MIN_AREA_FRAC", "0.02"))  # ignore blobs < 2% of frame
UPRIGHT_RATIO = 1.15   # bbox height/width >= this ⇒ standing/upright
LYING_RATIO = 0.80     # bbox height/width <= this ⇒ lying / on the floor
FALL_WINDOW_S = 2.0    # upright → lying transition within this window ⇒ a fall (not just sitting)
STAY_DOWN_S = 1.2      # must remain down this long after the drop ⇒ confirmed (not just bending)
NO_PERSON_RESET_S = 4.0  # clear pending state if the scene is empty this long

_wd_thread = None
_wd_run = False


def _post_fall(confidence: float, note: str):
    """Fire-and-forget POST to the sensor-ingestion endpoint (runs off the detect loop)."""
    payload = {
        "event": "FALL",
        "roomNumber": MONITOR_ROOM,
        "confidence": round(float(confidence), 2),
        "source": "Tapo backend watchdog",
        "note": note,
    }
    url = f"{FRONTEND_URL}/api/sensors/event"

    def _send():
        try:
            r = requests.post(url, json=payload, headers={"x-api-key": SENSOR_KEY}, timeout=10)
            body = r.text[:200].replace("\n", " ")
            print(f"[Watchdog] *** FALL posted -> {url} -> {r.status_code} {body}")
        except Exception as e:  # network / endpoint down — log, never crash the loop
            print(f"[Watchdog] fall POST failed: {e}")

    threading.Thread(target=_send, daemon=True).start()


def _watch_loop():
    camera.ensure_grabber()
    bg = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=32, detectShadows=True)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    period = 1.0 / max(1.0, MONITOR_FPS)

    last_upright_t = 0.0    # last time a clearly-upright person was seen
    candidate_t = 0.0       # when the current down-state started (0 = none pending)
    last_person_t = 0.0
    last_fire_t = 0.0

    # Heartbeat — proves the monitor is alive and actually reading frames.
    hb_t = time.time()
    hb_frames = 0
    hb_person = 0

    print(f"[Watchdog] loop live - analysing frames at ~{MONITOR_FPS:.0f}fps for room {MONITOR_ROOM}")

    while _wd_run:
        t0 = time.time()
        frame = camera.get_latest_frame()
        if frame is None:
            time.sleep(0.2)
            continue
        hb_frames += 1

        h, w = frame.shape[:2]
        fg = bg.apply(frame)
        # MOG2 marks shadows as grey (127); keep only hard foreground.
        _, fg = cv2.threshold(fg, 200, 255, cv2.THRESH_BINARY)
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, kernel, iterations=1)
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, kernel, iterations=2)
        cnts, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        now = time.time()
        ratio = None
        if cnts:
            c = max(cnts, key=cv2.contourArea)
            if cv2.contourArea(c) >= MIN_AREA_FRAC * w * h:
                _, _, bw, bh = cv2.boundingRect(c)
                ratio = bh / max(1, bw)
                last_person_t = now

        if ratio is not None:
            hb_person += 1
            if ratio >= UPRIGHT_RATIO:
                last_upright_t = now
                candidate_t = 0.0  # standing again ⇒ cancel any pending fall
            elif ratio <= LYING_RATIO:
                # Down now. Was the person upright a moment ago? Then this is a collapse.
                if last_upright_t and (now - last_upright_t) <= FALL_WINDOW_S:
                    if candidate_t == 0.0:
                        candidate_t = now
                    elif (now - candidate_t) >= STAY_DOWN_S:
                        if (now - last_fire_t) >= COOLDOWN_S:
                            drop = max(0.0, now - last_upright_t)
                            conf = max(0.6, min(0.95, 0.95 - drop * 0.08))
                            _post_fall(
                                conf,
                                "24/7 server-side monitoring detected a collapse "
                                "(upright→prone, remained down).",
                            )
                            last_fire_t = now
                            print(f"[Watchdog] confirmed FALL (conf={conf:.2f}) in room {MONITOR_ROOM}")
                        candidate_t = 0.0
                        last_upright_t = 0.0
                else:
                    # Lying, but not preceded by standing (e.g. resting) ⇒ not a fall.
                    candidate_t = 0.0
        elif last_person_t and (now - last_person_t) >= NO_PERSON_RESET_S:
            # Scene empty for a while — clear pending state so we don't fire on return.
            candidate_t = 0.0
            last_upright_t = 0.0

        if now - hb_t >= 30.0:
            print(f"[Watchdog] heartbeat: {hb_frames} frames analysed in last 30s, "
                  f"person present in {hb_person} of them (room {MONITOR_ROOM})")
            hb_t = now
            hb_frames = 0
            hb_person = 0

        dt = time.time() - t0
        if dt < period:
            time.sleep(period - dt)

    print("[Watchdog] loop stopped")


def start_watchdog():
    """Start the 24/7 fall watchdog thread. No-op if disabled or already running."""
    global _wd_thread, _wd_run
    if not MONITOR_ENABLED:
        print("[Watchdog] disabled (MONITOR_ENABLED=false)")
        return
    if not SENSOR_KEY:
        print("[Watchdog] NOT started: SENSOR_INGEST_API_KEY is not set — cannot record alerts.")
        return
    if _wd_thread is not None and _wd_thread.is_alive():
        return
    _wd_run = True
    _wd_thread = threading.Thread(target=_watch_loop, daemon=True)
    _wd_thread.start()
    print(f"[Watchdog] server-side fall monitoring ON -> room {MONITOR_ROOM}, posting to {FRONTEND_URL}")


def stop_watchdog():
    global _wd_run
    _wd_run = False
