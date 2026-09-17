import type { MetadataRoute } from "next";

const SITE_URL = "https://assisted-living.resoluteaiph.com";

// Every role portal is authenticated and may render PHI, so keep the whole tree
// out of the index. Mirrors PATH_TO_ROLE in constants/roleConfig.ts — a bare
// prefix (no trailing slash) blocks both `/nurse` and `/nurse/dashboard`.
const ROLE_PATHS = [
  "platform_admin", "organization_admin", "nurse", "superadmin", "caregiver",
  "family", "facility_admin", "care_manager", "crm", "resident_coordinator",
  "billing_admin", "physician", "resident", "fleet_management", "driver",
  "security", "nutritionist", "kitchen", "housekeeping", "maintenance",
].map((r) => `/${r}`);

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/rcard/", // resident cards = PHI
        "/checkout/",
        "/account/",
        "/invite/",
        ...ROLE_PATHS,
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
