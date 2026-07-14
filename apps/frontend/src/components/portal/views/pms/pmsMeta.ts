import {
  Users, UserPlus, Compass, HardHat, Truck, LogIn, LogOut, BadgeCheck,
  Sparkles, ClipboardCheck, DoorOpen, PackageCheck, Repeat, PartyPopper,
  HeartPulse, Gamepad2, Church, GraduationCap, UtensilsCrossed, TreePine,
  type LucideIcon,
} from "lucide-react";

/**
 * Shared Phase 7 PMS metadata — front-desk guest management, the apartment/room
 * status lifecycle (mobile staff tools), and resident/family engagement. Keeps
 * labels/colors/ordering in lockstep with the Prisma enums across the staff
 * boards, the resident-facing view, and the KPI dashboard.
 */

/* ── Front Desk & Guest Management ── */

export const VISIT_TYPE_META: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  GUEST_VISIT: { label: "Guest Visit", icon: Users, cls: "text-blue-600 bg-blue-50 border-blue-200" },
  NEW_RESIDENT_ARRIVAL: { label: "New Resident Arrival", icon: UserPlus, cls: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  TOUR: { label: "Tour", icon: Compass, cls: "text-purple-600 bg-purple-50 border-purple-200" },
  CONTRACTOR: { label: "Contractor", icon: HardHat, cls: "text-amber-600 bg-amber-50 border-amber-200" },
  DELIVERY: { label: "Delivery", icon: Truck, cls: "text-gray-600 bg-gray-50 border-gray-200" },
};

export const FRONTDESK_STATUS_PILL: Record<string, string> = {
  ARRIVED: "bg-amber-100 text-amber-700",
  CHECKED_IN: "bg-green-100 text-green-700",
  CHECKED_OUT: "bg-gray-100 text-gray-600",
};

/* ── Apartment / Room Status Lifecycle ── */
// Ordered loop: make ready → inspection → ready → occupied → turnover →
// move-out → deep clean → (back to make ready).
export const UNIT_STATUS_ORDER = [
  "MAKE_READY", "INSPECTION", "READY", "OCCUPIED", "TURNOVER", "MOVE_OUT", "DEEP_CLEAN",
];

export const UNIT_STATUS_META: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  MAKE_READY: { label: "Make Ready", icon: Sparkles, cls: "bg-blue-100 text-blue-700" },
  INSPECTION: { label: "Inspection", icon: ClipboardCheck, cls: "bg-amber-100 text-amber-700" },
  READY: { label: "Ready", icon: BadgeCheck, cls: "bg-green-100 text-green-700" },
  OCCUPIED: { label: "Occupied", icon: DoorOpen, cls: "bg-indigo-100 text-indigo-700" },
  TURNOVER: { label: "Turnover", icon: Repeat, cls: "bg-orange-100 text-orange-700" },
  MOVE_OUT: { label: "Move-Out / Transfer", icon: PackageCheck, cls: "bg-purple-100 text-purple-700" },
  DEEP_CLEAN: { label: "Deep Clean & Maintenance", icon: HardHat, cls: "bg-red-100 text-red-700" },
};

/* ── Resident & Family Engagement ── */

export const EVENT_CATEGORY_META: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  SOCIAL: { label: "Social", icon: PartyPopper, cls: "text-pink-600 bg-pink-50 border-pink-200" },
  WELLNESS: { label: "Wellness", icon: HeartPulse, cls: "text-rose-600 bg-rose-50 border-rose-200" },
  RECREATION: { label: "Recreation", icon: Gamepad2, cls: "text-purple-600 bg-purple-50 border-purple-200" },
  SPIRITUAL: { label: "Spiritual", icon: Church, cls: "text-slate-600 bg-slate-50 border-slate-200" },
  EDUCATIONAL: { label: "Educational", icon: GraduationCap, cls: "text-blue-600 bg-blue-50 border-blue-200" },
  DINING: { label: "Dining", icon: UtensilsCrossed, cls: "text-orange-600 bg-orange-50 border-orange-200" },
  OUTING: { label: "Outing", icon: TreePine, cls: "text-green-600 bg-green-50 border-green-200" },
};

export const RSVP_PILL: Record<string, string> = {
  INVITED: "bg-gray-100 text-gray-600",
  GOING: "bg-blue-100 text-blue-700",
  DECLINED: "bg-red-100 text-red-700",
  ATTENDED: "bg-green-100 text-green-700",
  NO_SHOW: "bg-amber-100 text-amber-700",
};

export const DINING_STATUS_PILL: Record<string, string> = {
  REQUESTED: "bg-amber-100 text-amber-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  SEATED: "bg-indigo-100 text-indigo-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-gray-100 text-gray-600",
};

export const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER"];
export const DINING_VENUES = ["Main Dining", "Bistro", "Private Room", "Garden Lounge"];

export const ANNOUNCEMENT_PRIORITY_PILL: Record<string, string> = {
  NORMAL: "bg-blue-50 text-blue-700 border border-blue-200",
  HIGH: "bg-orange-50 text-orange-700 border border-orange-200",
  URGENT: "bg-red-100 text-red-700 border border-red-300",
};

export const PREFERENCE_CATEGORIES = ["Dining", "Room Comfort", "Activities", "Wake-Up", "Communication"];

/* ── Icon helper for the resident-facing shell ── */
export { LogIn, LogOut };
