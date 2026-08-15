/**
 * Default geo-location of the facility (LifeCare — Pasig City, Philippines),
 * used to center maps and to anchor the trip origin/ETA math.
 *
 * Overridable at build time via NEXT_PUBLIC_FACILITY_LAT / NEXT_PUBLIC_FACILITY_LNG
 * (e.g. per-deployment on Vercel); the defaults below are the coordinates of
 * Pasig City so navigation works out of the box without those env vars.
 */
export const FACILITY_LAT = Number(process.env.NEXT_PUBLIC_FACILITY_LAT) || 14.5764;
export const FACILITY_LNG = Number(process.env.NEXT_PUBLIC_FACILITY_LNG) || 121.0851;
