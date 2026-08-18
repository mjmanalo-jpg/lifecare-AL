"use client";

/**
 * Geofencing (tab `geofencing`, Super Admin) — define one or more facility
 * locations staff must be inside to clock in. Each location is a two-column row:
 * the Location (label + coordinates + radius) and its Assigned staff. Applied to
 * every nurse & caregiver time-in. Migration-free: app-setting `geofence_config`.
 */

import { useEffect, useMemo, useState } from "react";
import { MapPin, LocateFixed, Loader2, ShieldCheck, Users, Search, Plus, Trash2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalCard, FieldLabel, controlClass, SERIF } from "./clinical-ui";
import { GEOFENCE_KEY, parseGeofence, getCurrentPosition, newLocation, hasCoords, type GeofenceLocation } from "@/lib/geofence";

type StaffRow = { id: string; userId?: string; user?: { name?: string; role?: string } };
const s = (v: unknown) => (v == null ? "" : String(v));
const roleLabel = (r: string) => (r === "CAREGIVER" ? "Caregiver" : r === "NURSE" ? "Nurse" : r.replace(/_/g, " "));

export default function GeofenceSettingsBoard() {
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const staffQ = useLiveQuery<StaffRow>("staff", { query: "include=user&take=300", tables: ["Staff", "User"] });
  const saved = useMemo(() => parseGeofence(settingRows.find((r) => s(r.key || r.id) === GEOFENCE_KEY)?.value), [settingRows]);

  const people = useMemo(() => (staffQ.data || [])
    .filter((st) => st.user?.role === "NURSE" || st.user?.role === "CAREGIVER")
    .map((st) => ({ userId: s(st.userId), name: s(st.user?.name) || "Staff", role: s(st.user?.role) }))
    .filter((p) => p.userId), [staffQ.data]);

  const [enabled, setEnabled] = useState(saved.enabled);
  const [locations, setLocations] = useState<GeofenceLocation[]>(saved.locations);
  const [staffSearch, setStaffSearch] = useState("");
  const [locatingId, setLocatingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate once the saved config lands (deferred write → render-pure, lint-clean).
  useEffect(() => {
    if (hydrated || settingRows.length === 0) return;
    void Promise.resolve().then(() => { setEnabled(saved.enabled); setLocations(saved.locations); setHydrated(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingRows.length]);

  const updateLoc = (id: string, patch: Partial<GeofenceLocation>) => setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLoc = () => setLocations((prev) => [...prev, newLocation()]);
  const removeLoc = (id: string) => setLocations((prev) => prev.filter((l) => l.id !== id));
  const toggleStaff = (id: string, userId: string) => setLocations((prev) => prev.map((l) => l.id === id ? { ...l, assignedUserIds: l.assignedUserIds.includes(userId) ? l.assignedUserIds.filter((x) => x !== userId) : [...l.assignedUserIds, userId] } : l));

  const captureLocation = async (id: string) => {
    setLocatingId(id);
    try {
      const pos = await getCurrentPosition();
      updateLoc(id, { latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) });
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Location captured", showConfirmButton: false, timer: 1500 });
    } catch (e) {
      Swal.fire("Couldn't get location", e instanceof Error ? e.message : "Enable location access and retry.", "warning");
    } finally { setLocatingId(""); }
  };

  const save = async () => {
    // Drop empty rows (no label, no coords, no staff).
    const clean = locations.filter((l) => l.label.trim() || hasCoords(l) || l.assignedUserIds.length);
    if (enabled && !clean.some(hasCoords)) {
      Swal.fire("Set a location", "Add at least one location with coordinates before enabling the geofence (or turn off enforcement).", "warning"); return;
    }
    setSaving(true);
    try {
      await upsertRecord("app-settings", GEOFENCE_KEY, { key: GEOFENCE_KEY, value: JSON.stringify({ enabled, locations: clean }) });
      await refetch();
      setLocations(clean);
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Geofence saved", showConfirmButton: false, timer: 1600 });
    } catch (e) { Swal.fire("Save failed", e instanceof Error ? e.message : "", "error"); }
    finally { setSaving(false); }
  };

  const sq = staffSearch.trim().toLowerCase();
  const staffShown = people.filter((p) => !sq || p.name.toLowerCase().includes(sq));

  return (
    <ClinicalPage>
      <ClinicalHeader title="Geofencing" subtitle="Define the facility locations staff must be inside to clock in. Each location has its own radius and assigned staff." />

      <div className="mt-5 space-y-4">
        <ClinicalCard className="p-5">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300 text-[var(--clinical-panel)] focus:ring-[var(--clinical-panel)]/40" />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--clinical-ink)]"><ShieldCheck className="h-4 w-4 text-[var(--clinical-panel)]" /> Enforce geofence at clock-in</span>
              <span className="mt-0.5 block text-xs text-[var(--clinical-muted)]">When on, staff outside every location that governs them are blocked from clocking in. When off, clock-in still requires a face match but not location.</span>
            </span>
          </label>
        </ClinicalCard>

        {locations.length === 0 && (
          <ClinicalCard className="p-8 text-center">
            <MapPin className="mx-auto h-8 w-8 text-[var(--clinical-muted)]" />
            <p className="mt-2 text-sm font-semibold text-[var(--clinical-ink)]">No locations yet</p>
            <p className="text-xs text-[var(--clinical-muted)]">Add a facility location and assign the staff who clock in there.</p>
          </ClinicalCard>
        )}

        {locations.map((loc, idx) => (
          <ClinicalCard key={loc.id} className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{loc.label.trim() || `Location ${idx + 1}`}</p>
              <button type="button" onClick={() => removeLoc(loc.id)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--clinical-coral)] hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Remove</button>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Col 1 — Location */}
              <div className="space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--clinical-muted)]"><span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Location</span></p>
                <div><FieldLabel>Facility label</FieldLabel><input value={loc.label} onChange={(e) => updateLoc(loc.id, { label: e.target.value })} placeholder="e.g., LifeCare Living — Pasig" className={controlClass} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><FieldLabel>Latitude</FieldLabel><input value={loc.latitude || ""} onChange={(e) => updateLoc(loc.id, { latitude: Number(e.target.value.replace(/[^0-9.\-]/g, "")) || 0 })} inputMode="decimal" placeholder="14.5764" className={controlClass} /></div>
                  <div><FieldLabel>Longitude</FieldLabel><input value={loc.longitude || ""} onChange={(e) => updateLoc(loc.id, { longitude: Number(e.target.value.replace(/[^0-9.\-]/g, "")) || 0 })} inputMode="decimal" placeholder="121.0851" className={controlClass} /></div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <ClinicalButton variant="secondary" size="sm" onClick={() => captureLocation(loc.id)} disabled={locatingId === loc.id}>{locatingId === loc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />} Use my current location</ClinicalButton>
                  {hasCoords(loc) && <a href={`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--clinical-panel)] hover:underline"><MapPin className="h-3.5 w-3.5" /> Preview</a>}
                </div>
                <div className="max-w-[12rem]"><FieldLabel>Radius (metres)</FieldLabel><input value={loc.radiusMeters || ""} onChange={(e) => updateLoc(loc.id, { radiusMeters: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })} inputMode="numeric" placeholder="150" className={controlClass} /></div>
              </div>

              {/* Col 2 — Assigned staff */}
              <div className="space-y-2 lg:border-l lg:pl-6" style={{ borderColor: "var(--clinical-line)" }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--clinical-muted)]"><span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Assigned staff</span></p>
                <p className="text-xs text-[var(--clinical-muted)]">Pick who clocks in here. <b>Leave unchecked to apply to everyone.</b></p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--clinical-muted)]" />
                  <input value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)} placeholder="Search staff…" className={`${controlClass} pl-9`} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--clinical-ink-soft)]">{loc.assignedUserIds.length ? `${loc.assignedUserIds.length} assigned` : "Everyone"}</span>
                  {loc.assignedUserIds.length > 0 && <button type="button" onClick={() => updateLoc(loc.id, { assignedUserIds: [] })} className="font-semibold text-[var(--clinical-panel)] hover:underline">Clear</button>}
                </div>
                <div className="max-h-56 space-y-1 overflow-auto rounded-xl border p-1" style={{ borderColor: "var(--clinical-line)" }}>
                  {staffShown.length === 0 ? (
                    <p className="p-3 text-center text-xs text-[var(--clinical-muted)]">{staffQ.loading ? "Loading staff…" : "No nurses or caregivers found."}</p>
                  ) : staffShown.map((p) => {
                    const on = loc.assignedUserIds.includes(p.userId);
                    return (
                      <label key={p.userId} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-[var(--clinical-surface-2)]">
                        <input type="checkbox" checked={on} onChange={() => toggleStaff(loc.id, p.userId)} className="h-4 w-4 rounded border-slate-300 text-[var(--clinical-panel)] focus:ring-[var(--clinical-panel)]/40" />
                        <span className="text-sm font-medium text-[var(--clinical-ink)]">{p.name}</span>
                        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{roleLabel(p.role)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </ClinicalCard>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ClinicalButton variant="secondary" onClick={addLoc}><Plus className="h-4 w-4" /> Add location</ClinicalButton>
          <ClinicalButton variant="accent" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save geofence"}</ClinicalButton>
        </div>
      </div>
    </ClinicalPage>
  );
}
