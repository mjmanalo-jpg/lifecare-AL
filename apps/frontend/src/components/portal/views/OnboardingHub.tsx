"use client";

import { useState } from "react";
import { UserPlus, KeyRound } from "lucide-react";
import AdmissionsContent from "@/components/portal/views/AdmissionsContent";
import ResidentAccounts from "@/components/portal/views/ResidentAccounts";

/**
 * Combined onboarding hub — hosts the staff Admissions pipeline and the
 * Resident & Family Accounts screen (provision logins for admitted residents +
 * their sponsors) as two tabs of a single screen. Both /superadmin/admissions
 * and /superadmin/registration resolve here, defaulting to the relevant tab.
 */
export default function OnboardingHub({ initialTab = "admissions" }: { initialTab?: "admissions" | "registration" }) {
  const [view, setView] = useState<"admissions" | "registration">(initialTab);

  const tabCls = (active: boolean) =>
    `flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
      active ? "border-amber-500 text-amber-600" : "border-transparent text-gray-500 hover:text-gray-700"
    }`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
        <button onClick={() => setView("admissions")} className={tabCls(view === "admissions")}>
          <UserPlus className="w-4 h-4" /> Admissions
        </button>
        <button onClick={() => setView("registration")} className={tabCls(view === "registration")}>
          <KeyRound className="w-4 h-4" /> Accounts
        </button>
      </div>

      {view === "admissions" ? <AdmissionsContent /> : <ResidentAccounts />}
    </div>
  );
}
