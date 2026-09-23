import type { Metadata } from "next";
import LegalPage from "@/app/components/site/LegalPage";

/* Content lives in content/legal/impressum.md (German, binding; English summary at
 * the top). openGraph is restated because it does not compose from a segment's
 * own title — see app/loop/page.tsx. */
export const metadata: Metadata = {
  title: "Impressum — Lucky Loop",
  description:
    "Anbieterkennzeichnung nach § 5 DDG und § 18 MStV für lucky-loop: wer die Seite betreibt, wo, und wie Sie ihn erreichen. Legal notice of the operator of this site.",
  openGraph: {
    type: "website",
    siteName: "Lucky Loop",
    url: "/impressum",
    title: "Impressum — Lucky Loop",
    description:
      "Anbieterkennzeichnung nach § 5 DDG und § 18 MStV für lucky-loop: wer die Seite betreibt, wo, und wie Sie ihn erreichen. Legal notice of the operator of this site.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Impressum — Lucky Loop",
    description:
      "Anbieterkennzeichnung nach § 5 DDG und § 18 MStV für lucky-loop: wer die Seite betreibt, wo, und wie Sie ihn erreichen. Legal notice of the operator of this site.",
  },
};

export default function Page() {
  return <LegalPage slug="impressum" />;
}
