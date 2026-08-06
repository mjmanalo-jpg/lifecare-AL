import { prisma } from "./prisma";
import { CAMERA_REGISTRY_KEY, CAMERA_OFFLINE_ALERT_MS, parseCameras } from "./cameraRegistry";

/**
 * Camera health watchdog for one community. A registered camera with
 * `healthAlerts` enabled that stops checking in (no heartbeat/failed test past
 * the grace window) is a silent blind spot — alert the care team once per
 * outage, reset on recovery. Returns how many offline alerts were sent.
 * Shared by the dedicated cron route and the main alerts cron.
 */
export async function scanCameraHealth(communityId: string, organizationId: string | null): Promise<number> {
  const row = await prisma.appSetting.findFirst({
    where: { key: CAMERA_REGISTRY_KEY, communityId },
    select: { id: true, value: true },
  });
  if (!row) return 0;
  const cams = parseCameras(row.value);
  if (!cams.length) return 0;

  const now = Date.now();
  let dirty = false;
  let alerted = 0;
  const offlineToAlert: { id: string; name: string; roomNumber: string }[] = [];

  for (const cam of cams) {
    if (!cam.enabled || !cam.healthAlerts) continue;
    const seen = cam.lastSeenAt ? new Date(cam.lastSeenAt).getTime() : 0;
    const stale = seen > 0 && now - seen > CAMERA_OFFLINE_ALERT_MS;
    if (stale) {
      const notifiedAt = cam.offlineNotifiedAt ? new Date(cam.offlineNotifiedAt).getTime() : 0;
      if (!notifiedAt || notifiedAt < seen) {
        offlineToAlert.push({ id: cam.id, name: cam.name, roomNumber: cam.roomNumber });
        cam.offlineNotifiedAt = new Date(now).toISOString();
        dirty = true;
      }
    } else if (cam.offlineNotifiedAt) {
      delete cam.offlineNotifiedAt;
      dirty = true;
    }
  }

  if (offlineToAlert.length) {
    const staff = await prisma.communityMembership.findMany({
      where: { communityId, status: "ACTIVE", role: { in: ["FACILITY_ADMIN", "CARE_MANAGER", "NURSE"] } },
      select: { userId: true },
    });
    if (staff.length) {
      for (const cam of offlineToAlert) {
        await prisma.notification.createMany({
          data: staff.map((s) => ({
            userId: s.userId,
            type: "SYSTEM_ALERT" as const,
            title: `Camera offline: ${cam.name}`,
            message: `${cam.name}${cam.roomNumber ? ` (Room ${cam.roomNumber})` : ""} has stopped reporting — this room may be an unmonitored blind spot. Check the camera/edge box.`,
            severity: "WARNING",
            relatedEntityId: cam.id,
            relatedEntityType: "camera",
            organizationId,
            communityId,
          })),
        });
        alerted++;
      }
    }
  }

  if (dirty) {
    try { await prisma.appSetting.update({ where: { id: row.id }, data: { value: JSON.stringify(cams) } }); } catch { /* best effort */ }
  }
  return alerted;
}
