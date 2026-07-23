import { requireTenantContext } from "@/lib/tenant";
import { redirect } from "next/navigation";
import { PATH_TO_ROLE } from "@/constants/roleConfig";
import React from "react";

export default async function RoleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ role: string }> }) {
  const { role } = await params;
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) redirect("/");
  const urlRole = PATH_TO_ROLE[role.toLowerCase()];
  if (context.isPlatform) {
    if (urlRole === "PLATFORM_ADMIN") return <>{children}</>;
    redirect("/platform_admin/dashboard");
  }
  if (urlRole === "PLATFORM_ADMIN") redirect("/");
  const organizationAdmin = ["OWNER", "ADMIN"].includes(context.organizationRole || "");
  if (urlRole === "ORGANIZATION_ADMIN") {
    if (organizationAdmin) return <>{children}</>;
    redirect(`/${context.role.toLowerCase()}/dashboard`);
  }
  if (urlRole === "FACILITY_ADMIN" && organizationAdmin) return <>{children}</>;
  if (!context.communityId) redirect("/");
  if (!urlRole || urlRole !== context.role) redirect(`/${context.role.toLowerCase()}/dashboard`);
  return <>{children}</>;
}
