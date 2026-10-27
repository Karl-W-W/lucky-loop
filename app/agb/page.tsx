import type { Metadata } from "next";
import LegalPage from "@/app/components/site/LegalPage";

/* Content lives in content/legal/agb.md (German, binding; English summary at
 * the top). openGraph is restated because it does not compose from a segment's
 * own title — see app/loop/page.tsx. */
export const metadata: Metadata = {
  title: "AGB — Lucky Loop",
  description:
    "Allgemeine Geschäftsbedingungen für Lucky Loop Hosted und die Einrichtung: Leistung, Preise, Zahlung, Laufzeit, Kündigung, Erstattung, Haftung. Nur für Unternehmer. Terms for business customers.",
  openGraph: {
    type: "website",
    siteName: "Lucky Loop",
    url: "/agb",
    title: "AGB — Lucky Loop",
    description:
      "Allgemeine Geschäftsbedingungen für Lucky Loop Hosted und die Einrichtung: Leistung, Preise, Zahlung, Laufzeit, Kündigung, Erstattung, Haftung. Nur für Unternehmer. Terms for business customers.",
  },
  twitter: {
    card: "summary_large_image",
    title: "AGB — Lucky Loop",
    description:
      "Allgemeine Geschäftsbedingungen für Lucky Loop Hosted und die Einrichtung: Leistung, Preise, Zahlung, Laufzeit, Kündigung, Erstattung, Haftung. Nur für Unternehmer. Terms for business customers.",
  },
};

export default function Page() {
  return <LegalPage slug="agb" />;
}
