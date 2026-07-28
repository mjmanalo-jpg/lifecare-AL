// Real-time emotion detection using face landmarks, pose analysis, and TensorFlow.js CNN
// 100% local processing, heavily accelerated by WebGL

// Suppress TensorFlow.js verbose logging (WebGL context warnings, etc.)
if (typeof window !== 'undefined' && window.tf) {
  window.tf.env().set('DEBUG', false);
  window.tf.env().set('IS_BROWSER', true);
}

let faceapi = null;
let faceApiLoaded = false;
let faceApiLoading = false;

export async function loadFaceAPI() {
  if (faceApiLoaded || faceApiLoading) return;
  faceApiLoading = true;

  if (!faceapi) {
    faceapi = await import('@vladmandic/face-api');
  }

  // Suppress TensorFlow.js verbose logging during model loading
  const savedDebugMode = global.TF_DEBUG || false;
  if (typeof global !== 'undefined') {
    global.TF_DEBUG = false;
  }

  await faceapi.nets.tinyFaceDetector.loadFromUri('/models/face-api');
  await faceapi.nets.faceExpressionNet.loadFromUri('/models/face-api');
  // 68-pt landmarks (tiny) give the eyelid points → eye-closure via EAR (sleep detection).
  await faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models/face-api');

  // Restore previous debug mode
  if (typeof global !== 'undefined') {
    global.TF_DEBUG = savedDebugMode;
  }

  faceApiLoaded = true;
  faceApiLoading = false;
}

// Self-calibrating baselines for adaptive face shape mapping (fallback)
let baselineWidth = 0.85;
let baselineHeight = 0.95;
let calibrationFrames = 0;
let widthSum = 0;
let heightSum = 0;

// EWMA Smoothing state to prevent flickering
let smoothedWidthRatio = null;
let smoothedHeightRatio = null;

// CNN State
let currentCNNEmotion = null;
let currentCNNConfidence = 0;
let isPredictingCNN = false;

// Eye-closure state (from 68-pt landmark EAR) — powers sleep detection.
let eyesClosed = false;
let eyesClosedSince = 0; // ms timestamp when eyes first went closed (0 = open)
let lastEyeReadMs = 0;   // last time we got a face+landmarks read (for staleness)
let lastEar = 0;         // most recent Eye Aspect Ratio (for live tuning/debug)
let earBaseline = 0;     // adaptive per-person open-eye EAR baseline

// Eye Aspect Ratio for a face-api 6-point eye: low EAR = closed.
function eyeAspectRatio(eye) {
  if (!eye || eye.length < 6) return 1;
  const v1 = dist(eye[1], eye[5]);
  const v2 = dist(eye[2], eye[4]);
  const h = dist(eye[0], eye[3]) || 1e-6;
  return (v1 + v2) / (2 * h);
}

/** Current eye state: { closed, closedForMs, ear, fresh }. Stale reads (no face >3s) read as open. */
export function getEyeState() {
  const fresh = Date.now() - lastEyeReadMs < 3000;
  if (!fresh) return { closed: false, closedForMs: 0, ear: lastEar, base: earBaseline, fresh: false };
  return { closed: eyesClosed, closedForMs: eyesClosed && eyesClosedSince ? Date.now() - eyesClosedSince : 0, ear: lastEar, base: earBaseline, fresh: true };
}
let emotionHistory = []; // rolling window of recent readings for majority-vote smoothing
let lastCNNTime = 0;     // timestamp of last successful face reading (for staleness expiry)

function dist(a, b) {
  if (!a || !b) return 0;
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Fire-and-forget: run the face-expression CNN on the current frame, INDEPENDENT
// of body pose. Tuned for room cameras (larger input + lower threshold) so smaller,
// farther faces (like a Tapo C200 across a room) still get detected.
function triggerFaceCNN(videoElement) {
  if (!videoElement || !faceApiLoaded || isPredictingCNN) return;
  isPredictingCNN = true;
  faceapi
    // scoreThreshold 0.5 = only accept a solid face detection. Loose crops (from a
    // lower threshold) feed the expression net garbage, which it tends to read as
    // "surprised" — the exact bug we're killing here. inputSize 448 still reaches
    // a moderately distant face on a room camera.
    .detectSingleFace(videoElement, new faceapi.TinyFaceDetectorOptions({ inputSize: 448, scoreThreshold: 0.5 }))
    .withFaceLandmarks(true)
    .withFaceExpressions()
    .then(detection => {
      if (detection && detection.detection && detection.detection.score >= 0.5) {
        // ── Eye-closure via Eye Aspect Ratio (drives sleep detection) ──
        try {
          const lm = detection.landmarks;
          if (lm) {
            const ear = (eyeAspectRatio(lm.getLeftEye()) + eyeAspectRatio(lm.getRightEye())) / 2;
            lastEar = ear;
            // Adaptive: learn THIS person's open-eye EAR (track the peak, decay slowly),
            // then flag closed on a clear relative drop. Robust to the model's absolute
            // scale AND to posture (upright works too). Fixed floor as a backstop.
            if (ear > earBaseline) earBaseline = ear;
            else earBaseline = earBaseline * 0.999 + ear * 0.001;
            const closed = (earBaseline > 0.18 && ear < earBaseline * 0.72) || ear < 0.19;
            const nowMs = Date.now();
            if (closed && !eyesClosed) eyesClosedSince = nowMs; // start the closed timer
            if (!closed) eyesClosedSince = 0;                   // opened → reset (blink-safe)
            eyesClosed = closed;
            lastEyeReadMs = nowMs;
          }
        } catch { /* landmarks are best-effort */ }
        const sorted = Object.entries(detection.expressions).sort((a, b) => b[1] - a[1]);
        let [topEmotion, topScore] = sorted[0];
        const runnerUp = sorted[1] ? sorted[1][1] : 0;
        // face-api's expression net over-fires "surprised"/"fearful" on the slightly
        // loose, distant crops a room camera produces — the root of the "always
        // Surprised" readout. Accept those two ONLY when they win decisively
        // (>=0.60 and clearly ahead of the runner-up); otherwise defer to the
        // next-best, more reliable expression.
        if ((topEmotion === "surprised" || topEmotion === "fearful") &&
            (topScore < 0.60 || topScore - runnerUp < 0.20)) {
          [topEmotion, topScore] = sorted[1] || ["neutral", 0.5];
        }
        // Ignore weak expression frames entirely (score < 0.35) so noise never votes.
        if (topScore >= 0.35) {
          emotionHistory.push({ e: topEmotion, c: Math.round(topScore * 100) });
          if (emotionHistory.length > 6) emotionHistory.shift();
          // Majority vote over the recent window: smooths flicker but CAN'T lock —
          // whichever emotion actually dominates the last ~6 reads wins.
          const counts = {};
          for (const h of emotionHistory) counts[h.e] = (counts[h.e] || 0) + 1;
          const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
          const wins = emotionHistory.filter(h => h.e === winner);
          currentCNNEmotion = winner;
          currentCNNConfidence = Math.round(wins.reduce((s, h) => s + h.c, 0) / wins.length);
          lastCNNTime = Date.now();
        }
      }
      isPredictingCNN = false;
    })
    .catch(() => { isPredictingCNN = false; });
}

// Map the latest CNN emotion to a UI result (used when there's no body pose).
function cnnEmotionResult() {
  if (!currentCNNEmotion) return null;
  const M = {
    happy:     ["Happy", "Smiling warmly", "Resident is smiling warmly at the camera."],
    angry:     ["Angry", "Frowning / Pouting", "Resident appears agitated or frustrated."],
    sad:       ["Sad", "Feeling Down", "Resident appears sad."],
    fearful:   ["Fear", "Fearful / Startled", "Resident appears frightened or startled."],
    disgusted: ["Disgust", "Disgusted", "Resident is expressing disgust."],
    surprised: ["Surprised", "Surprised", "Resident appears surprised."],
    neutral:   ["Neutral", "Relaxed", "Resident is relaxed and facing the camera."],
  };
  const [emotion, behavior, summary] = M[currentCNNEmotion] || M.neutral;
  return { globalEmotion: emotion, emotionConfidence: currentCNNConfidence, globalBehavior: behavior,
           globalPosture: "Unknown", alert: false, alertReason: null, summary, objects: [] };
}

export function analyzeEmotionFromLandmarks(landmarks, prevEmotion = null, videoElement = null) {
  // Always run the face CNN when we have an image — even with no body pose.
  triggerFaceCNN(videoElement);

  // Expire a stale reading: if no face has been confidently read for >3s, clear it
  // so a single bad frame can NEVER stick on screen (this is the "always Surprised"
  // freeze). The readout then honestly falls back to "detecting" instead of lying.
  if (currentCNNEmotion && Date.now() - lastCNNTime > 3000) {
    currentCNNEmotion = null;
    currentCNNConfidence = 0;
    emotionHistory = [];
  }

  if (!landmarks || landmarks.length === 0) {
    // No body pose. If the face CNN has a reading, report the real emotion anyway;
    // otherwise we're genuinely not seeing a face yet.
    const cnn = cnnEmotionResult();
    if (cnn) return cnn;
    return {
      globalEmotion: "Neutral",
      emotionConfidence: 0,
      globalBehavior: "No face detected",
      globalPosture: "Unknown",
      alert: false,
      alertReason: null,
      summary: "Waiting for face detection...",
      objects: []
    };
  }

  const lms = landmarks;
  const hasFaceMesh = lms.length >= 468;

  let leftEyeOpen = 0.5;
  let rightEyeOpen = 0.5;
  let mouthOpen = 0.1;
  let browRaised = false;
  let smileIntensity = 0.2;
  let headTilt = 0;
  let pitch = 0;
  let mouthEyeRatio = 0.75;
  let posture = "Upright";
  let emotion = "Neutral";
  let confidence = 50;
  let behavior = "Relaxed";
  let summary = "Resident is relaxed and facing the camera.";

  // Ratios used in calculations
  let currentWidthRatio = 0.85;
  let currentHeightRatio = 0.95;

  if (hasFaceMesh) {
    // Eye analysis
    leftEyeOpen = calculateEyeAspectRatio(
      lms[33], lms[133], lms[160], lms[158], lms[144], lms[145]
    );
    rightEyeOpen = calculateEyeAspectRatio(
      lms[362], lms[263], lms[387], lms[385], lms[373], lms[374]
    );

    // Mouth analysis
    mouthOpen = calculateMouthAspectRatio(
      lms[78], lms[308], lms[13], lms[14]
    );

    // Eyebrow analysis (frown vs smile)
    const leftBrowHeight = (lms[70] && lms[63]) ? Math.abs(lms[70].y - lms[63].y) : 0.02;
    const rightBrowHeight = (lms[300] && lms[293]) ? Math.abs(lms[300].y - lms[293].y) : 0.02;
    browRaised = (leftBrowHeight + rightBrowHeight) / 2 > 0.03;

    // Smile detection
    smileIntensity = (lms[10] && lms[152] && lms[377] && lms[13] && lms[14]) ? calculateSmileIntensity(
      lms[10], lms[152], lms[377], lms[13], lms[14], mouthOpen
    ) : 0.2;

    // Head tilt (emotion indicator)
    const leftEye = (lms[33] && lms[133]) ? { x: (lms[33].x + lms[133].x) / 2, y: (lms[33].y + lms[133].y) / 2 } : null;
    const rightEye = (lms[362] && lms[263]) ? { x: (lms[362].x + lms[263].x) / 2, y: (lms[362].y + lms[263].y) / 2 } : null;
    const dy = (leftEye && rightEye) ? (rightEye.y - leftEye.y) : 0;
    const dx = (leftEye && rightEye) ? Math.abs(rightEye.x - leftEye.x) : 0.1;
    headTilt = (leftEye && rightEye) ? Math.atan2(dy, dx) : 0;

    // Posture analysis
    if (Math.abs(headTilt) > 0.3) {
      posture = headTilt > 0 ? "Tilted Right" : "Tilted Left";
    }

    if (smileIntensity > 0.6 && browRaised && rightEyeOpen > 0.3 && leftEyeOpen > 0.3) {
      emotion = "Happy";
      confidence = Math.min(95, 60 + smileIntensity * 40);
      behavior = "Smiling Warmly";
      summary = "Resident is smiling warmly at the camera.";
    } else if (!rightEyeOpen && !leftEyeOpen && mouthOpen < 0.2) {
      emotion = "Sleeping";
      confidence = 85;
      behavior = "Inactive";
      summary = "Resident is resting or asleep.";
    } else if (mouthOpen > 0.6 && !browRaised) {
      emotion = "Surprised";
      confidence = 70;
      behavior = "Alert";
      summary = "Resident appears surprised.";
    } else if (!browRaised && mouthOpen < 0.2 && rightEyeOpen > 0.5) {
      emotion = "Focused";
      confidence = 65;
      behavior = "Concentrating";
      summary = "Resident is focused on the screen.";
    } else if (browRaised && smileIntensity < 0.3) {
      emotion = "Anxious";
      confidence = 60;
      behavior = "Concerned";
      summary = "Resident shows signs of concern.";
    } else {
      emotion = "Neutral";
      confidence = 50;
      behavior = "Relaxed";
      summary = "Resident is relaxed and facing the camera.";
    }
  } else {
    // Pose-only fallback heuristics (using 33 Pose landmarks)
    const noseTip = lms[0];
    const leftEye = lms[2];
    const rightEye = lms[5];
    const leftMouth = lms[9];
    const rightMouth = lms[10];

    const dy = (leftEye && rightEye) ? (rightEye.y - leftEye.y) : 0;
    const dx = (leftEye && rightEye) ? Math.abs(rightEye.x - leftEye.x) : 0.1;
    headTilt = (leftEye && rightEye) ? Math.atan2(dy, dx) : 0;

    const eyeDist = dist(leftEye, rightEye);
    const mouthWidth = dist(leftMouth, rightMouth);
    const mouthNoseDist = (leftMouth && rightMouth && noseTip) ? (((leftMouth.y + rightMouth.y) / 2) - noseTip.y) : 0.15;

    let rawWidthRatio = eyeDist > 0 ? (mouthWidth / eyeDist) : 0.85;
    let rawHeightRatio = eyeDist > 0 ? (mouthNoseDist / eyeDist) : 0.95;

    if (smoothedWidthRatio === null) {
      smoothedWidthRatio = rawWidthRatio;
      smoothedHeightRatio = rawHeightRatio;
    } else {
      // Fast EWMA to eliminate micro-jitter and flickering while remaining realtime
      smoothedWidthRatio = smoothedWidthRatio * 0.7 + rawWidthRatio * 0.3;
      smoothedHeightRatio = smoothedHeightRatio * 0.7 + rawHeightRatio * 0.3;
    }

    currentWidthRatio = smoothedWidthRatio;
    currentHeightRatio = smoothedHeightRatio;

    // Calibration Phase: first 120 frames (approx 4 seconds at 30fps)
    // Only calibrate when the mouth is in a relatively neutral/relaxed range (filter out startup expressions)
    if (currentWidthRatio > 0.70 && currentWidthRatio < 0.96 && currentHeightRatio > 0.70 && currentHeightRatio < 1.05) {
      calibrationFrames++;
      if (calibrationFrames > 30) {
        widthSum += currentWidthRatio;
        heightSum += currentHeightRatio;
        const validFrames = calibrationFrames - 30;
        baselineWidth = widthSum / validFrames;
        baselineHeight = heightSum / validFrames;
      }
    } else if (calibrationFrames > 80) {
      // Slow continuous adaptation (EMA) once calibrated
      baselineWidth = baselineWidth * 0.999 + currentWidthRatio * 0.001;
      baselineHeight = baselineHeight * 0.999 + currentHeightRatio * 0.001;
    }

    // Pitch: vertical offset of eyes relative to ears.
    const avgEyeY = (leftEye && rightEye) ? (leftEye.y + rightEye.y) / 2 : 0;
    const avgEarY = (lms[7] && lms[8]) ? (lms[7].y + lms[8].y) / 2 : avgEyeY;
    pitch = avgEyeY - avgEarY;

    // Slouch: vertical distance from nose to midpoint of shoulders
    const shlY = (lms[11] && lms[12]) ? (lms[11].y + lms[12].y) / 2 : null;
    const headNeckDist = (shlY && noseTip) ? (shlY - noseTip.y) : 0.2;

    // Posture analysis
    if (shlY && headNeckDist < 0.12) {
      posture = "Slouched";
    } else if (Math.abs(headTilt) > 0.25) {
      posture = headTilt > 0 ? "Tilted Right" : "Tilted Left";
    } else {
      posture = "Upright";
    }

    // Emotion is deliberately NOT inferred from these coarse pose ratios. From a
    // room/Tapo camera the mouth-vs-eye geometry is far too jittery and was the
    // source of the "always Surprised" readout. The face-expression CNN below is the
    // single source of truth for emotion; here we only derive gaze/behavior context
    // from head pitch and leave emotion Neutral until the CNN gives a confident read.
    emotion = "Neutral";
    if (pitch > 0.025) {
      confidence = 55;
      behavior = "Looking Down";
      summary = "Resident is looking down at their lap or screen.";
    } else if (pitch < -0.025) {
      confidence = 55;
      behavior = "Looking Up";
      summary = "Resident is looking up.";
    } else {
      confidence = 50;
      behavior = "Relaxed";
      summary = "Resident is relaxed and facing the camera.";
    }
  }

  // --- TENSORFLOW.JS CNN INTEGRATION ---
  // The face-expression CNN was already triggered at the top of this function
  // (independent of pose). If we have a fresh prediction, override the heuristic.
  if (currentCNNEmotion) {
    // The CNN is the single authority for emotion — override the Neutral default.
    confidence = currentCNNConfidence;
    switch (currentCNNEmotion) {
      case "happy":
        emotion = "Happy";
        behavior = pitch > 0.025 ? "Smiling (Looking Down)" : "Smiling warmly";
        summary = "Resident is smiling warmly at the camera.";
        break;
      case "angry":
        emotion = "Angry";
        behavior = "Frowning / Pouting";
        summary = "Resident appears agitated, frustrated, or pouting.";
        break;
      case "sad":
        emotion = "Sad";
        behavior = "Feeling Down";
        summary = "Resident appears sad or is looking down.";
        break;
      case "fearful":
        emotion = "Fear";
        behavior = "Fearful / Startled";
        summary = "Resident appears extremely frightened or startled.";
        break;
      case "disgusted":
        emotion = "Disgust";
        behavior = "Disgusted";
        summary = "Resident is expressing disgust.";
        break;
      case "surprised":
        emotion = "Surprised";
        behavior = "Surprised";
        summary = "Resident appears surprised.";
        break;
      case "neutral":
      default:
        emotion = "Neutral";
        behavior = "Relaxed";
        summary = "Resident is relaxed and facing the camera.";
        break;
    }
  }

  // Alert conditions
  let alert = false;
  let alertReason = null;

  if (emotion === "Sleeping" && confidence > 75) {
    alert = true;
    alertReason = "Resident sleeping - monitor closely";
  } else if (emotion === "Anxious" && confidence > 65) {
    alert = true;
    alertReason = "Signs of distress detected";
  }

  return {
    globalEmotion: emotion,
    emotionConfidence: Math.round(confidence),
    globalBehavior: behavior,
    globalPosture: posture,
    alert,
    alertReason,
    summary,
    objects: [
      {
        type: "Facial Expression",
        thought: hasFaceMesh 
          ? `Eyes: ${Math.round(leftEyeOpen * 100)}% open, Mouth: ${Math.round(mouthOpen * 100)}% open`
          : `Pose Analysis - Head Tilt: ${Math.round(Math.abs(headTilt) * 180 / Math.PI)}°, W-Ratio: ${currentWidthRatio.toFixed(2)} (Base: ${baselineWidth.toFixed(2)}), H-Ratio: ${currentHeightRatio.toFixed(2)} (Base: ${baselineHeight.toFixed(2)})`,
        risk: alert ? "high" : emotion === "Anxious" ? "medium" : "low"
      }
    ]
  };
}

// Eye Aspect Ratio (EAR) - detects if eyes are open
function calculateEyeAspectRatio(p1, p2, p3, p4, p5, p6) {
  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0.5;
  const A = dist(p1, p2);
  const B = dist(p3, p4);
  const C = dist(p5, p6);
  return (A + B) / (2 * C);
}

// Mouth Aspect Ratio - detects if mouth is open
function calculateMouthAspectRatio(top, bottom, left, right) {
  if (!top || !bottom || !left || !right) return 0.1;
  const vertical = dist(top, bottom);
  const horizontal = dist(left, right);
  return vertical / (horizontal || 0.001);
}

// Smile intensity based on mouth corners and cheek position
function calculateSmileIntensity(noseTip, leftMouth, rightMouth, mouthLeft, mouthRight, mouthOpen) {
  if (!noseTip || !leftMouth || !rightMouth || !mouthLeft || !mouthRight) return 0.2;

  // Distance between mouth corners (wider smile = larger)
  const mouthWidth = dist(leftMouth, rightMouth);

  // Mouth corner lift (smile creates upward curve)
  const leftLift = noseTip.y - leftMouth.y;
  const rightLift = noseTip.y - rightMouth.y;
  const avgLift = (leftLift + rightLift) / 2;

  // Smile score: wider mouth + lifted corners + not too open mouth
  const smileScore = Math.min(1, mouthWidth * 0.5 + Math.max(0, avgLift) * 2 - mouthOpen * 0.3);

  return Math.max(0, Math.min(1, smileScore));
}

// Analyze emotions from base64 image (for API endpoint)
export async function analyzeImageEmotion(imageBase64) {
  try {
    return {
      globalEmotion: "Neutral",
      emotionConfidence: 0,
      globalBehavior: "Analyzing",
      globalPosture: "Detecting",
      alert: false,
      alertReason: null,
      summary: "Image analysis queued",
      objects: []
    };
  } catch (err) {
    return {
      globalEmotion: "Unknown",
      emotionConfidence: 0,
      globalBehavior: "Error",
      globalPosture: "Unknown",
      alert: false,
      alertReason: "Analysis failed",
      summary: "Image analysis failed",
      objects: []
    };
  }
}
