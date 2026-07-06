// Real-time emotion detection using face landmarks and pose analysis
// No API calls needed - 100% local processing

export function analyzeEmotionFromLandmarks(landmarks, prevEmotion = null) {
  if (!landmarks || landmarks.length === 0) {
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

  // Face landmarks (33 points from MediaPipe)
  const lms = landmarks;

  // Eye analysis
  const leftEyeOpen = calculateEyeAspectRatio(
    lms[33], lms[133], lms[160], lms[158], lms[144], lms[145]
  );
  const rightEyeOpen = calculateEyeAspectRatio(
    lms[362], lms[263], lms[387], lms[385], lms[373], lms[374]
  );

  // Mouth analysis
  const mouthOpen = calculateMouthAspectRatio(
    lms[78], lms[308], lms[13], lms[14]
  );

  // Eyebrow analysis (frown vs smile)
  const leftBrowHeight = Math.abs(lms[70].y - lms[63].y);
  const rightBrowHeight = Math.abs(lms[300].y - lms[293].y);
  const browRaised = (leftBrowHeight + rightBrowHeight) / 2 > 0.03;

  // Smile detection
  const smileIntensity = calculateSmileIntensity(
    lms[10], lms[152], lms[377], lms[13], lms[14], mouthOpen
  );

  // Head tilt (emotion indicator)
  const noseTip = lms[4];
  const leftEye = { x: (lms[33].x + lms[133].x) / 2, y: (lms[33].y + lms[133].y) / 2 };
  const rightEye = { x: (lms[362].x + lms[263].x) / 2, y: (lms[362].y + lms[263].y) / 2 };
  const headTilt = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

  // Determine emotion
  let emotion = "Neutral";
  let confidence = 50;
  let behavior = "Calm";

  if (smileIntensity > 0.6 && browRaised && rightEyeOpen > 0.3 && leftEyeOpen > 0.3) {
    emotion = "Happy";
    confidence = Math.min(95, 60 + smileIntensity * 40);
    behavior = "Engaged";
  } else if (!rightEyeOpen && !leftEyeOpen && mouthOpen < 0.2) {
    emotion = "Sleeping";
    confidence = 85;
    behavior = "Inactive";
  } else if (mouthOpen > 0.6 && !browRaised) {
    emotion = "Surprised";
    confidence = 70;
    behavior = "Alert";
  } else if (!browRaised && mouthOpen < 0.2 && rightEyeOpen > 0.5) {
    emotion = "Focused";
    confidence = 65;
    behavior = "Concentrating";
  } else if (browRaised && smileIntensity < 0.3) {
    emotion = "Anxious";
    confidence = 60;
    behavior = "Concerned";
  } else {
    emotion = "Neutral";
    confidence = 50;
    behavior = "Observing";
  }

  // Posture analysis (from head position)
  let posture = "Upright";
  if (Math.abs(headTilt) > 0.5) {
    posture = headTilt > 0 ? "Tilted Right" : "Tilted Left";
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
    summary: `${emotion} (${confidence}% confidence) - ${behavior}`,
    objects: [
      {
        type: "Facial Expression",
        thought: `Eyes: ${Math.round(rightEyeOpen * 100)}% open, Mouth: ${Math.round(mouthOpen * 100)}% open`,
        risk: alert ? "high" : emotion === "Anxious" ? "medium" : "low"
      }
    ]
  };
}

// Eye Aspect Ratio (EAR) - detects if eyes are open
function calculateEyeAspectRatio(p1, p2, p3, p4, p5, p6) {
  const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  const A = dist(p1, p2);
  const B = dist(p3, p4);
  const C = dist(p5, p6);
  return (A + B) / (2 * C);
}

// Mouth Aspect Ratio - detects if mouth is open
function calculateMouthAspectRatio(top, bottom, left, right) {
  const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  const vertical = dist(top, bottom);
  const horizontal = dist(left, right);
  return vertical / (horizontal || 0.001);
}

// Smile intensity based on mouth corners and cheek position
function calculateSmileIntensity(noseTip, leftMouth, rightMouth, mouthLeft, mouthRight, mouthOpen) {
  const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

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
    // This would require ML models to load on server
    // For now, return mock that will be improved with client-side analysis
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
