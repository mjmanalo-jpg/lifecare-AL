import {
  AirVent, Sparkles, UtensilsCrossed, Shirt, Wrench, Bell, AlarmClock,
  BedDouble, Scissors, Coffee, Clapperboard, TreePine, DoorOpen, HeartHandshake,
  Church, type LucideIcon,
} from "lucide-react";

/**
 * Shared Phase 7 metadata — service-request categories, hotel-style workflow
 * states, auto-assign team routing, and the concierge "hotel on the hospital"
 * premium catalog. Used by the staff boards and the resident-facing view so
 * labels/colors/routing stay in lockstep with the Prisma enums.
 */

export const CATEGORY_META: Record<string, { label: string; sub: string; icon: LucideIcon; cls: string; subTypes: string[] }> = {
  AIRCON_HVAC: { label: "Aircon / HVAC", sub: "Temp adjust · filter · repair", icon: AirVent, cls: "text-sky-600 bg-sky-50 border-sky-200", subTypes: ["Temp Adjust", "Filter", "Repair"] },
  HOUSEKEEPING: { label: "Housekeeping", sub: "Room clean · linen change", icon: Sparkles, cls: "text-emerald-600 bg-emerald-50 border-emerald-200", subTypes: ["Room Clean", "Linen Change"] },
  ROOM_SERVICE: { label: "Room Service", sub: "Meals · snacks · beverages", icon: UtensilsCrossed, cls: "text-orange-600 bg-orange-50 border-orange-200", subTypes: ["Meals", "Snacks", "Beverages"] },
  LAUNDRY: { label: "Laundry & Pressing", sub: "Wash · dry · press", icon: Shirt, cls: "text-violet-600 bg-violet-50 border-violet-200", subTypes: ["Laundry & Pressing"] },
  REPAIRS: { label: "Repairs", sub: "Plumbing · electrical · Wi-Fi/TV", icon: Wrench, cls: "text-red-600 bg-red-50 border-red-200", subTypes: ["Plumbing", "Electrical", "Wi-Fi/TV"] },
};

export const PRIORITY_PILL: Record<string, string> = {
  ROUTINE: "bg-blue-50 text-blue-700 border border-blue-200",
  URGENT: "bg-orange-50 text-orange-700 border border-orange-200",
  EMERGENCY: "bg-red-100 text-red-700 border border-red-300 animate-pulse",
};

export const REQUEST_STATUS_PILL: Record<string, string> = {
  OPEN: "bg-gray-100 text-gray-700",
  ASSIGNED: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-green-100 text-green-700",
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-red-100 text-red-700",
};

export const TEAM_LABEL: Record<string, string> = {
  HOUSEKEEPING_TEAM: "Housekeeping",
  MAINTENANCE_ENGINEER: "Maintenance",
  KITCHEN: "Kitchen",
  IT_SUPPORT: "IT Support",
  CONCIERGE: "Concierge",
};

/**
 * Ticket auto-assign routing → the crew portal that works it.
 *   Maintenance  ← all Repairs (incl. Wi-Fi/TV) + Aircon/HVAC
 *   Housekeeping ← Housekeeping + Laundry + Room Service
 */
export function autoAssignTeam(category: string, _subType?: string): string {
  const map: Record<string, string> = {
    AIRCON_HVAC: "MAINTENANCE_ENGINEER",
    REPAIRS: "MAINTENANCE_ENGINEER",
    HOUSEKEEPING: "HOUSEKEEPING_TEAM",
    LAUNDRY: "HOUSEKEEPING_TEAM",
    ROOM_SERVICE: "HOUSEKEEPING_TEAM",
  };
  return map[category] ?? "MAINTENANCE_ENGINEER";
}

export const SOURCE_LABEL: Record<string, string> = {
  RESIDENT_PORTAL: "Resident Portal",
  AI_COMPANION: "AI Companion Voice",
  CALL_BELL: "Call Bell",
  FRONT_DESK: "Front Desk",
};

export const CONCIERGE_CATALOG: Record<string, { label: string; desc: string; icon: LucideIcon; cls: string; defaultPrice: number; billable: boolean }> = {
  CONCIERGE_DESK: { label: "Concierge Desk", desc: "Errands, bookings & special arrangements", icon: Bell, cls: "text-yellow-600 bg-yellow-50 border-yellow-200", defaultPrice: 0, billable: false },
  WAKE_UP_CALL: { label: "Wake-Up & Reminder Calls", desc: "Morning calls with medication reminders", icon: AlarmClock, cls: "text-sky-600 bg-sky-50 border-sky-200", defaultPrice: 0, billable: false },
  TURNDOWN: { label: "Turndown Service", desc: "Evening bed prep & room refresh", icon: BedDouble, cls: "text-indigo-600 bg-indigo-50 border-indigo-200", defaultPrice: 0, billable: false },
  SALON_BARBER: { label: "Salon & Barber", desc: "Haircuts, styling & grooming", icon: Scissors, cls: "text-pink-600 bg-pink-50 border-pink-200", defaultPrice: 25, billable: true },
  CAFE_BISTRO: { label: "Café / Bistro & Snack Cart", desc: "Barista drinks & roving snack cart", icon: Coffee, cls: "text-amber-700 bg-amber-50 border-amber-200", defaultPrice: 8, billable: true },
  MOVIE_GAME_NIGHT: { label: "Movie & Game Nights", desc: "Cinema evenings & group games", icon: Clapperboard, cls: "text-purple-600 bg-purple-50 border-purple-200", defaultPrice: 0, billable: false },
  GARDEN_LOUNGE: { label: "Garden Lounge Reservation", desc: "Private garden lounge time slot", icon: TreePine, cls: "text-green-600 bg-green-50 border-green-200", defaultPrice: 0, billable: false },
  GUEST_SUITE: { label: "Guest Suite for Family Stay", desc: "Overnight suite for visiting family", icon: DoorOpen, cls: "text-teal-600 bg-teal-50 border-teal-200", defaultPrice: 120, billable: true },
  SPA_MASSAGE: { label: "Massage & Spa Therapy", desc: "Gentle mobility & relaxation therapy", icon: HeartHandshake, cls: "text-rose-600 bg-rose-50 border-rose-200", defaultPrice: 45, billable: true },
  CHAPLAIN: { label: "Chaplain / Spiritual Care Visit", desc: "Pastoral & spiritual care visits", icon: Church, cls: "text-slate-600 bg-slate-50 border-slate-200", defaultPrice: 0, billable: false },
};

export const BOOKING_STATUS_PILL: Record<string, string> = {
  REQUESTED: "bg-amber-100 text-amber-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-indigo-100 text-indigo-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-gray-100 text-gray-600",
};

export const SYSTEM_META: Record<string, { label: string; cls: string }> = {
  HVAC: { label: "HVAC", cls: "bg-sky-100 text-sky-700" },
  GENERATOR: { label: "Generator", cls: "bg-amber-100 text-amber-700" },
  ELEVATOR: { label: "Elevator", cls: "bg-indigo-100 text-indigo-700" },
  FIRE_SAFETY: { label: "Fire & Safety", cls: "bg-red-100 text-red-700" },
  PEST_CONTROL: { label: "Pest Control", cls: "bg-green-100 text-green-700" },
  OTHER: { label: "Other", cls: "bg-gray-100 text-gray-700" },
};

export const FREQUENCY_DAYS: Record<string, number> = {
  WEEKLY: 7,
  MONTHLY: 30,
  QUARTERLY: 91,
  SEMI_ANNUAL: 182,
  ANNUAL: 365,
};

export const FREQUENCY_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  SEMI_ANNUAL: "Semi-annual",
  ANNUAL: "Annual",
};
