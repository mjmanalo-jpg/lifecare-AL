import cv2
import time
import threading
import numpy as np
import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

# Load env from BOTH the backend's own .env and the frontend's .env.local.
# override=True is critical: uvicorn --reload spawns a child process that inherits
# the parent's (stale) environment, so without override the OLD camera IP sticks
# around across reloads and edits to .env are silently ignored.
_backend_env = Path(__file__).resolve().parent.parent.parent.parent / ".env"
_frontend_env = Path(__file__).resolve().parent.parent.parent.parent.parent / "frontend" / ".env.local"
load_dotenv(dotenv_path=_backend_env, override=True)
load_dotenv(dotenv_path=_frontend_env, override=True)

router = APIRouter()

# Global state to trigger simulated fall alert from external endpoint
is_fallen_alert = False
sim_pan = 0.0
sim_tilt = 0.0

@router.post("/trigger_fall")
def trigger_fall(status: bool):
    global is_fallen_alert
    is_fallen_alert = status
    return {"status": "ok", "is_fallen": is_fallen_alert}

def generate_simulated_frame():
    global sim_pan, sim_tilt
    # Create a black image of 640x480
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    
    # Calculate screen offsets based on camera pan/tilt rotation simulation
    dx = -int(sim_pan * 1.5)
    dy = -int(sim_tilt * 1.2)
    
    # Draw dark blue gridlines shifted by camera movements
    for y in range(0, 480, 40):
        shifted_y = (y - dy) % 480
        cv2.line(frame, (0, shifted_y), (640, shifted_y), (30, 20, 10), 1)
    for x in range(0, 640, 40):
        shifted_x = (x - dx) % 640
        cv2.line(frame, (shifted_x, 0), (shifted_x, 480), (30, 20, 10), 1)
        
    # Draw Simulated Person ONLY (No bounding boxes or labels)
    if is_fallen_alert:
        # Draw horizontal stick figure representing fallen resident
        cv2.circle(frame, (320 + dx, 310 + dy), 20, (150, 150, 150), -1)
        cv2.line(frame, (320 + dx, 310 + dy), (200 + dx, 310 + dy), (150, 150, 150), 3)
        cv2.line(frame, (200 + dx, 310 + dy), (140 + dx, 370 + dy), (150, 150, 150), 2)
        cv2.line(frame, (200 + dx, 310 + dy), (140 + dx, 250 + dy), (150, 150, 150), 2)
    else:
        # Draw standing stick figure representing resident
        cv2.circle(frame, (320 + dx, 140 + dy), 25, (150, 150, 150), -1) # Head
        cv2.line(frame, (320 + dx, 165 + dy), (320 + dx, 280 + dy), (150, 150, 150), 3) # Spine
        cv2.line(frame, (320 + dx, 200 + dy), (260 + dx, 240 + dy), (150, 150, 150), 2) # Left arm
        cv2.line(frame, (320 + dx, 200 + dy), (380 + dx, 240 + dy), (150, 150, 150), 2) # Right arm
        cv2.line(frame, (320 + dx, 280 + dy), (280 + dx, 370 + dy), (150, 150, 150), 2) # Left leg
        cv2.line(frame, (320 + dx, 280 + dy), (360 + dx, 370 + dy), (150, 150, 150), 2) # Right leg

    # Encode as JPEG
    _, jpeg = cv2.imencode('.jpg', frame)
    return jpeg.tobytes()

def gen_frames():
    # Attempt to initialize physical webcam
    cap = cv2.VideoCapture(0)
    
    try:
        while True:
            if cap.isOpened():
                success, frame = cap.read()
                if success:
                    # Stream raw frame directly without any bounding boxes
                    _, jpeg = cv2.imencode('.jpg', frame)
                    frame_bytes = jpeg.tobytes()
                else:
                    # Fallback to simulated graphics if frame capture fails
                    frame_bytes = generate_simulated_frame()
            else:
                # Fallback to simulated graphics if webcam is busy or not connected
                frame_bytes = generate_simulated_frame()
                
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            time.sleep(0.06) # ~16 FPS
    finally:
        cap.release()

@router.get("/feed")
def video_feed():
    return StreamingResponse(gen_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

def _tapo_rtsp_url():
    """
    Build the Tapo RTSP URL with URL-ENCODED credentials.

    Critical: the Tapo "Camera Account" username is often an email, and the password
    may also contain '@'. Left raw, FFmpeg reads the first '@' as the user/host
    separator and the connection silently fails. quote() with safe='' escapes
    '@' -> %40, ':' -> %3A, etc. so the URL parses correctly.
    Credentials come from environment variables only — never hardcode them here.
    """
    from urllib.parse import quote
    ip = os.getenv("NEXT_PUBLIC_TAPO_CAMERA_IP") or os.getenv("CAMERA_IP", "192.168.1.36")
    if ip.startswith(("rtsp://", "rtsps://", "http://", "https://")):
        return ip
    port = os.getenv("NEXT_PUBLIC_TAPO_CAMERA_PORT") or os.getenv("CAMERA_PORT", "554")
    user = os.getenv("NEXT_PUBLIC_TAPO_CAMERA_USERNAME") or os.getenv("CAMERA_USER", "admin")
    pwd = os.getenv("NEXT_PUBLIC_TAPO_CAMERA_PASSWORD") or os.getenv("CAMERA_PASS", "admin")
    stream = os.getenv("NEXT_PUBLIC_TAPO_STREAM") or os.getenv("CAMERA_STREAM", "stream1")
    return f"rtsp://{quote(user, safe='')}:{quote(pwd, safe='')}@{ip}:{port}/{stream}"


def _open_rtsp(url):
    """Open an RTSP capture over TCP with a connect timeout so it can't hang forever."""
    # Force TCP transport (Tapo/UDP is flaky over Wi-Fi) and cap the open/read timeout.
    # CRITICAL: 'stimeout' was renamed to 'timeout' in FFmpeg 5.0+. If only 'stimeout'
    # is set on a modern build it is IGNORED and the connect falls back to the 30s
    # default (the "30090 ms" hang you saw). We set BOTH names (microseconds) so the
    # timeout is honored regardless of FFmpeg version -> a dead host fails in ~3s.
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
        "rtsp_transport;tcp|timeout;3000000|stimeout;3000000|max_delay;500000"
    )
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    # Keep only the newest frame — without this OpenCV queues RTSP frames and the
    # displayed video falls further and further behind real time (the "lag").
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    return cap


# ── Background RTSP grabber ──────────────────────────────────────────────────
# A single daemon thread pulls frames as fast as the camera sends them and keeps
# ONLY the latest one. The HTTP stream serves that latest frame, so viewers always
# get fresh video with minimal latency, and multiple browser tabs share one RTSP
# connection instead of each opening their own (which is what made it crawl).
_grab_lock = threading.Lock()
_grab_latest = None       # latest encoded JPEG bytes (for the MJPEG stream)
_grab_latest_frame = None # latest decoded BGR frame (for server-side detection)
_grab_thread = None
_grab_run = False

# Downscale + recompress for a light, smooth stream. Detection runs fine at 640px
# and it slashes network + browser decode cost. Tune in apps/backend/.env.
MJPEG_WIDTH = int(os.getenv("MJPEG_WIDTH", "640"))       # 0 = keep native resolution
MJPEG_QUALITY = int(os.getenv("MJPEG_QUALITY", "72"))


def _grab_loop():
    global _grab_latest, _grab_latest_frame, _grab_run
    url = _tapo_rtsp_url()
    cap = _open_rtsp(url)
    fails = 0
    first_fail_logged = False
    while _grab_run:
        if not cap.isOpened():
            if not first_fail_logged:
                print(f"[Camera] ⚠️  RTSP connection unavailable. Using simulated frames. URL: {url}")
                first_fail_logged = True
            cap.release(); time.sleep(0.2); cap = _open_rtsp(url); continue
        ok, frame = cap.read()
        if not ok or frame is None:
            fails += 1
            if fails == 1:
                print(f"[Camera] ⚠️  Frame read failed ({fails}/15). Retrying...")
            if fails > 15:                     # ~0.3s of failures -> reconnect (reduced from 30)
                if first_fail_logged:
                    print(f"[Camera] 🔄 Reconnecting to Tapo camera after {fails} failures...")
                cap.release(); cap = _open_rtsp(url); fails = 0; first_fail_logged = False
            time.sleep(0.02); continue
        if first_fail_logged:
            print(f"[Camera] ✅ RTSP connection restored!")
            first_fail_logged = False
        fails = 0
        if MJPEG_WIDTH and frame.shape[1] > MJPEG_WIDTH:
            h = int(frame.shape[0] * MJPEG_WIDTH / frame.shape[1])
            frame = cv2.resize(frame, (MJPEG_WIDTH, h), interpolation=cv2.INTER_AREA)
        ok2, jpeg = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), MJPEG_QUALITY])
        if ok2:
            with _grab_lock:
                _grab_latest = jpeg.tobytes()
                _grab_latest_frame = frame  # raw BGR for the server-side fall watchdog
    cap.release()


def get_latest_frame():
    """Return a copy of the latest decoded BGR frame (or None) for server-side
    detection. Thread-safe; the watchdog reads this instead of touching RTSP or
    re-decoding the JPEG stream."""
    with _grab_lock:
        return None if _grab_latest_frame is None else _grab_latest_frame.copy()


def ensure_grabber():
    """Public alias so other modules (the fall watchdog) can start the shared
    RTSP grabber without reaching into a private name."""
    _ensure_grabber()


def _ensure_grabber():
    global _grab_thread, _grab_run
    if _grab_thread is not None and _grab_thread.is_alive():
        return
    _grab_run = True
    _grab_thread = threading.Thread(target=_grab_loop, daemon=True)
    _grab_thread.start()


def gen_tapo_frames():
    # If DISABLE_TAPO_CAMERA=true in .env, skip RTSP and use simulated frames only
    disable_tapo = os.getenv("DISABLE_TAPO_CAMERA", "false").lower() == "true"
    if not disable_tapo:
        _ensure_grabber()

    while True:
        if disable_tapo:
            # Force simulated frames
            data = generate_simulated_frame()
        else:
            with _grab_lock:
                data = _grab_latest
            if data is None:
                data = generate_simulated_frame()   # placeholder until first real frame lands

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + data + b'\r\n')
        time.sleep(0.04) # ~25 FPS out

@router.get("/tapo_feed")
def tapo_feed():
    return StreamingResponse(gen_tapo_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

from pydantic import BaseModel

class PTZRequest(BaseModel):
    pan: float
    tilt: float

@router.post("/move_position")
def move_position(payload: PTZRequest):
    # Trigger uvicorn reload to pick up updated .env.local variables
    global sim_pan, sim_tilt
    sim_pan = payload.pan
    sim_tilt = payload.tilt
    try:
        from pytapo import Tapo
        import os
        import socket
        from urllib.parse import urlparse, unquote

        # Set connection timeout to prevent socket hangs
        socket.setdefaulttimeout(2.5)

        ip = os.getenv("NEXT_PUBLIC_TAPO_CAMERA_IP")
        user = os.getenv("NEXT_PUBLIC_TAPO_CAMERA_USERNAME")
        password = os.getenv("NEXT_PUBLIC_TAPO_CAMERA_PASSWORD")

        if not ip or not user or not password:
            cam_url = os.getenv("CAMERA_IP")
            if cam_url and cam_url.startswith("rtsp://"):
                parsed = urlparse(cam_url)
                ip = parsed.hostname
                user = parsed.username
                password = parsed.password
                if user:
                    user = unquote(user)
                if password:
                    password = unquote(password)

        if not ip:
            return {"error": "Camera IP not configured", "status": "error"}

        tapo = Tapo(ip, user or "admin", password or "admin", cloudPassword=password or "")
        tapo.moveMotor(int(payload.pan), int(payload.tilt))
        return {"status": "success", "pan": payload.pan, "tilt": payload.tilt}
    except Exception as e:
        print(f"[Tapo PTZ Backend Error] {e}")
        return {"error": str(e), "status": "error"}
