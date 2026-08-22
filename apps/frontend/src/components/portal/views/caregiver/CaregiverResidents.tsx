"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Search, UserRound, Camera, ArrowUpRight, Phone, HeartPulse,
  AlertTriangle, Pill, Clock, CheckCircle2, X, QrCode, Loader2,
  RefreshCw, ShieldCheck, Activity,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { updateRecord } from "@/lib/api";
import { humanize } from "@/lib/adapters";
import ResidentQRModal from "@/components/ResidentQRModal";

/* ── Types ───────────────────────────────────────────────────────────── */

type CareLevel = "INDEPENDENT" | "ASSISTED" | "MEMORY" | "SKILLED";

interface AssignedResident {
  id: string;
  firstName: string;
  lastName: string;
  roomNumber: string | null;
  careLevel: CareLevel;
  careDependencyLevel: string | null;
  allergies: string | null;
  dietRestriction: string | null;
  codeStatus: string | null;
  notes: string | null;
  photoUrl: string | null;
  medicalHistory: string | null;
}

interface CallBellVM {
  id: string;
  status: string;
  reason: string | null;
  createdAt: string | null;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const CARE_BADGE: Record<CareLevel, string> = {
  INDEPENDENT: "bg-green-100 text-green-800 border-green-200",
  ASSISTED: "bg-blue-100 text-blue-800 border-blue-200",
  MEMORY: "bg-purple-100 text-purple-800 border-purple-200",
  SKILLED: "bg-red-100 text-red-800 border-red-200",
};

const CARE_DOT: Record<CareLevel, string> = {
  INDEPENDENT: "bg-green-500",
  ASSISTED: "bg-blue-500",
  MEMORY: "bg-purple-500",
  SKILLED: "bg-red-500",
};

function relTime(iso: string | null, nowTs: number): string {
  if (!iso || !nowTs) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ── Component ───────────────────────────────────────────────────────── */

export default function CaregiverResidents() {
  const router = useRouter();

  // Fetch only the residents assigned to this caregiver
  const [assignedResidents, setAssignedResidents] = useState<AssignedResident[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAssigned = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/caregiver/my-residents", { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to load assigned residents.");
      setAssignedResidents(body.residents ?? []);
      setAssignedIds(body.assignedIds ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load residents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAssigned();
  }, [fetchAssigned]);

  // Call bells for assigned residents
  const { data: callBellRows, refetch: refetchCallBells } = useLiveQuery<Record<string, unknown>>(
    "call-bells",
    { query: "include=resident&take=300", tables: ["CallBell"] }
  );

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const [search, setSearch] = useState("");
  const [viewingResident, setViewingResident] = useState<AssignedResident | null>(null);
  const [qrResident, setQrResident] = useState<{ id: string; name: string; room: string } | null>(null);

  // Index call bells by resident
  const bellIndex = useMemo(() => {
    const byId = new Map<string, CallBellVM[]>();
    callBellRows.forEach((row) => {
      const rid = row.residentId ? String(row.residentId) : null;
      if (!rid) return;
      const bell: CallBellVM = {
        id: String(row.id),
        status: String(row.status || ""),
        reason: row.reason ? String(row.reason) : null,
        createdAt: row.createdAt ? String(row.createdAt) : null,
      };
      const arr = byId.get(rid);
      if (arr) arr.push(bell); else byId.set(rid, [bell]);
    });
    return byId;
  }, [callBellRows]);

  // Filter by search
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assignedResidents;
    return assignedResidents.filter((r) => {
      const name = `${r.firstName} ${r.lastName}`.toLowerCase();
      const room = (r.roomNumber || "").toLowerCase();
      return name.includes(q) || room.includes(q);
    });
  }, [assignedResidents, search]);

  const openBells = useCallback((residentId: string) => {
    return (bellIndex.get(residentId) ?? []).filter(
      (b) => b.status !== "RESOLVED" && b.status !== "CANCELLED"
    );
  }, [bellIndex]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2.5">
            <Users className="w-6 h-6 text-blue-600" /> My Assigned Residents
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {assignedIds.length > 0
              ? `${assignedIds.length} resident${assignedIds.length === 1 ? "" : "s"} assigned to your shift`
              : "No residents assigned — check your shift roster."}
          </p>
        </div>
        <button
          onClick={() => void fetchAssigned()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or room…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Loader2 className="w-6 h-6 text-gray-400 animate-spin mx-auto" />
          <p className="mt-3 text-sm text-gray-500">Loading your assigned residents…</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-xl border border-red-200 p-10 text-center text-red-600 text-sm">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <UserRound className="w-10 h-10 text-gray-300 mx-auto" />
          <p className="mt-3 text-sm font-medium text-gray-700">
            {assignedIds.length === 0 ? "No residents assigned to your shift" : "No residents match your search"}
          </p>
          {assignedIds.length === 0 && (
            <p className="mt-1 text-xs text-gray-500">Ask your nurse or care manager to update the shift roster.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const bells = openBells(r.id);
            const name = `${r.firstName} ${r.lastName}`;
            return (
              <div
                key={r.id}
                className="bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all p-4"
              >
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  {r.photoUrl ? (
                    <img
                      src={r.photoUrl}
                      alt=""
                      className="w-12 h-12 rounded-full object-cover ring-2 ring-gray-100 shrink-0"
                    />
                  ) : (
                    <span className="w-12 h-12 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center text-sm font-bold text-blue-600 shrink-0">
                      {r.firstName?.[0]}{r.lastName?.[0]}
                    </span>
                  )}

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <h3 className="font-semibold text-gray-900">{name}</h3>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${CARE_BADGE[r.careLevel] || "bg-gray-100 text-gray-700 border-gray-200"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${CARE_DOT[r.careLevel] || "bg-gray-400"}`} />
                        {humanize(r.careLevel)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Room {r.roomNumber || "—"}
                      {r.careDependencyLevel ? ` · ${humanize(r.careDependencyLevel)}` : ""}
                    </p>
                    {(r.allergies || r.codeStatus || r.dietRestriction) && (
                      <p className="text-xs text-gray-400 mt-1 truncate max-w-lg">
                        {r.allergies && <span className="text-red-500">⚠ {r.allergies}</span>}
                        {r.allergies && r.codeStatus && " · "}
                        {r.codeStatus && <span>Code: {humanize(r.codeStatus)}</span>}
                        {r.dietRestriction && <span>{r.allergies || r.codeStatus ? " · " : ""}Diet: {r.dietRestriction}</span>}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {bells.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-500 text-white rounded-lg text-xs font-semibold">
                        <Phone className="w-3 h-3" /> {bells.length}
                      </span>
                    )}
                    <button
                      onClick={() => setViewingResident(r)}
                      className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 transition border border-blue-200"
                    >
                      View
                    </button>
                    <button
                      onClick={() => router.push(`/caregiver/monitoring?resident=${encodeURIComponent(name)}&room=${encodeURIComponent(r.roomNumber || "")}&residentId=${encodeURIComponent(r.id)}`)}
                      className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition border border-emerald-200"
                      title="Open camera monitoring"
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setQrResident({ id: r.id, name, room: r.roomNumber || "" })}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition"
                      title="Show QR care card"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      {viewingResident && (
        <ResidentDetailModal
          r={viewingResident}
          bells={openBells(viewingResident.id)}
          onClose={() => setViewingResident(null)}
          refetchBells={refetchCallBells}
          router={router}
        />
      )}

      <ResidentQRModal
        open={!!qrResident}
        onClose={() => setQrResident(null)}
        residentId={qrResident?.id ?? ""}
        name={qrResident?.name ?? ""}
        room={qrResident?.room}
      />
    </div>
  );
}

/* ── Detail modal ────────────────────────────────────────────────────── */

function ResidentDetailModal({
  r,
  bells,
  onClose,
  refetchBells,
  router,
}: {
  r: AssignedResident;
  bells: CallBellVM[];
  onClose: () => void;
  refetchBells: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const name = `${r.firstName} ${r.lastName}`;
  const [resolveForId, setResolveForId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [resolveBusy, setResolveBusy] = useState(false);

  const submitResolve = async () => {
    if (!resolveForId) return;
    setResolveBusy(true);
    try {
      await updateRecord("call-bells", resolveForId, {
        status: "RESOLVED",
        resolvedAt: new Date().toISOString(),
        notes: resolveNotes.trim() || "Resolved",
      });
      refetchBells();
      setResolveForId(null);
      Swal.fire({ title: "Resolved", text: "Call bell marked as resolved", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ title: "Error", text: e instanceof Error ? e.message : "Failed", icon: "error" });
    } finally {
      setResolveBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white p-5 sm:p-6 flex items-center justify-between z-10">
          <div className="flex items-center gap-3 min-w-0">
            {r.photoUrl ? (
              <img src={r.photoUrl} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-white/30 shrink-0" />
            ) : (
              <span className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-lg font-bold shrink-0">
                {r.firstName?.[0]}{r.lastName?.[0]}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-xl font-bold truncate">{name}</h2>
              <p className="text-blue-100 text-sm">Room {r.roomNumber || "—"} · {humanize(r.careLevel)}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Quick Info */}
          <div className="grid grid-cols-2 gap-3">
            {r.careDependencyLevel && (
              <InfoPill icon={Activity} label="Assistance" value={humanize(r.careDependencyLevel)} />
            )}
            {r.codeStatus && (
              <InfoPill icon={ShieldCheck} label="Code Status" value={humanize(r.codeStatus)} />
            )}
            {r.dietRestriction && (
              <InfoPill icon={Pill} label="Diet" value={r.dietRestriction} />
            )}
          </div>

          {/* Allergies */}
          {r.allergies && (
            <div className="bg-red-50 border-l-4 border-red-400 p-3 rounded-r-lg">
              <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Allergies
              </p>
              <p className="text-sm text-red-900 mt-1">{r.allergies}</p>
            </div>
          )}

          {/* Care Notes */}
          {r.notes && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded-r-lg">
              <p className="text-sm font-semibold text-yellow-700">Care Notes</p>
              <p className="text-sm text-yellow-900 mt-1">{r.notes}</p>
            </div>
          )}

          {/* Conditions */}
          {r.medicalHistory && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Conditions</h3>
              <div className="flex flex-wrap gap-1.5">
                {r.medicalHistory.split(",").map((c) => c.trim()).filter(Boolean).map((c, i) => (
                  <span key={i} className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-full text-xs font-medium">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Call Bells */}
          {bells.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                <Phone className="w-4 h-4 text-orange-500" /> Active Call Bells ({bells.length})
              </h3>
              <div className="space-y-2">
                {bells.map((bell) => (
                  <div key={bell.id} className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{bell.reason || "Call bell"}</p>
                        {bell.createdAt && (
                          <p className="text-xs text-gray-500 mt-0.5">{relTime(bell.createdAt, Date.now())}</p>
                        )}
                      </div>
                      <button
                        onClick={() => { setResolveNotes(""); setResolveForId(bell.id); }}
                        className="px-2.5 py-1 bg-green-500 text-white rounded text-xs font-semibold hover:bg-green-600 transition"
                      >
                        Resolve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-5 sm:px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => {
              onClose();
              router.push(`/caregiver/monitoring?resident=${encodeURIComponent(name)}&room=${encodeURIComponent(r.roomNumber || "")}&residentId=${encodeURIComponent(r.id)}`);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white font-semibold rounded-lg hover:bg-emerald-600 transition text-sm"
          >
            <Camera className="w-4 h-4" /> Camera Monitoring
          </button>
          <button onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition text-sm font-medium">
            Close
          </button>
        </div>
      </div>

      {/* Resolve modal */}
      {resolveForId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setResolveForId(null); }}>
          <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-green-600 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Resolve Call Bell</h3>
              <button onClick={() => setResolveForId(null)} className="p-1 hover:bg-white/20 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-500">{name} · Room {r.roomNumber}</p>
              <textarea
                autoFocus
                rows={3}
                value={resolveNotes}
                onChange={(e) => setResolveNotes(e.target.value)}
                placeholder="What was done…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none resize-y"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
              <button onClick={() => setResolveForId(null)} disabled={resolveBusy} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => void submitResolve()} disabled={resolveBusy} className="inline-flex items-center gap-2 px-5 py-2 bg-green-500 text-white font-semibold rounded-lg text-sm hover:bg-green-600 transition disabled:opacity-50">
                {resolveBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {resolveBusy ? "Resolving…" : "Resolve"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoPill({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 p-2.5 bg-gray-50 border border-gray-200 rounded-lg">
      <Icon className="w-4 h-4 text-gray-400 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-900 truncate">{value}</p>
      </div>
    </div>
  );
}
