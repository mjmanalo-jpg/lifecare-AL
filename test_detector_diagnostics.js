import { analyzeEmotionFromLandmarks } from "./apps/frontend/src/utils/emotionDetector.js";

const mockPoseLandmarks = new Array(33).fill(null).map((_, i) => ({ x: 0.5, y: 0.5, z: 0 }));
mockPoseLandmarks[2] = { x: 0.55, y: 0.40, z: 0 }; // left eye
mockPoseLandmarks[5] = { x: 0.45, y: 0.40, z: 0 }; // right eye
mockPoseLandmarks[9] = { x: 0.545, y: 0.49, z: 0 }; // left mouth
mockPoseLandmarks[10] = { x: 0.455, y: 0.49, z: 0 }; // right mouth
mockPoseLandmarks[0] = { x: 0.50, y: 0.41, z: 0 }; // nose tip
mockPoseLandmarks[7] = { x: 0.56, y: 0.40, z: 0 }; // left ear
mockPoseLandmarks[8] = { x: 0.44, y: 0.40, z: 0 }; // right ear

// Let's run it 60 times to calibrate and print output
for (let i = 0; i < 60; i++) {
  analyzeEmotionFromLandmarks(mockPoseLandmarks);
}
console.log("Output after 60 runs:", analyzeEmotionFromLandmarks(mockPoseLandmarks));
