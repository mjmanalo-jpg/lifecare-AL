import { PortalContentSkeleton } from "@/components/portal/PortalSkeleton";

// Page-level loading fallback. The chrome (sidebar + top bar) lives in the
// persistent layout, so ONLY the content area skeletons here — the sidebar
// stays fully rendered.
export default function Loading() {
  return <PortalContentSkeleton variant="dashboard" />;
}
