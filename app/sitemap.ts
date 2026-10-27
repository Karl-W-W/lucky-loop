import type { MetadataRoute } from "next";
import { SITE_URL } from "@/app/lib/site";
import { LEGAL_PAGES } from "@/app/lib/legal";

export default function sitemap(): MetadataRoute.Sitemap {
  const at = new Date("2026-09-22T00:00:00Z");
  return [
    { url: `${SITE_URL}/`, lastModified: at, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/war`, lastModified: at, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/loop`, lastModified: at, changeFrequency: "weekly", priority: 0.8 },
    ...LEGAL_PAGES.map((p) => ({ url: `${SITE_URL}/${p.slug}`, lastModified: at, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
