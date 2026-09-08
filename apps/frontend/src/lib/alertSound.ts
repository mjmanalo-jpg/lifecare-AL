// Notification chime via the Web Audio API — no audio asset to ship. Two tiers:
// a soft single tone for INFO (a task coming due) and an urgent triple tone +
// vibration for WARNING/CRITICAL (an overdue task). Browsers block audio until a
// user gesture, so `unlockAudio()` is called once on first interaction and each
// play resumes a suspended context best-effort.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function beep(a: AudioContext, freq: number, startOffset: number, dur: number, gain = 0.14): void {
  const t0 = a.currentTime + startOffset;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const vibrate = (pattern: number | number[]): void => {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
};

/** Resume a suspended AudioContext — must be called from a user-gesture handler. */
export function unlockAudio(): void {
  const a = audio();
  if (a && a.state === "suspended") a.resume().catch(() => { /* ignore */ });
}

/** Play the alert chime. `urgent` (overdue/warning) → louder triple tone + vibrate. */
export function playAlertChime(urgent: boolean): void {
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") a.resume().catch(() => { /* ignore */ });
  if (urgent) {
    beep(a, 880, 0, 0.16, 0.16);
    beep(a, 880, 0.22, 0.16, 0.16);
    beep(a, 988, 0.44, 0.22, 0.16);
    vibrate([140, 70, 140, 70, 200]);
  } else {
    beep(a, 660, 0, 0.18, 0.11);
    vibrate(90);
  }
}
