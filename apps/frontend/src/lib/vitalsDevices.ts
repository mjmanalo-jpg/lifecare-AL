// ─────────────────────────────────────────────────────────────
// Module 02 — Medical device integration (Web Bluetooth).
//
// One function, `connectVitalsDevice(kind)`, pairs with a standard Bluetooth LE
// medical device, reads one measurement, and returns it mapped to the app's
// VitalType values — so a reading is captured from the instrument directly
// instead of being typed by hand (the single biggest accuracy gain).
//
// Uses the SIG-standard GATT services so it works with any compliant device:
//   Pulse Oximeter   0x1822 / PLX Spot-Check   0x2A5F  → SpO₂ + pulse rate
//   Blood Pressure   0x1810 / Measurement      0x2A35  → systolic/diastolic + pulse
//   Thermometer      0x1809 / Temperature      0x2A1C  → temperature
//   Weight Scale     0x181D / Weight Meas.     0x2A9D  → weight
//   Heart Rate       0x180D / HR Measurement   0x2A37  → heart rate
//   Glucometer       0x1808 / Glucose Meas.    0x2A18  → blood glucose
//
// Vendors with proprietary profiles need their own adapter; the parsers here
// cover the standardised characteristics. Requires a secure context (HTTPS or
// localhost) and a Chromium browser (Chrome/Edge desktop, Chrome on Android).
// ─────────────────────────────────────────────────────────────

import type { VitalType } from "./vitalThresholds";

export type DeviceVitalKind =
  | "pulse_oximeter" | "blood_pressure" | "thermometer"
  | "weight" | "heart_rate" | "glucose";

export interface DeviceReading {
  deviceId: string;
  deviceName: string;
  kind: DeviceVitalKind;
  takenAt: number;
  /** Parsed values keyed by the app's VitalType, formatted as they are stored. */
  values: Partial<Record<VitalType, string>>;
}

export interface DeviceKindMeta { service: number; characteristic: number; label: string }

export const DEVICE_KINDS: Record<DeviceVitalKind, DeviceKindMeta> = {
  pulse_oximeter: { service: 0x1822, characteristic: 0x2a5f, label: "Pulse Oximeter" },
  blood_pressure: { service: 0x1810, characteristic: 0x2a35, label: "Blood Pressure Monitor" },
  thermometer:    { service: 0x1809, characteristic: 0x2a1c, label: "Thermometer" },
  weight:         { service: 0x181d, characteristic: 0x2a9d, label: "Weight Scale" },
  heart_rate:     { service: 0x180d, characteristic: 0x2a37, label: "Heart Rate Monitor" },
  glucose:        { service: 0x1808, characteristic: 0x2a18, label: "Glucometer" },
};

/* ── Minimal Web Bluetooth typing (not in lib.dom) ───────────────────── */
interface BtChar {
  properties?: { read?: boolean; notify?: boolean; indicate?: boolean };
  value?: DataView;
  readValue(): Promise<DataView>;
  startNotifications(): Promise<BtChar>;
  stopNotifications(): Promise<BtChar>;
  addEventListener(type: "characteristicvaluechanged", cb: (e: Event) => void): void;
  removeEventListener(type: "characteristicvaluechanged", cb: (e: Event) => void): void;
}
interface BtService { getCharacteristic(c: number): Promise<BtChar> }
interface BtGatt { connected: boolean; connect(): Promise<BtGatt>; getPrimaryService(s: number): Promise<BtService>; disconnect(): void }
interface BtDevice { id?: string; name?: string; gatt?: BtGatt }
interface BluetoothLike { requestDevice(opts: unknown): Promise<BtDevice> }

function bluetooth(): BluetoothLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth ?? null;
}

/** Whether this browser/context can talk to BLE medical devices. */
export function isBluetoothSupported(): boolean {
  return bluetooth() !== null;
}

/* ── IEEE-11073 numeric formats ──────────────────────────────────────── */
// 16-bit SFLOAT: 4-bit signed exponent, 12-bit signed mantissa.
function readSFloat(dv: DataView, offset: number): number {
  const raw = dv.getUint16(offset, true);
  let mantissa = raw & 0x0fff;
  let exponent = raw >> 12;
  if (exponent >= 0x8) exponent -= 0x10; // signed 4-bit
  if (mantissa >= 0x800) mantissa -= 0x1000; // signed 12-bit
  return mantissa * Math.pow(10, exponent);
}
// 32-bit FLOAT: 8-bit signed exponent, 24-bit signed mantissa.
function readFloat(dv: DataView, offset: number): number {
  const raw = dv.getUint32(offset, true);
  let mantissa = raw & 0x00ffffff;
  let exponent = raw >> 24;
  if (exponent >= 0x80) exponent -= 0x100; // signed 8-bit
  if (mantissa >= 0x800000) mantissa -= 0x1000000; // signed 24-bit
  return mantissa * Math.pow(10, exponent);
}
const round = (n: number, dp = 0) => { const f = Math.pow(10, dp); return Math.round(n * f) / f; };

/* ── Per-characteristic parsers → app VitalType values ───────────────── */
function parse(kind: DeviceVitalKind, dv: DataView): Partial<Record<VitalType, string>> {
  switch (kind) {
    case "heart_rate": {
      // 0x2A37: flags[0], bit0 → 0=uint8, 1=uint16.
      const flags = dv.getUint8(0);
      const hr = flags & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1);
      return { HEART_RATE: String(hr) };
    }
    case "pulse_oximeter": {
      // 0x2A5F PLX Spot-Check: flags[0], SpO₂ SFLOAT[1..2], PR SFLOAT[3..4].
      const spo2 = round(readSFloat(dv, 1));
      const pr = round(readSFloat(dv, 3));
      const out: Partial<Record<VitalType, string>> = { OXYGEN: String(spo2) };
      if (Number.isFinite(pr) && pr > 0) out.HEART_RATE = String(pr);
      return out;
    }
    case "blood_pressure": {
      // 0x2A35: flags[0] (bit0 units: 0=mmHg,1=kPa; bit2 pulse present),
      // systolic SFLOAT[1..2], diastolic SFLOAT[3..4], MAP SFLOAT[5..6].
      const flags = dv.getUint8(0);
      const kpa = (flags & 0x01) === 1;
      const conv = (v: number) => (kpa ? v * 7.50062 : v); // kPa → mmHg
      const sys = round(conv(readSFloat(dv, 1)));
      const dia = round(conv(readSFloat(dv, 3)));
      const out: Partial<Record<VitalType, string>> = { BLOOD_PRESSURE: `${sys}/${dia}` };
      // Pulse rate (if present) sits after systolic/diastolic/MAP + optional timestamp.
      if (flags & 0x04) {
        let off = 7;
        if (flags & 0x02) off += 7; // timestamp block
        try { const pr = round(readSFloat(dv, off)); if (pr > 0) out.HEART_RATE = String(pr); } catch { /* optional */ }
      }
      return out;
    }
    case "thermometer": {
      // 0x2A1C: flags[0] (bit0 units: 0=°C,1=°F), temperature FLOAT[1..4].
      const flags = dv.getUint8(0);
      let temp = readFloat(dv, 1);
      if (flags & 0x01) temp = (temp - 32) * (5 / 9); // °F → °C
      return { TEMPERATURE: String(round(temp, 1)) };
    }
    case "weight": {
      // 0x2A9D: flags[0] (bit0 units: 0=SI kg,1=Imperial lb), weight uint16[1..2].
      const flags = dv.getUint8(0);
      const raw = dv.getUint16(1, true);
      const kg = flags & 0x01 ? raw * 0.01 * 0.453592 : raw * 0.005; // lb→kg or kg
      return { WEIGHT: String(round(kg, 1)) };
    }
    case "glucose": {
      // 0x2A18: flags[0], seq uint16[1..2], base time 7 bytes[3..9],
      // optional time offset (bit0) int16, concentration SFLOAT.
      const flags = dv.getUint8(0);
      let off = 10;
      if (flags & 0x01) off += 2; // time offset present
      const molPerL = (flags & 0x04) !== 0; // bit2: 0=kg/L, 1=mol/L
      const conc = readSFloat(dv, off);
      // kg/L → mg/dL: ×100000 ; mol/L → mg/dL: ×18018 (glucose MW).
      const mgdl = molPerL ? conc * 18018 : conc * 100000;
      return { BLOOD_GLUCOSE: String(round(mgdl)) };
    }
    default:
      return {};
  }
}

/**
 * Pair with a BLE medical device of `kind`, read one measurement, and return it.
 * Rejects if unsupported, cancelled, or no reading arrives before `timeoutMs`.
 */
export async function connectVitalsDevice(kind: DeviceVitalKind, timeoutMs = 45_000): Promise<DeviceReading> {
  const bt = bluetooth();
  if (!bt) throw new Error("Web Bluetooth isn't available here. Use Chrome/Edge on desktop or Chrome on Android over HTTPS, or enter the reading manually.");
  const meta = DEVICE_KINDS[kind];

  const device = await bt.requestDevice({
    filters: [{ services: [meta.service] }],
    optionalServices: [meta.service],
  });
  const gatt = device.gatt;
  if (!gatt) throw new Error("Selected device exposes no GATT server.");

  const server = await gatt.connect();
  try {
    const service = await server.getPrimaryService(meta.service);
    const char = await service.getCharacteristic(meta.characteristic);

    const reading = await new Promise<DataView>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`No measurement received in ${Math.round(timeoutMs / 1000)}s — take a reading on the device while it's connected.`));
      }, timeoutMs);
      const onValue = (e: Event) => {
        const dv = (e.target as unknown as BtChar).value;
        if (!dv || settled) return;
        settled = true;
        clearTimeout(timer);
        char.removeEventListener("characteristicvaluechanged", onValue);
        resolve(dv);
      };
      char.addEventListener("characteristicvaluechanged", onValue);
      // Most vitals characteristics indicate/notify a fresh reading; subscribe,
      // and for read-capable ones also grab the last stored value immediately.
      char.startNotifications().catch(() => { /* fall back to read below */ });
      if (char.properties?.read) {
        char.readValue().then((dv) => onValue({ target: { value: dv } } as unknown as Event)).catch(() => { /* wait for notification */ });
      }
    });

    return {
      deviceId: device.id ?? meta.label,
      deviceName: device.name || meta.label,
      kind,
      takenAt: Date.now(),
      values: parse(kind, reading),
    };
  } finally {
    try { if (server.connected) server.disconnect(); } catch { /* already gone */ }
  }
}
