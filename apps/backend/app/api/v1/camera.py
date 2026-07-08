import cv2
import time
import threading
import numpy as np
import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

# Load frontend's .env.local
env_path = Path(__file__).resolve().parent.parent.parent.parent.parent / "frontend" / ".env.local"
load_dotenv(dotenv_path=env_path)

router = APIRouter()

# Global state to trigger simulated fall alert from external endpoint
is_fallen_alert = False

@router.post("/trigger_fall")
def trigger_fall(status: bool):
    global is_fallen_alert
    is_fallen_alert = status
    return {"status": "ok", "is_fallen": is_fallen_alert}

def generate_simulated_frame():
    # Create a black image of 640x480
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    
    # Draw dark blue gridlines
    for y in range(0, 480, 40):
        cv2.line(frame, (0, y), (640, y), (30, 20, 10), 1)
    for x in range(0, 640, 40):
        cv2.line(frame, (x, 0), (x, 480), (30, 20, 10), 1)
        
    # Draw Simulated Person ONLY (No bounding boxes or labels)
    if is_fallen_alert:
        # Draw horizontal stick figure representing fallen resident
        cv2.circle(frame, (320, 310), 20, (150, 150, 150), -1)
        cv2.line(frame, (320, 310), (200, 310), (150, 150, 150), 3)
        cv2.line(frame, (200, 310), (140, 370), (150, 150, 150), 2)
        cv2.line(frame, (200, 310), (140, 250), (150, 150, 150), 2)
    else:
        # Draw standing stick figure representing resident
        cv2.circle(frame, (320, 140), 25, (150, 150, 150), -1) # Head
        cv2.line(frame, (320, 165), (320, 280), (150, 150, 150), 3) # Spine
        cv2.line(frame, (320, 200), (260, 240), (150, 150, 150), 2) # Left arm
        cv2.line(frame, (320, 200), (380, 240), (150, 150, 150), 2) # Right arm
        cv2.line(frame, (320, 280), (280, 370), (150, 150, 150), 2) # Left leg
        cv2.line(frame, (320, 280), (360, 370), (150, 150, 150), 2) # Right leg

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
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;5000000"
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
_grab_latest = None       # latest encoded JPEG bytes
_grab_thread = None
_grab_run = False

# Downscale + recompress for a light, smooth stream. Detection runs fine at 640px
# and it slashes network + browser decode cost. Tune in apps/backend/.env.
MJPEG_WIDTH = int(os.getenv("MJPEG_WIDTH", "640"))       # 0 = keep native resolution
MJPEG_QUALITY = int(os.getenv("MJPEG_QUALITY", "72"))


def _grab_loop():
    global _grab_latest, _grab_run
    url = _tapo_rtsp_url()
    cap = _open_rtsp(url)
    fails = 0
    while _grab_run:
        if not cap.isOpened():
            cap.release(); time.sleep(0.4); cap = _open_rtsp(url); continue
        ok, frame = cap.read()
        if not ok or frame is None:
            fails += 1
            if fails > 30:                     # ~1.5s of failures -> reconnect
                cap.release(); cap = _open_rtsp(url); fails = 0
            time.sleep(0.02); continue
        fails = 0
        if MJPEG_WIDTH and frame.shape[1] > MJPEG_WIDTH:
            h = int(frame.shape[0] * MJPEG_WIDTH / frame.shape[1])
            frame = cv2.resize(frame, (MJPEG_WIDTH, h), interpolation=cv2.INTER_AREA)
        ok2, jpeg = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), MJPEG_QUALITY])
        if ok2:
            with _grab_lock:
                _grab_latest = jpeg.tobytes()
    cap.release()


def _ensure_grabber():
    global _grab_thread, _grab_run
    if _grab_thread is not None and _grab_thread.is_alive():
        return
    _grab_run = True
    _grab_thread = threading.Thread(target=_grab_loop, daemon=True)
    _grab_thread.start()


def gen_tapo_frames():
    _ensure_grabber()
    while True:
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
