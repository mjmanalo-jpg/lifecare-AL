"use client";

import { useMemo } from "react";
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

export type ClinicianRole = "PHYSICIAN" | "NURSE" | "CAREGIVER" | "FACILITY_ADMIN";

export interface Clinician {
  name: string;
  userId: string;
  role: ClinicianRole;
}

const matchesRole = (position: string, role: ClinicianRole) => {
  const pos = position.toUpperCase();
  if (role === "PHYSICIAN") return pos.includes("PHYSICIAN") || pos.includes("DOCTOR");
  if (role === "NURSE") return pos.includes("NURSE");
  if (role === "CAREGIVER") return pos.includes("CAREGIVER") || pos.includes("AIDE");
  return pos.includes("ADMIN") || pos.includes("FACILITY"); // FACILITY_ADMIN
};

const FALLBACK: Record<ClinicianRole, string> = {
  PHYSICIAN: "Physician", NURSE: "Head Nurse", CAREGIVER: "Caregiver", FACILITY_ADMIN: "Facility Admin",
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

  return useMemo(() => {
    const fallback = FALLBACK[role];

    // 1. Titled Staff member for this role.
    const staffMatch = staffRows.find((s) => matchesRole(String((s as { position?: unknown }).position ?? ""), role));
    const staffUser = (staffMatch as { user?: Record<string, unknown> } | undefined)?.user;
    if (staffUser?.id) {
      return { name: displayName(staffUser, fallback), userId: String(staffUser.id), role };
    }

    // 2. Any User account with the matching role (covers physician w/o a Staff row).
    const userMatch =
      userRows.find((u) => String(u.role) === role && u.isActive !== false) ??
      userRows.find((u) => String(u.role) === role);
    if (userMatch?.id) {
      return { name: displayName(userMatch, fallback), userId: String(userMatch.id), role };
    }

    return { name: fallback, userId: "", role };
  }, [staffRows, userRows, role]);
}
