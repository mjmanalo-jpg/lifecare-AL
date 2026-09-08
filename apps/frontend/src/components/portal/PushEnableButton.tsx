"use client";

import { useEffect, useState } from "react";
import { BellRing, BellOff, Loader2 } from "lucide-react";
import { enablePush, disablePush, pushPermission } from "@/lib/pushClient";
import { pushGlobalToast } from "@/components/ui/global-toast";

/**
 * Compact "Enable alerts on this device" control for the notification dropdown.
 * Permission must be requested from a user gesture, so this is a button, not an
 * auto-prompt. Hidden entirely when the browser can't do web push.
 */
export default function PushEnableButton() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setPerm(pushPermission()); }, []);

  if (perm === "unsupported") return null;

  const onEnable = async () => {
    setBusy(true);
    const res = await enablePush();
    setBusy(false);
    if (res.ok) { setPerm("granted"); pushGlobalToast("success", "Push alerts on", "This device will now ring for new alerts."); return; }
    if (res.reason === "denied") { setPerm("denied"); pushGlobalToast("error", "Permission blocked", "Allow notifications for this site in your browser settings."); }
    else if (res.reason === "not-configured") pushGlobalToast("error", "Push not configured", "Ask an admin to set the VAPID keys.");
    else pushGlobalToast("error", "Couldn’t enable push", "Please try again.");
  };

  const onDisable = async () => {
    setBusy(true);
    await disablePush();
    setBusy(false);
    setPerm("default");
    pushGlobalToast("info", "Push alerts off", "This device will no longer ring.");
  };

  if (perm === "denied") {
    return (
      <p className="px-3 py-2 text-[11px] text-amber-600">
        Push is blocked for this site. Enable notifications in your browser settings to get alerts on this device.
      </p>
    );
  }

  const granted = perm === "granted";
  return (
    <button
      type="button"
      onClick={granted ? onDisable : onEnable}
      disabled={busy}
      className={`flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${granted ? "text-gray-500 hover:bg-gray-50" : "text-blue-600 hover:bg-blue-50"}`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : granted ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
      {busy ? "Working…" : granted ? "Turn off alerts on this device" : "Enable alerts on this device"}
    </button>
  );
}
