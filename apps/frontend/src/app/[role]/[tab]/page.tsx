"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { PATH_TO_ROLE, Role } from "@/constants/roleConfig";
import NursePortalContent from "@/components/portal/views/NursePortalContent";
import ClockInGate from "@/components/portal/ClockInGate";
import PhysicianPortalContent from "@/components/portal/views/PhysicianPortalContent";
import CaregiverPortalContent from "@/components/portal/views/CaregiverPortalContent";
import FamilyPortalContent from "@/components/portal/views/FamilyPortalContent";
import ResidentPortalContent from "@/components/portal/views/ResidentPortalContent";
import SuperAdminPortalContent from "@/components/portal/views/SuperAdminPortalContent";
import PlatformAdminPortalContent from "@/components/portal/views/PlatformAdminPortalContent";
import OrganizationAdminPortalContent from "@/components/portal/views/OrganizationAdminPortalContent";
import FacilityAdminPortalContent from "@/components/portal/views/FacilityAdminPortalContent";
import CareManagerPortalContent from "@/components/portal/views/CareManagerPortalContent";
import ResidentCoordinatorPortalContent from "@/components/portal/views/ResidentCoordinatorPortalContent";
import BillingFinancePortalContent from "@/components/portal/views/BillingFinancePortalContent";
import FleetManagementPortalContent from "@/components/portal/views/FleetManagementPortalContent";
import DriverPortalContent from "@/components/portal/views/DriverPortalContent";
import SecurityPortalContent from "@/components/portal/views/SecurityPortalContent";
import NutritionistPortalContent from "@/components/portal/views/NutritionistPortalContent";
import KitchenPortalContent from "@/components/portal/views/KitchenPortalContent";
import HousekeepingPortalContent from "@/components/portal/views/HousekeepingPortalContent";
import MaintenancePortalContent from "@/components/portal/views/MaintenancePortalContent";

// Portal chrome (sidebar + top bar + quick-actions) lives in layout.tsx so it
// survives navigation. This page renders ONLY the per-role content for the
// active tab — which is what the loading skeleton replaces.
export default function RolePortalPage() {
  const params = useParams();
  const router = useRouter();
  const roleParam = params?.role as string;
  const tab = (params?.tab as string) || "dashboard";

  const userRole: Role = roleParam ? (PATH_TO_ROLE[roleParam.toLowerCase()] || "FAMILY") : "FAMILY";

  useEffect(() => {
    if (tab !== "dailyrounds") return;
    const careLogRoles = new Set(["nurse", "caregiver", "care_manager", "physician", "facility_admin", "superadmin"]);
    const destination = careLogRoles.has(roleParam?.toLowerCase())
      ? `/${roleParam}/carelogs`
      : `/${roleParam}/dashboard`;
    router.replace(destination);
  }, [roleParam, router, tab]);

  if (tab === "dailyrounds") return null;

  return (
    <>
      {userRole === "NURSE" && <ClockInGate role="NURSE" tab={tab}><NursePortalContent tab={tab} /></ClockInGate>}
      {userRole === "PHYSICIAN" && <PhysicianPortalContent tab={tab} />}
      {userRole === "CAREGIVER" && <ClockInGate role="CAREGIVER" tab={tab}><CaregiverPortalContent tab={tab} /></ClockInGate>}
      {/* Resident/Patient sees the customized resident dashboard, family sees family view */}
      {userRole === "FAMILY" && <FamilyPortalContent tab={tab} />}
      {userRole === "RESIDENT" && <ResidentPortalContent tab={tab} />}
      {userRole === "PLATFORM_ADMIN" && <PlatformAdminPortalContent tab={tab} />}
      {userRole === "ORGANIZATION_ADMIN" && <OrganizationAdminPortalContent tab={tab} />}
      {/* Super Admin sees the full operations portal. */}
      {userRole === "SUPERADMIN" && <SuperAdminPortalContent tab={tab} />}
      {/* Facility Admin sees the dedicated facility portal. */}
      {userRole === "FACILITY_ADMIN" && <FacilityAdminPortalContent tab={tab} />}
      {/* Care Manager — clinical oversight split out of Facility Operations. */}
      {userRole === "CARE_MANAGER" && <CareManagerPortalContent tab={tab} />}
      {userRole === "RESIDENT_COORDINATOR" && <ResidentCoordinatorPortalContent tab={tab} />}
      {/* Billing & Finance sees the dedicated billing portal. */}
      {userRole === "BILLING_ADMIN" && <BillingFinancePortalContent tab={tab} />}
      {/* Fleet Manager sees the fleet & transport dispatch portal. */}
      {userRole === "FLEET_MANAGEMENT" && <FleetManagementPortalContent tab={tab} />}
      {/* Driver sees the driver dispatch portal. */}
      {userRole === "DRIVER" && <DriverPortalContent tab={tab} />}
      {/* Security Guard sees the security command portal. */}
      {userRole === "SECURITY" && <SecurityPortalContent tab={tab} />}
      {/* Nutritionist manages diet orders + menus; Kitchen reads the cook list. */}
      {userRole === "NUTRITIONIST" && <NutritionistPortalContent tab={tab} />}
      {userRole === "KITCHEN" && <KitchenPortalContent tab={tab} />}
      {/* Housekeeping works cleaning/linen tickets + room turnover; Maintenance works repairs/HVAC + facility upkeep. */}
      {userRole === "HOUSEKEEPING" && <HousekeepingPortalContent tab={tab} />}
      {userRole === "MAINTENANCE" && <MaintenancePortalContent tab={tab} />}
    </>
  );
}
