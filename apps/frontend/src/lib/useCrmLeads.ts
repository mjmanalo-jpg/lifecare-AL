"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, createRecord } from "@/lib/api";
import {
  CRM_LEADS_KEY, STAGE_META, parseLeads, newId,
  type Lead, type LeadStage, type LeadTask, type LeadActivity, type ActivityType, type TaskType,
} from "@/lib/crmLeads";
import { composeName, nameParts } from "@/lib/names";

type SettingRow = { id: string; key?: string; value: string };
export type Admission = { id: string; status?: string; currentStep?: number; roomNumber?: string };

const stamp = (by: string, note: string, type: ActivityType): LeadActivity => ({ at: new Date().toISOString(), by, note, type });

/**
 * Single source of truth for the CRM. Reads the community-scoped `crm_leads`
 * app-setting and exposes every mutation the pipeline / drawer / follow-ups /
 * tours / analytics views share, so they never drift or duplicate persistence.
 */
export function useCrmLeads() {
  const { data: settingRows, refetch } = useLiveQuery<SettingRow>("app-settings", { tables: ["AppSetting"] });
  const leads = useMemo(() => parseLeads(settingRows.find((r) => (r.key || r.id) === CRM_LEADS_KEY)?.value), [settingRows]);

  const { data: admissionRows } = useLiveQuery<Admission>("admissions", { query: "take=500", tables: ["Admission"] });
  const admissionById = useMemo(() => new Map(admissionRows.map((a) => [a.id, a])), [admissionRows]);

  const [me, setMe] = useState("Staff");
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => setMe(d?.session?.name || d?.workspaces?.user?.name || "Staff")).catch(() => {}); }, []);

  const persist = useCallback(async (next: Lead[]) => {
    await upsertRecord("app-settings", CRM_LEADS_KEY, { key: CRM_LEADS_KEY, value: JSON.stringify(next) });
    await refetch();
  }, [refetch]);

  // Apply a patch to one lead, optionally appending an activity entry.
  const mutate = useCallback((id: string, patch: Partial<Lead>, activity?: LeadActivity) =>
    persist(leads.map((l) => (l.id === id ? { ...l, ...patch, activity: activity ? [...(l.activity ?? []), activity] : l.activity } : l))),
    [leads, persist]);

  const addLead = useCallback(async (draft: Omit<Lead, "id" | "createdAt" | "activity">) => {
    const lead: Lead = { ...draft, id: newId(), createdAt: new Date().toISOString(), activity: [stamp(me, "Lead created", "system")] };
    await persist([lead, ...leads]);
    return lead;
  }, [leads, persist, me]);

  const updateLead = useCallback((id: string, patch: Partial<Lead>) => mutate(id, patch), [mutate]);
  const deleteLead = useCallback((id: string) => persist(leads.filter((l) => l.id !== id)), [leads, persist]);

  // Create the Admission (move-in) from a lead. Shared by explicit Convert and
  // the auto-convert when a lead reaches Move-In.
  const createAdmissionForLead = useCallback(async (lead: Lead): Promise<string | undefined> => {
    const p = nameParts({ firstName: lead.residentFirstName, middleName: lead.residentMiddleName, lastName: lead.residentLastName, name: lead.prospectiveResident || lead.name });
    const res = await createRecord("admissions", {
      firstName: composeName(p.firstName, p.middleName) || lead.name, lastName: p.lastName || "—",
      phone: lead.contact || null, email: lead.email || null,
      status: "IN_PROGRESS", currentStep: 1, completedSteps: "[]",
      sponsorName: lead.name, sponsorEmail: lead.email || null,
    });
    return (res.data as { id?: string })?.id;
  }, []);

  const moveStage = useCallback(async (lead: Lead, stage: LeadStage, lostReason?: string) => {
    let convertedAdmissionId = lead.convertedAdmissionId;
    let note = `Moved to ${STAGE_META[stage].label}`;
    let madeAdmission = false;
    if (stage === "MOVE_IN" && !convertedAdmissionId) {
      try { convertedAdmissionId = await createAdmissionForLead(lead); note = "Moved to Move-In (Won) — admission created"; madeAdmission = true; } catch { /* still advance */ }
    }
    const patch: Partial<Lead> = { stage, convertedAdmissionId };
    if (stage === "LOST" && lostReason) patch.lostReason = lostReason;
    await mutate(lead.id, patch, stamp(me, lostReason ? `${note} — ${lostReason}` : note, "stage"));
    return madeAdmission;
  }, [mutate, me, createAdmissionForLead]);

  const convert = useCallback(async (lead: Lead) => {
    const admissionId = await createAdmissionForLead(lead);
    await mutate(lead.id, { stage: "MOVE_IN", convertedAdmissionId: admissionId }, stamp(me, "Converted to admission", "stage"));
    return admissionId;
  }, [mutate, me, createAdmissionForLead]);

  const logActivity = useCallback((leadId: string, note: string, type: ActivityType = "note") =>
    mutate(leadId, {}, stamp(me, note, type)), [mutate, me]);

  const addTask = useCallback((leadId: string, t: { title: string; type: TaskType; dueDate: string }) => {
    const lead = leads.find((l) => l.id === leadId); if (!lead) return Promise.resolve();
    const task: LeadTask = { id: newId("task"), title: t.title, type: t.type, dueDate: t.dueDate, done: false, by: me };
    return mutate(leadId, { tasks: [...(lead.tasks ?? []), task] }, stamp(me, `Task added: ${t.title}`, "task"));
  }, [leads, mutate, me]);

  const toggleTask = useCallback((leadId: string, taskId: string) => {
    const lead = leads.find((l) => l.id === leadId); if (!lead) return Promise.resolve();
    const tasks = (lead.tasks ?? []).map((t) => t.id === taskId ? { ...t, done: !t.done, doneAt: !t.done ? new Date().toISOString() : undefined } : t);
    const t = tasks.find((x) => x.id === taskId);
    return mutate(leadId, { tasks }, t?.done ? stamp(me, `Task done: ${t.title}`, "task") : undefined);
  }, [leads, mutate, me]);

  const rescheduleTask = useCallback((leadId: string, taskId: string, dueDate: string) => {
    const lead = leads.find((l) => l.id === leadId); if (!lead) return Promise.resolve();
    return mutate(leadId, { tasks: (lead.tasks ?? []).map((t) => t.id === taskId ? { ...t, dueDate } : t) });
  }, [leads, mutate]);

  const setTour = useCallback((leadId: string, tourDate: string) =>
    mutate(leadId, { tourDate, tourOutcome: "" }, stamp(me, tourDate ? `Tour scheduled ${new Date(tourDate).toLocaleString()}` : "Tour cleared", "tour")), [mutate, me]);

  const setTourOutcome = useCallback((leadId: string, outcome: NonNullable<Lead["tourOutcome"]>, tourNotes?: string) =>
    mutate(leadId, { tourOutcome: outcome, tourNotes }, stamp(me, `Tour ${outcome.replace("_", " ")}`, "tour")), [mutate, me]);

  return {
    leads, admissionById, me, persist,
    addLead, updateLead, deleteLead, moveStage, convert,
    logActivity, addTask, toggleTask, rescheduleTask, setTour, setTourOutcome,
  };
}

export type CrmApi = ReturnType<typeof useCrmLeads>;
