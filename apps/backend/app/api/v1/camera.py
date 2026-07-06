import cv2
import time
import numpy as np
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

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
