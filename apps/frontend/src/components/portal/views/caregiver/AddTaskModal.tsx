"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Plus, ClipboardList } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord } from "@/lib/api";

type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

// Roles allowed to delegate a task to another staff member (a supervisor).
// Exported so the Task Checklist can gate the "Assign Task" button to the same
// set — head nurse / supervisors see it, caregivers do not.
export const SUPERVISOR_ROLES = new Set([
  "NURSE", "FACILITY_ADMIN", "PHYSICIAN", "SUPERADMIN", "ORGANIZATION_ADMIN",
]);

type StaffRow = { id: string; userId?: string; user?: { name?: string; role?: string } };

/** Shared create-task dialog. Caregivers self-create; supervisors delegate to a caregiver. */
export default function AddTaskModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "take=300", tables: ["Resident"] }
  );
  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);

  // Staff directory (with linked user for name + role) powers the assignee picker.
  const { data: staffRows } = useLiveQuery<StaffRow>(
    "staff", { query: "include=user&take=300", tables: ["Staff"] }
  );

  // Current session — decides whether the assignee picker is shown and who is recorded as creator.
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data?.authenticated) {
          setSessionUserId(data.session?.userId ?? null);
          setSessionRole(data.session?.role ?? null);
        }
      })
      .catch(() => { /* Non-fatal: falls back to self-created task. */ });
  }, []);

  const isSupervisor = sessionRole ? SUPERVISOR_ROLES.has(sessionRole) : false;
  const myStaffId = useMemo(
    () => staffRows.find((s) => s.userId === sessionUserId)?.id ?? null,
    [staffRows, sessionUserId]
  );
  const caregiverStaff = useMemo(
    () => staffRows.filter((s) => s.user?.role === "CAREGIVER"),
    [staffRows]
  );

  const [assigneeId, setAssigneeId] = useState("");
  const [residentId, setResidentId] = useState("");
  const [category, setCategory] = useState("Personal Care");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [saving, setSaving] = useState(false);

  // Supervisors must pick a caregiver; caregivers self-assign implicitly.
  const valid = residentId && title.trim() && dueDate && (!isSupervisor || assigneeId);
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      // Supervisor delegates to the chosen caregiver; a caregiver's own task is self-assigned.
      const assignedToId = isSupervisor ? assigneeId : (myStaffId || null);
      await createRecord("tasks", {
        residentId,
        title: title.trim(),
        description: description.trim() || null,
        category,
        priority,
        status: "PENDING",
        dueDate: new Date(dueDate).toISOString(),
        assignedToId,
        createdById: myStaffId,
      });
      Swal.fire({ title: "Task Added", icon: "success", timer: 1300, showConfirmButton: false });
      onSaved();
    } catch (err) {
      setSaving(false);
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not add task.", icon: "error" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold flex items-center gap-2"><ClipboardList className="w-5 h-5" /> New Task</h2>
          <button onClick={onClose} className="p-2 hover:bg-black/10 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Resident <span className="text-red-500">*</span></label>
              <select value={residentId} onChange={(e) => setResidentId(e.target.value)} className={inputCls}>
                <option value="">Select resident…</option>
                {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
              </select>
            </div>
            {isSupervisor && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Assign to Caregiver <span className="text-red-500">*</span></label>
                <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputCls}>
                  <option value="">Select caregiver…</option>
                  {caregiverStaff.map((c) => <option key={c.id} value={c.id}>{c.user?.name ?? "Caregiver"}</option>)}
                </select>
                {caregiverStaff.length === 0 && <p className="mt-1 text-xs text-gray-500">No caregivers found in this community.</p>}
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Task Title <span className="text-red-500">*</span></label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Assist with breakfast" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Details, precautions…" className={`${inputCls} resize-y`} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                {["Personal Care", "Hygiene", "Medication", "Mobility", "Nutrition", "Observation"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Priority</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={inputCls}>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Due <span className="text-red-500">*</span></label>
                <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
            <button type="button" onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
            <button type="submit" disabled={!valid || saving}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
              <Plus className="w-4 h-4" /> {saving ? "Saving…" : "Add Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
