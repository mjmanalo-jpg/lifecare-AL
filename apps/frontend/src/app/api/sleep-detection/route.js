import { NextResponse } from "next/server";

// Sleep detection logic
export async function POST(req) {
  try {
    const body = await req.json();
    const { imageBase64, poseData } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: "No image" }, { status: 400 });
    }

    // Analyze pose for sleep indicators
    const sleepScore = analyzeSleep(poseData);

    return NextResponse.json({
      sleeping: sleepScore > 0.7,
      sleepScore: sleepScore,
      indicators: {
        eyesClosed: sleepScore > 0.5,
        headDown: sleepScore > 0.6,
        stillness: sleepScore > 0.4,
        noMovement: sleepScore > 0.65,
        position: detectPosition(poseData)
      },
      alert: sleepScore > 0.7,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function analyzeSleep(poseData) {
  if (!poseData) return 0;

  let sleepScore = 0;

  // Eyes closed = high sleep indicator
  if (poseData.eyesClosed) sleepScore += 0.4;

  // Head tilted down = sleeping position
  if (poseData.headTilt && poseData.headTilt > 30) sleepScore += 0.3;

  // Very still = not moving
  if (poseData.motionLevel && poseData.motionLevel < 0.1) sleepScore += 0.2;

  // Shoulders relaxed = sleeping
  if (poseData.shoulderRelaxed) sleepScore += 0.1;

  return Math.min(sleepScore, 1);
}

function detectPosition(poseData) {
  if (!poseData) return "unknown";

  const keypoints = poseData.keypoints || {};

  // Check if lying down
  const headY = keypoints.head?.y || 0;
  const torsoY = keypoints.torso?.y || 0;
  const legsY = keypoints.legs?.y || 0;

  if (Math.abs(headY - torsoY) < 20) return "lying";
  if (headY > torsoY + 50) return "slouched";
  if (headY < torsoY - 100) return "normal";

  return "unknown";
}
