import type { MetadataRoute } from "next";

const SITE_URL = "https://assisted-living.resoluteaiph.com";

// Only the genuinely public marketing surface belongs here. Blog posts and CMS
// pages live in the DB — add them dynamically here when blog/page SEO matters.
// ponytail: static list, add DB-backed public pages when blog SEO is wanted.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE_URL}/login`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
