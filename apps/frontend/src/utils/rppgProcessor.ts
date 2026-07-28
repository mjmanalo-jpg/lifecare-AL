/**
 * RPPG (Remote Photoplethysmography) Processor
 * Estimates heart rate + respiration from the subtle color changes in a facial
 * ROI sampled every animation frame (~10-30 fps).
 *
 * Approach:
 * - Sample a CHROM-style skin-color value per frame WITH a real timestamp.
 * - Derive the true sampling rate from the timestamps (the RAF loop is not a
 *   fixed 30 fps), detrend + Hann-window the buffer, and run a band-limited
 *   periodogram (a small DFT scanned over the physiological band) to find the
 *   dominant frequency: 0.7-4.0 Hz for heart rate, 0.15-0.40 Hz for respiration.
 * - Confidence = spectral concentration (peak power / total in-band power), so a
 *   noisy/motion-corrupted window reports low confidence and the caller holds the
 *   last good reading instead of showing garbage.
 *
 * NOTE: temperature and SpO2 CANNOT be derived from an RGB webcam — the caller
 * shows those as clearly-labelled estimates, not measurements.
 */

interface VitalEstimate {
  heartRate: number;        // bpm
  respirationRate: number;  // breaths/min
  systolicBP: number;
  diastolicBP: number;
  confidence: number;       // 0-100
  fps: number;              // measured sampling rate
  signal: number[];         // recent detrended samples (for the wave HUD)
}

class RppgProcessor {
  private values: number[] = [];
  private times: number[] = []; // ms timestamps, parallel to values
  private readonly WINDOW_MS = 12_000; // ~12s rolling window
  private readonly MIN_MS = 6_000;     // need >=6s before a first estimate
  private lastEstimate: VitalEstimate | null = null;

  /** Push one per-frame ROI color sample with its capture timestamp (ms). */
  addSample(value: number, tMs: number): void {
    if (!isFinite(value)) return;
    this.values.push(value);
    this.times.push(tMs);
    const cutoff = tMs - this.WINDOW_MS;
    while (this.times.length && this.times[0] < cutoff) {
      this.times.shift();
      this.values.shift();
    }
  }

  /** Backward-compatible single-value push (assumes "now"). */
  addPPGValue(value: number): void {
    this.addSample(value, Date.now());
  }

  /** Mean CHROM-ish skin signal from a face ROI's RGBA pixel buffer. */
  static roiValue(data: Uint8ClampedArray): number {
    let r = 0, g = 0, b = 0;
    const px = data.length / 4;
    if (px === 0) return NaN;
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    r /= px; g /= px; b /= px;
    // CHROM chrominance X-signal: robust to luminance/motion vs raw green.
    const x = 3 * r - 2 * g;
    const y = 1.5 * r + g - 1.5 * b;
    const mag = Math.hypot(x, y);
    return mag > 0 ? (x / mag) * 100 : 0;
  }

  private detrendWindowed(): number[] {
    const n = this.values.length;
    const mean = this.values.reduce((a, b) => a + b, 0) / n;
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      // remove DC + apply a Hann window to reduce spectral leakage
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      out[i] = (this.values[i] - mean) * w;
    }
    return out;
  }

  /** Return { freq, power, concentration } for the dominant bin in [fLo,fHi]. */
  private bandPeak(sig: number[], fs: number, fLo: number, fHi: number, stepHz: number) {
    const n = sig.length;
    let best = { freq: 0, power: 0 };
    let total = 0;
    for (let f = fLo; f <= fHi; f += stepHz) {
      let re = 0, im = 0;
      const w = (2 * Math.PI * f) / fs;
      for (let k = 0; k < n; k++) { re += sig[k] * Math.cos(w * k); im -= sig[k] * Math.sin(w * k); }
      const power = re * re + im * im;
      total += power;
      if (power > best.power) best = { freq: f, power };
    }
    return { ...best, concentration: total > 0 ? best.power / total : 0 };
  }

  /** Compute vitals from the current window, or null if not enough clean signal. */
  estimate(): VitalEstimate | null {
    const n = this.values.length;
    if (n < 24) return null;
    const spanMs = this.times[n - 1] - this.times[0];
    if (spanMs < this.MIN_MS) return null;

    const fps = ((n - 1) / spanMs) * 1000;
    if (fps < 5 || fps > 60) return null; // implausible sampling rate

    const sig = this.detrendWindowed();
    const hr = this.bandPeak(sig, fps, 0.7, 4.0, 0.05);   // 42-240 bpm
    const rr = this.bandPeak(sig, fps, 0.15, 0.45, 0.01); // 9-27 br/min
    if (hr.power === 0) return null;

    const heartRate = Math.round(hr.freq * 60);
    const respirationRate = rr.power > 0 ? Math.round(rr.freq * 60) : 16;
    if (heartRate < 42 || heartRate > 200) return null;

    // Confidence from how concentrated the HR peak is + how much window we have.
    const confidence = Math.max(
      5,
      Math.min(99, Math.round(hr.concentration * 130 + Math.min(1, spanMs / this.WINDOW_MS) * 20)),
    );

    const { systolic, diastolic } = this.estimateBP(heartRate);
    const est: VitalEstimate = {
      heartRate, respirationRate,
      systolicBP: systolic, diastolicBP: diastolic,
      confidence, fps: Math.round(fps),
      signal: sig.slice(-90),
    };
    this.lastEstimate = est;
    return est;
  }

  /** Rough BP proxy from HR (NOT clinical — a heuristic baseline). */
  private estimateBP(heartRate: number): { systolic: number; diastolic: number } {
    const hrFactor = (heartRate - 65) * 0.4;
    let systolic = Math.round(118 + hrFactor);
    let diastolic = Math.round(76 + hrFactor * 0.35);
    systolic = Math.max(95, Math.min(165, systolic));
    diastolic = Math.max(60, Math.min(105, diastolic));
    if (systolic <= diastolic) systolic = diastolic + 12;
    return { systolic, diastolic };
  }

  reset(): void { this.values = []; this.times = []; this.lastEstimate = null; }
  getSignal(): number[] { return this.values.slice(); }
  get last(): VitalEstimate | null { return this.lastEstimate; }
}

export const rppgProcessor = new RppgProcessor();
export { RppgProcessor };
export type { VitalEstimate };
