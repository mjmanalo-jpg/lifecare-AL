/**
 * Default geo-location of the facility (Golden Hearth — Las Piñas City,
 * Philippines), used to center maps and to anchor the trip origin/ETA math.
 *
 * Overridable at build time via NEXT_PUBLIC_FACILITY_LAT / NEXT_PUBLIC_FACILITY_LNG
 * (e.g. per-deployment on Vercel); the defaults below are the coordinates of
 * Las Piñas City so navigation works out of the box without those env vars.
 */
export const FACILITY_LAT = Number(process.env.NEXT_PUBLIC_FACILITY_LAT) || 14.4506;
export const FACILITY_LNG = Number(process.env.NEXT_PUBLIC_FACILITY_LNG) || 120.9829;
