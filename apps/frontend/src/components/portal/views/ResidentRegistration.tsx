"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Swal from "@/lib/swal";
import {
  Mail, Lock, User, ScanFace, Stethoscope, BedDouble, HeartPulse,
  Check, ChevronLeft, ChevronRight, X, Plus, Search, Eye, EyeOff,
  CheckCircle2, Loader2, AlertTriangle, ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
  Camera, RefreshCw, Video, VideoOff, type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "@/lib/useLiveQuery";

// ── 7-step registration pipeline ───────────────────────────────────────────
const STEPS = [
  { n: 1, key: "account",  label: "Account",      icon: Mail,         required: true  },
  { n: 2, key: "personal", label: "Personal",     icon: User,         required: true  },
  { n: 3, key: "face",     label: "Face Enroll",  icon: ScanFace,     required: true  },
  { n: 4, key: "medical",  label: "Medical",      icon: Stethoscope,  required: false },
  { n: 5, key: "care",     label: "Care & Room",  icon: BedDouble,    required: true  },
  { n: 6, key: "plan",     label: "Care Plan",    icon: HeartPulse,   required: false },
  { n: 7, key: "review",   label: "Review",       icon: CheckCircle2, required: true  },
] as const;
const STEP_COUNT = STEPS.length;

const CARE_LEVELS = ["INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"];

type Dir = "left" | "right" | "up" | "down";
const DIRECTIONS: { key: Dir; label: string; hint: string; icon: LucideIcon }[] = [
  { key: "left",  label: "Look Left",  hint: "Slowly turn your head to the left",  icon: ArrowLeft  },
  { key: "right", label: "Look Right", hint: "Slowly turn your head to the right", icon: ArrowRight },
  { key: "up",    label: "Look Up",    hint: "Tilt your chin slightly upward",     icon: ArrowUp    },
  { key: "down",  label: "Look Down",  hint: "Tilt your chin slightly downward",   icon: ArrowDown  },
];

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const emptyForm = {
  email: "", password: "", confirm: "",
  firstName: "", lastName: "", dateOfBirth: "", gender: "", phone: "",
  emergencyContact: "", emergencyContactPhone: "",
  allergies: "", medicalHistory: "",
  careLevel: "", mobility: "", roomNumber: "",
  carePlan: "",
};
type Form = typeof emptyForm;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-gray-400 focus:border-transparent outline-none text-sm";

async function uploadDataUrl(dataUrl: string, filename: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const fd = new FormData();
  fd.append("file", new File([blob], filename, { type: blob.type || "image/jpeg" }));
  fd.append("folder", "residents/faces");
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
  return data.url as string;
}

export default function ResidentRegistration({ variant = "admin", accent = "#f59e0b" }: { variant?: "admin" | "public"; accent?: string }) {
  const isPublic = variant === "public";
  const router = useRouter();
  // Public (pre-auth) visitors can't read the authenticated residents/rooms
  // collections, so those queries are disabled and the server auto-assigns a room.
  const { data: residentRows, loading, refetch } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"], enabled: !isPublic });
  const { data: roomRows } = useLiveQuery<Row>("rooms", { query: "take=300", tables: ["Room"], enabled: !isPublic });

  const [wizardOpen, setWizardOpen] = useState(isPublic);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Form>({ ...emptyForm, careLevel: isPublic ? "INDEPENDENT" : "" });
  const [faces, setFaces] = useState<Partial<Record<Dir, string>>>({});
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // Registered resident logins = residents with a linked userId.
  const registered = useMemo(() => residentRows.filter((r) => r.userId), [residentRows]);

  // Room availability (mirrors admissions: residents already occupy rooms).
  const occupied = useMemo(() => {
    const t = new Set<string>();
    residentRows.forEach((r) => r.roomNumber && t.add(s(r.roomNumber)));
    return t;
  }, [residentRows]);
  const availableRooms = useMemo(
    () => roomRows.map((r) => s(r.roomNumber)).filter((n) => n && !occupied.has(n)),
    [roomRows, occupied],
  );

  // ── Webcam lifecycle (only live while on the Face Enrollment step) ─────────
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camState, setCamState] = useState<"idle" | "starting" | "on" | "error">("idle");
  const [camError, setCamError] = useState("");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamState("idle");
  }, []);

  const startCamera = useCallback(async () => {
    setCamState("starting");
    setCamError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCamState("on");
    } catch (err) {
      setCamState("error");
      setCamError(err instanceof Error ? err.message : "Camera unavailable. You can upload a photo per pose instead.");
    }
  }, []);

  useEffect(() => {
    if (wizardOpen && step === 3) startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [wizardOpen, step, startCamera, stopCamera]);

  const captureFace = (dir: Dir) => {
    const video = videoRef.current;
    if (!video || camState !== "on") return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Mirror horizontally so the saved image matches what the user sees.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setFaces((f) => ({ ...f, [dir]: canvas.toDataURL("image/jpeg", 0.82) }));
  };

  const onUploadFace = (dir: Dir, file: File) => {
    const reader = new FileReader();
    reader.onload = () => setFaces((f) => ({ ...f, [dir]: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const facesDone = DIRECTIONS.filter((d) => faces[d.key]).length;

  const openNew = () => {
    setForm({ ...emptyForm });
    setFaces({});
    setStep(1);
    setWizardOpen(true);
  };
  const closeWizard = () => { stopCamera(); if (isPublic) router.push("/login"); else setWizardOpen(false); };

  // ── Per-step validation ────────────────────────────────────────────────────
  const stepError = (n: number): string | null => {
    if (n === 1) {
      if (!emailOk(form.email)) return "Enter a valid email address.";
      if (form.password.length < 6) return "Password must be at least 6 characters.";
      if (form.password !== form.confirm) return "Passwords do not match.";
    }
    if (n === 2 && (!form.firstName.trim() || !form.lastName.trim())) return "First and last name are required.";
    if (n === 3 && facesDone < 4) return "Capture all four facial poses (left, right, up, down).";
    if (n === 5) {
      if (!form.careLevel) return "Select a care level.";
      if (!isPublic) {
        if (!form.roomNumber) return "Assign a room.";
        if (occupied.has(form.roomNumber)) return `Room ${form.roomNumber} is already occupied.`;
      }
    }
    return null;
  };
  const canNavigateTo = (target: number) => {
    if (target <= step) return true;
    for (let n = 1; n < target; n++) if (stepError(n)) return false;
    return true;
  };
  const next = () => {
    const err = stepError(step);
    if (err) { Swal.fire({ title: "Complete this step", text: err, icon: "warning" }); return; }
    setStep((n) => Math.min(n + 1, STEP_COUNT));
  };

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!emailOk(form.email) || form.password.length < 6 || form.password !== form.confirm) m.push("valid account credentials");
    if (!form.firstName.trim() || !form.lastName.trim()) m.push("full name");
    if (facesDone < 4) m.push("4 facial poses");
    if (!form.careLevel) m.push("care level");
    if (!isPublic && !form.roomNumber) m.push("room assignment");
    return m;
  }, [form, facesDone, isPublic]);

  // Auto-pick the first available room when reaching the Care & Room step (admin only).
  useEffect(() => {
    if (!isPublic && step === 5 && !form.roomNumber && availableRooms.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      set({ roomNumber: availableRooms[0] });
    }
  }, [step, form.roomNumber, availableRooms]);

  const register = async () => {
    if (missing.length) {
      Swal.fire({ title: "Not ready to register", html: `Please provide: <b>${missing.join(", ")}</b>.`, icon: "warning" });
      return;
    }
    setSaving(true);
    try {
      // Upload the 4 poses; fall back to the inline data URL if upload fails.
      const faceUrls: Partial<Record<Dir, string>> = {};
      for (const d of DIRECTIONS) {
        const preview = faces[d.key];
        if (!preview) continue;
        try { faceUrls[d.key] = await uploadDataUrl(preview, `face-${d.key}.jpg`); }
        catch { faceUrls[d.key] = preview; }
      }
      const res = await fetch("/api/register/resident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email, password: form.password,
          firstName: form.firstName, lastName: form.lastName,
          dateOfBirth: form.dateOfBirth || null, gender: form.gender || null, phone: form.phone || null,
          emergencyContact: form.emergencyContact || null, emergencyContactPhone: form.emergencyContactPhone || null,
          allergies: form.allergies || null, medicalHistory: form.medicalHistory || null,
          careLevel: form.careLevel, mobility: form.mobility || null, roomNumber: form.roomNumber || null,
          carePlan: form.carePlan || null,
          photoUrl: faceUrls.up || faceUrls.right || faceUrls.left || faceUrls.down || null,
          faces: faceUrls,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      stopCamera();
      if (!isPublic) await refetch();
      setWizardOpen(false);
      await Swal.fire({
        title: "Registration Complete",
        html: `<b>${form.firstName} ${form.lastName}</b> can now sign in with <code>${form.email}</code>.<br/>${data.faces || 0} facial poses enrolled.`,
        icon: "success",
      });
      if (isPublic) router.push("/login");
    } catch (err) {
      Swal.fire({ title: "Registration failed", text: err instanceof Error ? err.message : "Could not register resident.", icon: "error" });
    } finally {
      setSaving(false);
    }
  };

  const doneSet = new Set<number>();
  for (let n = 1; n < step; n++) if (!stepError(n)) doneSet.add(n);

  const q = search.trim().toLowerCase();
  const filtered = registered.filter((r) => !q || `${s(r.firstName)} ${s(r.lastName)}`.toLowerCase().includes(q) || s(r.roomNumber).toLowerCase().includes(q) || s(r.email).toLowerCase().includes(q));

  return (
    <>
    {!isPublic && (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: accent }}>Resident Registration</h1>
          <p className="text-gray-600 text-sm mt-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            {STEP_COUNT}-step self-service enrollment with credentials &amp; facial recognition
          </p>
        </div>
        <button onClick={openNew} style={{ background: accent }} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-white font-semibold hover:shadow-lg transition self-start">
          <Plus className="w-4 h-4" /> Register Resident
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Stat label="Resident Logins" value={registered.length} tone="amber" />
        <Stat label="Total Residents" value={residentRows.length} tone="green" />
        <Stat label="Rooms Available" value={availableRooms.length} tone="gray" />
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search registered residents…" className={`${inputCls} pl-10`} />
      </div>

      {/* List */}
      {loading && residentRows.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading residents…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">No registered resident logins yet. Click <b>Register Resident</b> to enroll one.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((r) => (
            <div key={s(r.id)} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
              {r.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s(r.photoUrl)} alt="" className="w-12 h-12 rounded-full object-cover border border-gray-200" />
              ) : (
                <div style={{ background: accent }} className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold">{s(r.firstName).charAt(0)}</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 truncate">{s(r.firstName)} {s(r.lastName)}</p>
                <p className="text-xs text-gray-500 truncate">{s(r.email) || "—"}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-semibold">Room {s(r.roomNumber)}</span>
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-semibold">{s(r.careLevel)}</span>
                  {r.photoUrl && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-semibold inline-flex items-center gap-0.5"><ScanFace className="w-3 h-3" /> Face</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    )}

      {/* Wizard */}
      {wizardOpen && (
        <div className={isPublic ? "relative z-10 min-h-screen flex items-center justify-center p-4" : "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div style={{ background: accent }} className="text-white px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">{form.firstName || form.lastName ? `${form.firstName} ${form.lastName}`.trim() : "New Resident"}</h2>
                <p className="text-white/80 text-xs">Step {step} of {STEP_COUNT} — {STEPS[step - 1].label}</p>
              </div>
              <button onClick={closeWizard} className="p-2 hover:bg-white/10 rounded-lg"><X className="w-5 h-5" /></button>
            </div>

            {/* Stepper */}
            <div className="flex items-center gap-1 px-4 py-3 border-b border-gray-100 overflow-x-auto">
              {STEPS.map((st) => {
                const isDone = doneSet.has(st.n);
                const active = st.n === step;
                const reachable = canNavigateTo(st.n);
                const Icon = st.icon;
                return (
                  <button key={st.n} onClick={() => reachable && setStep(st.n)} disabled={!reachable}
                    className={`flex flex-col items-center gap-1 px-2 min-w-[62px] group ${reachable ? "" : "opacity-40 cursor-not-allowed"}`}>
                    <span style={active ? { background: accent, borderColor: accent } : undefined} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition ${active ? "text-white" : isDone ? "border-green-500 bg-green-500 text-white" : "border-gray-300 text-gray-400 group-hover:border-gray-400"}`}>
                      {isDone && !active ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </span>
                    <span style={active ? { color: accent } : undefined} className={`text-[10px] text-center leading-tight ${active ? "font-semibold" : "text-gray-500"}`}>
                      {st.label}{st.required && <span className="text-red-400">*</span>}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto flex-1">
              {/* Step 1 — Account */}
              {step === 1 && (
                <div className="space-y-4">
                  <Field label="Email Address *">
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                      <input className={`${inputCls} pl-9`} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="resident@example.com" autoComplete="off" />
                    </div>
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Password * (min 6)">
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                        <input className={`${inputCls} pl-9 pr-9`} type={showPw ? "text" : "password"} value={form.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" />
                        <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">{showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                      </div>
                    </Field>
                    <Field label="Confirm Password *">
                      <input className={inputCls} type={showPw ? "text" : "password"} value={form.confirm} onChange={(e) => set({ confirm: e.target.value })} autoComplete="new-password" />
                    </Field>
                  </div>
                  {form.password && form.confirm && form.password !== form.confirm && (
                    <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Passwords do not match.</p>
                  )}
                  <p className="text-xs text-gray-500">This creates the resident&apos;s self-service portal login (role: RESIDENT), scoped to their own record.</p>
                </div>
              )}

              {/* Step 2 — Personal */}
              {step === 2 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="First Name *"><input className={inputCls} value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} /></Field>
                  <Field label="Last Name *"><input className={inputCls} value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} /></Field>
                  <Field label="Date of Birth"><input type="date" className={inputCls} value={form.dateOfBirth} onChange={(e) => set({ dateOfBirth: e.target.value })} /></Field>
                  <Field label="Gender"><select className={inputCls} value={form.gender} onChange={(e) => set({ gender: e.target.value })}><option value="">—</option><option>Female</option><option>Male</option><option>Other</option></select></Field>
                  <Field label="Phone"><input className={inputCls} value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
                  <div className="hidden sm:block" />
                  <Field label="Emergency Contact"><input className={inputCls} value={form.emergencyContact} onChange={(e) => set({ emergencyContact: e.target.value })} /></Field>
                  <Field label="Emergency Phone"><input className={inputCls} value={form.emergencyContactPhone} onChange={(e) => set({ emergencyContactPhone: e.target.value })} /></Field>
                </div>
              )}

              {/* Step 3 — Facial Enrollment */}
              {step === 3 && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">Capture four facial poses for recognition enrollment. Center your face, then capture each direction.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Live camera */}
                    <div className="space-y-2">
                      <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-gray-900 border border-gray-200">
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <div className="w-40 h-52 rounded-[50%] border-2 border-white/60 border-dashed" />
                        </div>
                        {camState !== "on" && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80 bg-gray-900/80 text-sm text-center px-4">
                            {camState === "starting" ? (<><Loader2 className="w-6 h-6 animate-spin" /> Starting camera…</>) :
                             camState === "error" ? (<><VideoOff className="w-6 h-6" /> {camError}<button onClick={startCamera} className="mt-1 px-3 py-1 rounded bg-white/15 hover:bg-white/25 text-xs">Retry</button></>) :
                             (<><Video className="w-6 h-6" /> Camera off</>)}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500 inline-flex items-center gap-1">
                          {camState === "on" ? <span className="inline-flex items-center gap-1 text-green-600"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Camera live</span> : "Camera idle"}
                        </span>
                        <span className="font-semibold" style={{ color: accent }}>{facesDone}/4 captured</span>
                      </div>
                    </div>

                    {/* Pose slots */}
                    <div className="grid grid-cols-2 gap-3">
                      {DIRECTIONS.map((d) => {
                        const Icon = d.icon;
                        const shot = faces[d.key];
                        return (
                          <div key={d.key} className={`rounded-xl border p-2 flex flex-col items-center gap-1.5 ${shot ? "border-green-300 bg-green-50/50" : "border-gray-200"}`}>
                            <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                              {shot ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={shot} alt={d.label} className="w-full h-full object-cover" />
                              ) : (
                                <Icon className="w-7 h-7 text-gray-300" />
                              )}
                              {shot && <span className="absolute top-1 right-1 bg-green-500 text-white rounded-full p-0.5"><Check className="w-3 h-3" /></span>}
                            </div>
                            <span className="text-[11px] font-semibold text-gray-700">{d.label}</span>
                            <div className="flex items-center gap-1 w-full">
                              <button
                                type="button"
                                onClick={() => captureFace(d.key)}
                                disabled={camState !== "on"}
                                style={{ background: accent }}
                                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md text-white text-[11px] font-semibold hover:brightness-95 disabled:opacity-40"
                                title={camState === "on" ? d.hint : "Enable the camera first"}
                              >
                                {shot ? <RefreshCw className="w-3 h-3" /> : <Camera className="w-3 h-3" />}{shot ? "Retake" : "Capture"}
                              </button>
                              <label className="px-2 py-1 rounded-md border border-gray-300 text-gray-500 text-[11px] cursor-pointer hover:bg-gray-50" title="Upload a photo instead">
                                ⤒
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadFace(d.key, f); e.target.value = ""; }} />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4 — Medical */}
              {step === 4 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Allergies"><input className={inputCls} value={form.allergies} onChange={(e) => set({ allergies: e.target.value })} placeholder="Penicillin, none…" /></Field>
                    <Field label="Medical History"><input className={inputCls} value={form.medicalHistory} onChange={(e) => set({ medicalHistory: e.target.value })} placeholder="Hypertension, Diabetes…" /></Field>
                  </div>
                </div>
              )}

              {/* Step 5 — Care & Room */}
              {step === 5 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Care Level *"><select className={inputCls} value={form.careLevel} onChange={(e) => set({ careLevel: e.target.value })}><option value="">—</option>{CARE_LEVELS.map((c) => <option key={c} value={c}>{c[0] + c.slice(1).toLowerCase()}</option>)}</select></Field>
                    <Field label="Mobility"><input className={inputCls} value={form.mobility} onChange={(e) => set({ mobility: e.target.value })} placeholder="Independent / Walker / Wheelchair" /></Field>
                  </div>
                  {isPublic ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 flex items-center gap-2">
                      <BedDouble className="w-4 h-4" /> A room will be assigned automatically by the facility on registration.
                    </div>
                  ) : (
                    <>
                      <Field label="Room Assignment *">
                        <select className={inputCls} value={form.roomNumber} onChange={(e) => set({ roomNumber: e.target.value })}>
                          <option value="">Select an available room…</option>
                          {form.roomNumber && !availableRooms.includes(form.roomNumber) && <option value={form.roomNumber}>Room {form.roomNumber}</option>}
                          {availableRooms.map((r) => <option key={r} value={r}>Room {r}</option>)}
                        </select>
                      </Field>
                      <p className="text-xs text-gray-500">{availableRooms.length} rooms available. Occupied rooms are hidden.</p>
                    </>
                  )}
                </div>
              )}

              {/* Step 6 — Care Plan */}
              {step === 6 && (
                <div className="space-y-4">
                  <Field label="Individual Care Plan"><textarea rows={5} className={inputCls} value={form.carePlan} onChange={(e) => set({ carePlan: e.target.value })} placeholder="Daily routine, interventions, preferences…" /></Field>
                </div>
              )}

              {/* Step 7 — Review */}
              {step === 7 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <ReviewRow label="Name" value={`${form.firstName} ${form.lastName}`.trim()} />
                    <ReviewRow label="Email (login)" value={form.email} />
                    <ReviewRow label="Care Level" value={form.careLevel || "—"} />
                    <ReviewRow label="Room" value={form.roomNumber ? `Room ${form.roomNumber}` : isPublic ? "Assigned by facility" : "—"} />
                    <ReviewRow label="Date of Birth" value={form.dateOfBirth || "—"} />
                    <ReviewRow label="Phone" value={form.phone || "—"} />
                    <ReviewRow label="Allergies" value={form.allergies || "None reported"} />
                    <ReviewRow label="Mobility" value={form.mobility || "—"} />
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-gray-500 mb-1.5">Facial Enrollment ({facesDone}/4)</span>
                    <div className="flex gap-2">
                      {DIRECTIONS.map((d) => (
                        <div key={d.key} className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center">
                          {faces[d.key] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={faces[d.key]} alt={d.label} className="w-full h-full object-cover" />
                          ) : <d.icon className="w-5 h-5 text-gray-300" />}
                        </div>
                      ))}
                    </div>
                  </div>
                  {missing.length > 0 ? (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Before registering, provide: <b>{missing.join(", ")}</b>.</div>
                  ) : (
                    <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">Ready — this creates the resident login, the care record, and stores the 4 facial poses in Supabase.</div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-gray-50">
              <button onClick={() => setStep((n) => Math.max(1, n - 1))} disabled={step === 1} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-gray-700 hover:bg-gray-100 disabled:opacity-40 text-sm font-medium"><ChevronLeft className="w-4 h-4" /> Back</button>
              {step < STEP_COUNT ? (
                <button onClick={next} disabled={!!stepError(step)} title={stepError(step) ?? ""} style={{ background: accent }} className="inline-flex items-center gap-1 px-5 py-2 rounded-lg text-white font-semibold hover:brightness-95 text-sm disabled:opacity-50 disabled:cursor-not-allowed">Continue <ChevronRight className="w-4 h-4" /></button>
              ) : (
                <button onClick={register} disabled={saving || missing.length > 0} title={missing.length ? `Missing: ${missing.join(", ")}` : ""} className="inline-flex items-center gap-1 px-5 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 text-sm disabled:opacity-50">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Registering…</> : <><CheckCircle2 className="w-4 h-4" /> Register Resident</>}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "gray" | "amber" | "green" }) {
  const tones: Record<string, string> = { gray: "text-gray-700", amber: "text-amber-600", green: "text-green-600" };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tones[tone]}`}>{value}</p>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-100 px-3 py-2">
      <span className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  );
}
