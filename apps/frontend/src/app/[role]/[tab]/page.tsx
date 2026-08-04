"use client";

import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import PortalShell from "@/components/portal/PortalShell";
import { PATH_TO_ROLE, ROUTE_TO_TAB, Role } from "@/constants/roleConfig";
import NursePortalContent from "@/components/portal/views/NursePortalContent";
import PhysicianPortalContent from "@/components/portal/views/PhysicianPortalContent";
import CaregiverPortalContent from "@/components/portal/views/CaregiverPortalContent";
import FamilyPortalContent from "@/components/portal/views/FamilyPortalContent";
import ResidentPortalContent from "@/components/portal/views/ResidentPortalContent";
import SuperAdminPortalContent from "@/components/portal/views/SuperAdminPortalContent";
import PlatformAdminPortalContent from "@/components/portal/views/PlatformAdminPortalContent";
import OrganizationAdminPortalContent from "@/components/portal/views/OrganizationAdminPortalContent";
import FacilityAdminPortalContent from "@/components/portal/views/FacilityAdminPortalContent";
import CareManagerPortalContent from "@/components/portal/views/CareManagerPortalContent";
import BillingFinancePortalContent from "@/components/portal/views/BillingFinancePortalContent";
import FleetManagementPortalContent from "@/components/portal/views/FleetManagementPortalContent";
import DriverPortalContent from "@/components/portal/views/DriverPortalContent";
import SecurityPortalContent from "@/components/portal/views/SecurityPortalContent";
import NutritionistPortalContent from "@/components/portal/views/NutritionistPortalContent";
import KitchenPortalContent from "@/components/portal/views/KitchenPortalContent";
import HousekeepingPortalContent from "@/components/portal/views/HousekeepingPortalContent";
import MaintenancePortalContent from "@/components/portal/views/MaintenancePortalContent";
import { useEffect, useState } from "react";

export default function RolePortalPage() {
  const params = useParams();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  const roleParam = params?.role as string;
  const tabParam = params?.tab as string;

  const userRole: Role = roleParam ? (PATH_TO_ROLE[roleParam.toLowerCase()] || "FAMILY") : "FAMILY";
  const activeTab = tabParam ? (ROUTE_TO_TAB[tabParam] || "Dashboard") : "Dashboard";

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setIsLoading(false); }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    router.push("/login");
  };

  if (isLoading || !roleParam) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <PortalShell
      userRole={userRole}
      activeTab={activeTab}
      onLogout={handleLogout}
    >
      {userRole === "NURSE" && <NursePortalContent tab={tabParam || "dashboard"} />}
      {userRole === "PHYSICIAN" && <PhysicianPortalContent tab={tabParam || "dashboard"} />}
      {userRole === "CAREGIVER" && <CaregiverPortalContent tab={tabParam || "dashboard"} />}
      {/* Resident/Patient sees the customized resident dashboard, family sees family view */}
      {userRole === "FAMILY" && <FamilyPortalContent tab={tabParam || "dashboard"} />}
      {userRole === "RESIDENT" && <ResidentPortalContent tab={tabParam || "dashboard"} />}
      {userRole === "PLATFORM_ADMIN" && <PlatformAdminPortalContent tab={tabParam || "dashboard"} />}
      {userRole === "ORGANIZATION_ADMIN" && <OrganizationAdminPortalContent tab={tabParam || "dashboard"} />}
      {/* Super Admin sees the full operations portal. */}
      {userRole === "SUPERADMIN" && (
        <SuperAdminPortalContent tab={tabParam || "dashboard"} />
      )}
      {/* Facility Admin sees the dedicated facility portal. */}
      {userRole === "FACILITY_ADMIN" && (
        <FacilityAdminPortalContent tab={tabParam || "dashboard"} />
      )}
      {/* Care Manager — clinical oversight split out of Facility Operations. */}
      {userRole === "CARE_MANAGER" && (
        <CareManagerPortalContent tab={tabParam || "dashboard"} />
      )}
      {/* Billing & Finance sees the dedicated billing portal. */}
      {userRole === "BILLING_ADMIN" && (
        <BillingFinancePortalContent tab={tabParam || "dashboard"} />
      )}
      {/* Fleet Manager sees the fleet & transport dispatch portal. */}
      {userRole === "FLEET_MANAGEMENT" && (
        <FleetManagementPortalContent tab={tabParam || "dashboard"} />
      )}
      {/* Driver sees the driver dispatch portal. */}
      {userRole === "DRIVER" && (
        <DriverPortalContent tab={tabParam || "dashboard"} />
      )}
      {/* Security Guard sees the security command portal. */}
      {userRole === "SECURITY" && (
        <SecurityPortalContent tab={tabParam || "dashboard"} />
      )}
      {/* Nutritionist manages diet orders + menus; Kitchen reads the cook list. */}
      {userRole === "NUTRITIONIST" && (
        <NutritionistPortalContent tab={tabParam || "dashboard"} />
      )}
      {userRole === "KITCHEN" && (
        <KitchenPortalContent tab={tabParam || "dashboard"} />
      )}
      {/* Housekeeping works cleaning/linen tickets + room turnover; Maintenance works repairs/HVAC + facility upkeep. */}
      {userRole === "HOUSEKEEPING" && (
        <HousekeepingPortalContent tab={tabParam || "dashboard"} />
      )}
      {userRole === "MAINTENANCE" && (
        <MaintenancePortalContent tab={tabParam || "dashboard"} />
      )}
    </PortalShell>
  );
}
