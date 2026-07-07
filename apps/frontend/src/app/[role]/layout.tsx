import { validateSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PATH_TO_ROLE } from "@/constants/roleConfig";
import React from "react";

interface RoleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ role: string }>;
}

export default async function RoleLayout({ children, params }: RoleLayoutProps) {
  // Await params since it's a Promise in Next.js 16
  const { role } = await params;

  // Validate session exists
  const userRole = await validateSession();
  if (!userRole) {
    redirect("/login");
  }

  // Validate that the URL role matches the session role
  const urlRole = PATH_TO_ROLE[role.toLowerCase()];
  if (!urlRole || urlRole !== userRole) {
    redirect(`/${userRole.toLowerCase()}/dashboard`);
  }

  return <>{children}</>;
}
