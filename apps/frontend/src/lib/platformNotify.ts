import { prisma } from "@/lib/prisma";

export interface PlatformAlertInput {
  type?: string;
  title: string;
  message: string;
  severity?: "CRITICAL" | "WARNING" | "INFO";
  relatedEntityId?: string;
  relatedEntityType?: string;
  organizationId?: string | null;
  communityId?: string | null;
}

// Fan a business alert out to every active platform administrator (Users with
// platformRole PLATFORM_ADMIN). Best-effort and never throws — a failure here
// must not break the customer-facing action that triggered it. Returns how many
// notifications were created.
export async function notifyPlatformAdmins(input: PlatformAlertInput): Promise<number> {
  try {
    const admins = await prisma.user.findMany({
      where: { isActive: true, platformRole: "PLATFORM_ADMIN" },
      select: { id: true },
    });
    if (!admins.length) return 0;
    const created = await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        type: (input.type ?? "SYSTEM_ALERT") as never,
        title: input.title,
        message: input.message,
        severity: input.severity ?? "INFO",
        relatedEntityId: input.relatedEntityId,
        relatedEntityType: input.relatedEntityType,
        organizationId: input.organizationId ?? null,
        communityId: input.communityId ?? null,
      })),
    });
    return created.count;
  } catch (error) {
    console.error("[notifyPlatformAdmins] failed:", error instanceof Error ? error.message : "unknown");
    return 0;
  }
}
