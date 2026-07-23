"use client";

import { useMemo } from "react";
import { useLiveQuery } from "./useLiveQuery";

export interface FacilityConfig {
  facilityName: string;
  facilityAddress: string;
  facilityPhone: string;
  facilityEmail: string;
  facilitySubtitle: string;
  facilityFooter: string;
  facilityMapUrl: string;
}

const DEFAULTS: FacilityConfig = {
  facilityName: "",
  facilityAddress: "",
  facilityPhone: "",
  facilityEmail: "",
  facilitySubtitle: "",
  facilityFooter: "",
  facilityMapUrl: "",
};

/**
 * Reads facility-level settings from the AppSetting table.
 * Keys: facility_name, facility_address, facility_phone, facility_email,
 *        facility_subtitle, facility_footer, facility_map_url.
 */
export function useFacilityConfig(): FacilityConfig {
  const { data: rows } = useLiveQuery<Record<string, unknown>>("app-settings", {
    query: "take=50",
    tables: ["AppSetting"],
  });

  return useMemo(() => {
    if (!rows.length) return DEFAULTS;
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(String(r.key || r.id), String(r.value ?? ""));
    }
    return {
      facilityName: map.get("facility_name") || DEFAULTS.facilityName,
      facilityAddress: map.get("facility_address") || DEFAULTS.facilityAddress,
      facilityPhone: map.get("facility_phone") || DEFAULTS.facilityPhone,
      facilityEmail: map.get("facility_email") || DEFAULTS.facilityEmail,
      facilitySubtitle: map.get("facility_subtitle") || DEFAULTS.facilitySubtitle,
      facilityFooter: map.get("facility_footer") || DEFAULTS.facilityFooter,
      facilityMapUrl: map.get("facility_map_url") || DEFAULTS.facilityMapUrl,
    };
  }, [rows]);
}
