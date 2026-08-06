"""
Always-on, server-side fall watchdog — now multi-camera.

The in-app camera detector (MediaPipe in the browser) only runs while a nurse has
the monitoring tab open. This watchdog runs inside the backend process instead, so
every camera wired to a resident is monitored 24/7 — no login, no open tab.

It discovers cameras from the Camera Registry via GET /api/sensors/cameras
(authenticated with the same sensor-ingest key), and runs ONE detector worker per
enabled camera. On a detected fall a worker POSTs to /api/sensors/event with that
camera's room, which records an Incident and alerts the care team.

Frame source per camera:
  * type "tapo"                  -> the backend's shared RTSP grabber (one config'd
                                    Tapo; avoids a second connection to the device)
  * rtspUrl / streamUrl = rtsp://  -> its own OpenCV capture
  * anything else (browser-only)   -> skipped (logged once; can't grab server-side)

Detection is classical OpenCV (background subtraction -> largest moving blob ->
bbox aspect-ratio collapse + stay-down confirm). No heavy ML dependency
(cv2 + numpy only) — which is why it runs on this Python/OpenCV-only backend. A
pose-model upgrade (e.g. MoveNet ONNX) can slot in later behind the same contract.
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
MONITOR_FPS = float(os.getenv("MONITOR_FPS", "8"))
SENSOR_KEY = os.getenv("SENSOR_INGEST_API_KEY", "")
FRONTEND_URL = (os.getenv("FRONTEND_URL") or os.getenv("NEXT_PUBLIC_APP_URL") or "http://localhost:3000").rstrip("/")
COOLDOWN_S = float(os.getenv("MONITOR_FALL_COOLDOWN", "90"))   # min seconds between incidents per camera
REFRESH_S = float(os.getenv("MONITOR_REFRESH", "60"))          # how often to re-read the registry
# Fallback room if the registry can't be reached at cold start (legacy single-Tapo).
MONITOR_ROOM = os.getenv("MONITOR_ROOM", "")

# ── Detection thresholds ─────────────────────────────────────────────────────
MIN_AREA_FRAC = float(os.getenv("MONITOR_MIN_AREA_FRAC", "0.02"))  # ignore blobs < 2% of frame
UPRIGHT_RATIO = 1.15   # bbox height/width >= this ⇒ standing/upright
LYING_RATIO = 0.80     # bbox height/width <= this ⇒ lying / on the floor
FALL_WINDOW_S = 2.0    # upright -> lying within this window ⇒ a fall (not just sitting)
STAY_DOWN_S = 1.2      # must remain down this long after the drop ⇒ confirmed
NO_PERSON_RESET_S = 4.0  # clear pending state if the scene is empty this long
MJPEG_WIDTH = int(os.getenv("MJPEG_WIDTH", "640"))

_mgr_thread = None
_wd_run = False


def _post_fall(room: str, cam_name: str, confidence: float, note: str):
    """Fire-and-forget POST to the sensor-ingestion endpoint (off the detect loop)."""
    payload = {
        "event": "FALL",
        "roomNumber": room,
        "confidence": round(float(confidence), 2),
        "source": f"{cam_name} (backend watchdog)",
        "note": note,
    }
    url = f"{FRONTEND_URL}/api/sensors/event"

    def _send():
        try:
            r = requests.post(url, json=payload, headers={"x-api-key": SENSOR_KEY}, timeout=10)
            body = r.text[:200].replace("\n", " ")
            print(f"[Watchdog] *** FALL posted ({cam_name}) -> {r.status_code} {body}")
        except Exception as e:
            print(f"[Watchdog] fall POST failed ({cam_name}): {e}")

    threading.Thread(target=_send, daemon=True).start()


class CameraWorker:
    """Runs the fall detector for one camera on its own thread."""

    def __init__(self, cam: dict, use_shared: bool, capture_url: str | None):
        self.cam = cam
        self.use_shared = use_shared      # read frames from the shared Tapo grabber
        self.capture_url = capture_url    # else open this RTSP ourselves
        self._run = False
        self._thread = None

    @property
    def name(self) -> str:
        return self.cam.get("name") or self.cam.get("id") or "camera"

    @property
    def room(self) -> str:
        return str(self.cam.get("roomNumber") or "")

    def update(self, cam: dict):
        self.cam = cam  # room/name can change without restarting the thread

    def start(self):
        self._run = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        src = "shared Tapo grabber" if self.use_shared else self.capture_url
        print(f"[Watchdog] monitoring '{self.name}' (room {self.room or '?'}) via {src}")

    def stop(self):
        self._run = False
        print(f"[Watchdog] stopped monitoring '{self.name}'")

    def _read_frame(self, cap):
        if self.use_shared:
            return camera.get_latest_frame(), cap
        if cap is None or not cap.isOpened():
            if cap is not None:
                cap.release()
            cap = camera.open_rtsp(self.capture_url)
            return None, cap
        ok, frame = cap.read()
        if not ok or frame is None:
            return None, cap
        if MJPEG_WIDTH and frame.shape[1] > MJPEG_WIDTH:
            h = int(frame.shape[0] * MJPEG_WIDTH / frame.shape[1])
            frame = cv2.resize(frame, (MJPEG_WIDTH, h), interpolation=cv2.INTER_AREA)
        return frame, cap

    def _loop(self):
        if self.use_shared:
            camera.ensure_grabber()
        cap = None
        bg = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=32, detectShadows=True)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        period = 1.0 / max(1.0, MONITOR_FPS)

        last_upright_t = candidate_t = last_person_t = last_fire_t = 0.0
        hb_t = time.time()
        hb_frames = hb_person = 0

        while self._run:
            t0 = time.time()
            frame, cap = self._read_frame(cap)
            if frame is None:
                time.sleep(0.2)
                continue
            hb_frames += 1

            h, w = frame.shape[:2]
            fg = bg.apply(frame)
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
                    candidate_t = 0.0
                elif ratio <= LYING_RATIO:
                    if last_upright_t and (now - last_upright_t) <= FALL_WINDOW_S:
                        if candidate_t == 0.0:
                            candidate_t = now
                        elif (now - candidate_t) >= STAY_DOWN_S:
                            if (now - last_fire_t) >= COOLDOWN_S:
                                drop = max(0.0, now - last_upright_t)
                                conf = max(0.6, min(0.95, 0.95 - drop * 0.08))
                                _post_fall(self.room, self.name, conf,
                                           "24/7 server-side monitoring detected a collapse "
                                           "(upright->prone, remained down).")
                                last_fire_t = now
                                print(f"[Watchdog] confirmed FALL (conf={conf:.2f}) '{self.name}' room {self.room}")
                            candidate_t = 0.0
                            last_upright_t = 0.0
                    else:
                        candidate_t = 0.0
            elif last_person_t and (now - last_person_t) >= NO_PERSON_RESET_S:
                candidate_t = 0.0
                last_upright_t = 0.0

            if now - hb_t >= 30.0:
                print(f"[Watchdog] heartbeat '{self.name}' room {self.room}: "
                      f"{hb_frames} frames/30s, person in {hb_person}")
                hb_t = now
                hb_frames = hb_person = 0

            dt = time.time() - t0
            if dt < period:
                time.sleep(period - dt)

        if cap is not None:
            cap.release()


def _resolve_source(cam: dict):
    """(use_shared, capture_url) for a monitorable camera, or None if we can't grab it."""
    t = (cam.get("type") or "").lower()
    rtsp = (cam.get("rtspUrl") or "").strip()
    stream = (cam.get("streamUrl") or "").strip()
    if t == "tapo":
        return (True, None)
    if rtsp.startswith("rtsp://"):
        return (False, rtsp)
    if stream.startswith("rtsp://"):
        return (False, stream)
    return None


def _fetch_registry():
    """Enabled cameras for our community, or None if the registry is unreachable."""
    url = f"{FRONTEND_URL}/api/sensors/cameras"
    try:
        r = requests.get(url, headers={"x-api-key": SENSOR_KEY}, timeout=8)
        if r.status_code != 200:
            print(f"[Watchdog] registry fetch {r.status_code}: {r.text[:120]}")
            return None
        return r.json().get("cameras", []) or []
    except Exception as e:
        print(f"[Watchdog] registry fetch failed ({e}); keeping current cameras")
        return None


def _manager_loop():
    print(f"[Watchdog] manager live - discovering cameras from {FRONTEND_URL}/api/sensors/cameras")
    workers: dict[str, CameraWorker] = {}
    skipped_logged: set[str] = set()

    while _wd_run:
        cams = _fetch_registry()

        # Cold-start fallback: registry unreachable and nothing running yet.
        if cams is None and not workers and MONITOR_ROOM:
            cams = [{"id": "env_tapo", "name": f"Tapo (env) Room {MONITOR_ROOM}",
                     "roomNumber": MONITOR_ROOM, "type": "tapo", "enabled": True}]
            print(f"[Watchdog] registry unreachable at start - falling back to env room {MONITOR_ROOM}")

        if cams is not None:
            desired: dict[str, tuple] = {}
            for cam in cams:
                if not cam.get("enabled"):
                    continue
                src = _resolve_source(cam)
                if src is None:
                    if cam.get("id") not in skipped_logged:
                        print(f"[Watchdog] skipping '{cam.get('name')}' (room {cam.get('roomNumber')}) "
                              f"- no server-grabbable RTSP (type={cam.get('type')}). Set an rtspUrl to monitor it.")
                        skipped_logged.add(cam.get("id"))
                    continue
                desired[cam["id"]] = (cam, src)

            # Stop workers for cameras that vanished / were disabled.
            for cid in list(workers):
                if cid not in desired:
                    workers[cid].stop()
                    del workers[cid]

            # Start new workers; update existing (room/name may have changed).
            for cid, (cam, src) in desired.items():
                use_shared, url = src
                if cid in workers:
                    workers[cid].update(cam)
                else:
                    w = CameraWorker(cam, use_shared, url)
                    w.start()
                    workers[cid] = w

            if not workers:
                print("[Watchdog] no monitorable cameras in the registry yet")

        # Sleep REFRESH_S, staying responsive to shutdown.
        waited = 0.0
        while _wd_run and waited < REFRESH_S:
            time.sleep(1.0)
            waited += 1.0

    for w in workers.values():
        w.stop()
    print("[Watchdog] manager stopped")


def start_watchdog():
    """Start the 24/7 multi-camera fall watchdog. No-op if disabled or running."""
    global _mgr_thread, _wd_run
    if not MONITOR_ENABLED:
        print("[Watchdog] disabled (MONITOR_ENABLED=false)")
        return
    if not SENSOR_KEY:
        print("[Watchdog] NOT started: SENSOR_INGEST_API_KEY is not set - cannot record alerts.")
        return
    if _mgr_thread is not None and _mgr_thread.is_alive():
        return
    _wd_run = True
    _mgr_thread = threading.Thread(target=_manager_loop, daemon=True)
    _mgr_thread.start()
    print(f"[Watchdog] server-side fall monitoring ON -> posting to {FRONTEND_URL}")


def stop_watchdog():
    global _wd_run
    _wd_run = False
