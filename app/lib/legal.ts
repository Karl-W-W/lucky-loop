import { readFileSync } from "node:fs";
import { join } from "node:path";
import impressumJson from "@/data/impressum.json";
import pricingJson from "@/data/pricing.json";

/* The legal pages render CONTENT Karl typed — content/legal/*.md and the two
 * JSON files — through a deliberately tiny markdown renderer (Markdown.tsx).
 * No markdown dependency: the site has three runtime deps and keeps them.
 * scripts/check-legal.mjs (npm prebuild + CI) refuses a build when a file is
 * missing, holds a placeholder, or disagrees with the JSON. */

export type LegalSlug = "impressum" | "datenschutz" | "agb" | "kontakt";

export const LEGAL_PAGES: { slug: LegalSlug; title: string; short: string }[] = [
  { slug: "impressum", title: "Impressum", short: "Impressum" },
  { slug: "datenschutz", title: "Datenschutzerklärung", short: "Datenschutz" },
  { slug: "agb", title: "Allgemeine Geschäftsbedingungen", short: "AGB" },
  { slug: "kontakt", title: "Kontakt · Contact", short: "Kontakt" },
];

export function readLegal(slug: LegalSlug): string {
  return readFileSync(join(process.cwd(), "content", "legal", `${slug}.md`), "utf8");
}

export const impressum = impressumJson;
export const pricing = pricingJson;

export function eur(n: number): string {
  return "€" + n.toLocaleString("en-GB");
}
