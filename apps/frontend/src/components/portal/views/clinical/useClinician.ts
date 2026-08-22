"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "@/lib/useLiveQuery";

/**
 * Resolves the signed-in clinician's display identity (name + linked User id)
 * for the two clinical portals. Physician and Head Nurse portals share the same
 * clinical modules; this keeps note authorship and message sender attribution
 * correct for whichever role is viewing.
 *
 * Resolution order:
 *   1. Staff record whose position matches the role (gives the titled clinician,
 *      e.g. "Head Nurse Sarah Jenkins").
 *   2. Fallback to any active User with the matching role — this covers roles
 *      that have a login account but no Staff record (e.g. the physician), so
 *      messaging always has a valid senderId (User FK) instead of failing with
 *      "No linked account".
 */

export type ClinicianRole = "PHYSICIAN" | "NURSE" | "CAREGIVER" | "CARE_MANAGER" | "FACILITY_ADMIN";

export interface Clinician {
  name: string;
  userId: string;
  /** The current user's Staff id (Task.assignedToId FK), when they have a Staff record. */
  staffId: string;
  role: ClinicianRole;
  /**
   * True once the /api/auth/session lookup has settled (resolved or failed), so
   * `userId` reflects the real signed-in user rather than the transient role
   * fallback. Callers that gate on identity (e.g. the clock-in guard) must wait
   * for this before acting, or they'll act on the wrong id mid-load.
   */
  ready: boolean;
}

const matchesRole = (position: string, role: ClinicianRole) => {
  const pos = position.toUpperCase();
  if (role === "PHYSICIAN") return pos.includes("PHYSICIAN") || pos.includes("DOCTOR");
  if (role === "NURSE") return pos.includes("NURSE");
  if (role === "CAREGIVER") return pos.includes("CAREGIVER") || pos.includes("AIDE");
  if (role === "CARE_MANAGER") return pos.includes("CARE MANAGER") || pos.includes("CLINICAL MANAGER");
  return pos.includes("ADMIN") || pos.includes("FACILITY"); // FACILITY_ADMIN
};

const FALLBACK: Record<ClinicianRole, string> = {
  PHYSICIAN: "Physician", NURSE: "Head Nurse", CAREGIVER: "Caregiver", CARE_MANAGER: "Care Manager", FACILITY_ADMIN: "Facility Admin",
};

const displayName = (u: Record<string, unknown>, fallback: string) => {
  const composed = `${String(u.firstName ?? "")} ${String(u.lastName ?? "")}`.trim();
  return String(u.name ?? "").trim() || composed || fallback;
};

export function useClinician(role: ClinicianRole): Clinician {
  const { data: staffRows } = useLiveQuery<Record<string, unknown>>("staff", {
    query: "include=user",
    tables: ["Staff"],
  });
  const { data: userRows } = useLiveQuery<Record<string, unknown>>("users", {
    query: "take=200",
    tables: ["User"],
  });

  // The ACTUAL signed-in user (enriched /api/auth/session exposes their real name
  // + linked User id). This is the source of truth for authorship, so an action
  // is attributed to the person who logged it — e.g. "Grace Villanueva" — instead
  // of a role-matched placeholder account like "…Organization Admin".
  const [sessionUser, setSessionUser] = useState<{ name: string; userId: string } | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d?.authenticated) return;
        const name = String(d.session?.name ?? "").trim();
        const userId = String(d.session?.userId ?? "");
        if (name || userId) setSessionUser({ name, userId });
      })
      .catch(() => { /* non-fatal: fall back to role-based resolution */ })
      .finally(() => { if (alive) setSessionChecked(true); });
    return () => { alive = false; };
  }, []);

  return useMemo(() => {
    const fallback = FALLBACK[role];

    // Role-based resolution — used to supply a linked User id when the session
    // doesn't carry one, and as the name fallback before the session lands.
    let resolvedName = fallback;
    let resolvedUserId = "";
    const staffMatch = staffRows.find((s) => matchesRole(String((s as { position?: unknown }).position ?? ""), role));
    const staffUser = (staffMatch as { user?: Record<string, unknown> } | undefined)?.user;
    if (staffUser?.id) {
      resolvedName = displayName(staffUser, fallback);
      resolvedUserId = String(staffUser.id);
    } else {
      const userMatch =
        userRows.find((u) => String(u.role) === role && u.isActive !== false) ??
        userRows.find((u) => String(u.role) === role);
      if (userMatch?.id) {
        resolvedName = displayName(userMatch, fallback);
        resolvedUserId = String(userMatch.id);
      }
    }

    // The signed-in user's Staff id (for task assignment): match their User id
    // against the staff directory, falling back to the role-matched staff row.
    const uid = sessionUser?.userId || resolvedUserId;
    const staffByUser = staffRows.find((st) => String((st as { userId?: unknown }).userId ?? "") === uid);
    const staffId = String((staffByUser as { id?: unknown } | undefined)?.id ?? (staffMatch as { id?: unknown } | undefined)?.id ?? "");

    // Prefer the real signed-in identity over the role-matched placeholder.
    return {
      name: sessionUser?.name || resolvedName,
      userId: sessionUser?.userId || resolvedUserId,
      staffId,
      role,
      ready: sessionChecked,
    };
  }, [staffRows, userRows, role, sessionUser, sessionChecked]);
}
