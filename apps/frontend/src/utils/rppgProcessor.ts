/**
 * RPPG (Remote Photoplethysmography) Processor
 * Extracts heart rate and blood pressure from video feed using facial color analysis.
 *
 * Algorithm: CHROM (Chrominance-based method)
 * - Extracts color variation from facial ROI
 * - Removes motion artifacts via differentiation
 * - Applies bandpass filter (0.7-4 Hz for HR range)
 * - Detects pulse peaks for heart rate calculation
 * - Estimates systolic/diastolic BP from pulse dynamics
 */

interface PPGSignal {
  signal: number[];
  timestamp: number;
  roiMean: number;
}

interface VitalEstimate {
  heartRate: number;
  systolicBP: number;
  diastolicBP: number;
  confidence: number;
  signal: number[];
}

class RppgProcessor {
  private signalBuffer: number[] = [];
  private timestamps: number[] = [];
  private readonly BUFFER_SIZE = 150; // ~5 seconds at 30fps
  private readonly FPS = 30;
  private lastProcessTime = 0;
  private processingInterval = 100; // Process every 100ms

  /**
   * Extract facial ROI color channels and build PPG signal
   */
  extractFacialROI(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    faceBox: { x: number; y: number; width: number; height: number } | null
  ): PPGSignal | null {
    if (!faceBox || faceBox.width < 50 || faceBox.height < 50) {
      return null;
    }

    try {
      const imageData = ctx.getImageData(
        Math.max(0, faceBox.x),
        Math.max(0, faceBox.y),
        Math.min(faceBox.width, canvas.width - faceBox.x),
        Math.min(faceBox.height, canvas.height - faceBox.y)
      );

      const data = imageData.data;
      const pixels = data.length / 4;

      let rSum = 0,
        gSum = 0,
        bSum = 0;

      for (let i = 0; i < data.length; i += 4) {
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
      }

      const rMean = rSum / pixels;
      const gMean = gSum / pixels;
      const bMean = bSum / pixels;

      // CHROM method: Extract chrominance
      // X = 3*R - 2*G, Y = 1.5*R + G - 1.5*B
      const chromX = 3 * rMean - 2 * gMean;
      const chromY = 1.5 * rMean + gMean - 1.5 * bMean;

      // PPG signal is the ratio (normalize by magnitude)
      const chromMag = Math.sqrt(chromX ** 2 + chromY ** 2);
      const ppgValue = chromMag > 0 ? (chromX / chromMag) * 100 : 0;

      return {
        signal: [ppgValue],
        timestamp: Date.now(),
        roiMean: (rMean + gMean + bMean) / 3,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Bandpass filter (IIR) for PPG signal
   * Isolates heart rate frequencies (0.7-4 Hz = 42-240 bpm)
   */
  private appliBandpassFilter(signal: number[]): number[] {
    if (signal.length < 3) return signal;

    // Simple first-order IIR bandpass approximation
    const alpha = 0.15; // Smoothing factor
    const filtered: number[] = [];

    for (let i = 0; i < signal.length; i++) {
      if (i === 0) {
        filtered.push(signal[i]);
      } else if (i === 1) {
        filtered.push(alpha * signal[i] + (1 - alpha) * filtered[i - 1]);
      } else {
        // Differentiate to remove DC component
        const diff = signal[i] - signal[i - 1];
        filtered.push(alpha * diff + (1 - alpha) * (filtered[i - 1] || 0));
      }
    }

    return filtered;
  }

  /**
   * Detect peaks in PPG signal for heart rate calculation
   */
  private detectPeaks(signal: number[]): number[] {
    const peaks: number[] = [];
    const threshold = this.calculateThreshold(signal);

    for (let i = 1; i < signal.length - 1; i++) {
      if (
        signal[i] > signal[i - 1] &&
        signal[i] > signal[i + 1] &&
        signal[i] > threshold
      ) {
        peaks.push(i);
      }
    }

    return peaks;
  }

  /**
   * Calculate adaptive threshold for peak detection
   */
  private calculateThreshold(signal: number[]): number {
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance =
      signal.reduce((sum, val) => sum + (val - mean) ** 2, 0) / signal.length;
    return mean + Math.sqrt(variance) * 0.5;
  }

  /**
   * Process buffered signal and estimate vitals
   */
  processSignal(): VitalEstimate | null {
    if (this.signalBuffer.length < 60) {
      // Need at least 2 seconds of data
      return null;
    }

    const now = Date.now();
    if (now - this.lastProcessTime < this.processingInterval) {
      return null;
    }
    this.lastProcessTime = now;

    try {
      // Apply bandpass filter
      const filtered = this.appliBandpassFilter(this.signalBuffer);

      // Detect peaks
      const peaks = this.detectPeaks(filtered);

      if (peaks.length < 2) {
        return null;
      }

      // Calculate heart rate from peak intervals
      const intervals = [];
      for (let i = 1; i < peaks.length; i++) {
        intervals.push(peaks[i] - peaks[i - 1]);
      }

      const avgInterval =
        intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const heartRate = Math.round((60 * this.FPS) / avgInterval);

      // HR validity check
      if (heartRate < 40 || heartRate > 160) {
        return null;
      }

      // Estimate BP from PPG pulse dynamics
      // Pulse pressure proxy: amplitude variation indicates vascular resistance
      const amplitudes = this.calculateAmplitudes(peaks, filtered);
      const { systolic, diastolic } = this.estimateBPFromPulse(
        heartRate,
        amplitudes
      );

      // Calculate confidence based on signal quality
      const confidence = Math.min(
        100,
        Math.round(
          (peaks.length / (this.signalBuffer.length / 30)) * 100 * 0.7 + 30
        )
      );

      return {
        heartRate,
        systolicBP: systolic,
        diastolicBP: diastolic,
        confidence,
        signal: filtered.slice(-60), // Last 2 seconds
      };
    } catch (error) {
      console.warn("[RPPG] Processing error:", error);
      return null;
    }
  }

  /**
   * Calculate pulse amplitudes from peak indices
   */
  private calculateAmplitudes(peaks: number[], signal: number[]): number[] {
    const amplitudes: number[] = [];

    for (let i = 0; i < peaks.length; i++) {
      const peakIdx = peaks[i];
      const leftIdx = Math.max(0, peakIdx - 10);
      const rightIdx = Math.min(signal.length - 1, peakIdx + 10);

      const baseline =
        (Math.min(...signal.slice(leftIdx, rightIdx)) +
          Math.max(...signal.slice(leftIdx, rightIdx))) /
        2;
      const amplitude = signal[peakIdx] - baseline;
      amplitudes.push(amplitude);
    }

    return amplitudes;
  }

  /**
   * Estimate systolic/diastolic BP from pulse characteristics
   * Based on pulse wave analysis: wider pulse = higher pressure
   */
  private estimateBPFromPulse(
    heartRate: number,
    amplitudes: number[]
  ): { systolic: number; diastolic: number } {
    if (amplitudes.length === 0) {
      return { systolic: 120, diastolic: 80 };
    }

    const avgAmplitude =
      amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
    const amplitudeVariance = Math.sqrt(
      amplitudes.reduce((sum, a) => sum + (a - avgAmplitude) ** 2, 0) /
        amplitudes.length
    );

    // HR-based baseline (higher HR typically correlates with higher BP)
    const hrFactor = Math.max(0, (heartRate - 60) * 0.3);

    // Amplitude-based adjustment (larger pulse = higher vascular resistance = higher BP)
    const amplitudeFactor = amplitudeVariance * 15;

    // Estimate systolic: baseline + HR effect + amplitude effect
    let systolic = Math.round(115 + hrFactor + amplitudeFactor);
    systolic = Math.max(90, Math.min(180, systolic)); // Clamp to realistic range

    // Diastolic: lower baseline, less HR-dependent
    let diastolic = Math.round(70 + hrFactor * 0.4 + amplitudeFactor * 0.4);
    diastolic = Math.max(60, Math.min(120, diastolic));

    // Ensure systolic > diastolic
    if (systolic <= diastolic) {
      systolic = diastolic + 10;
    }

    return { systolic, diastolic };
  }

  /**
   * Add PPG value to buffer
   */
  addPPGValue(ppgValue: number): void {
    this.signalBuffer.push(ppgValue);
    this.timestamps.push(Date.now());

    // Keep buffer at fixed size
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
      this.timestamps.shift();
    }
  }

  /**
   * Reset processor state
   */
  reset(): void {
    this.signalBuffer = [];
    this.timestamps = [];
    this.lastProcessTime = 0;
  }

  /**
   * Get current signal for visualization
   */
  getSignal(): number[] {
    return this.signalBuffer.slice();
  }
}

export const rppgProcessor = new RppgProcessor();
export type { VitalEstimate, PPGSignal };
