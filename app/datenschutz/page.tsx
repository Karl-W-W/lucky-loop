import type { Metadata } from "next";
import LegalPage from "@/app/components/site/LegalPage";

/* Content lives in content/legal/datenschutz.md (German, binding; English summary at
 * the top). openGraph is restated because it does not compose from a segment's
 * own title — see app/loop/page.tsx. */
export const metadata: Metadata = {
  title: "Datenschutzerklärung — Lucky Loop",
  description:
    "Was diese Website und der gehostete Dienst mit Daten tun: Hosting, E-Mail, Zahlung, keine Cookies, keine Analyse. Privacy notice of the site and the hosted service.",
  openGraph: {
    type: "website",
    siteName: "Lucky Loop",
    url: "/datenschutz",
    title: "Datenschutzerklärung — Lucky Loop",
    description:
      "Was diese Website und der gehostete Dienst mit Daten tun: Hosting, E-Mail, Zahlung, keine Cookies, keine Analyse. Privacy notice of the site and the hosted service.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Datenschutzerklärung — Lucky Loop",
    description:
      "Was diese Website und der gehostete Dienst mit Daten tun: Hosting, E-Mail, Zahlung, keine Cookies, keine Analyse. Privacy notice of the site and the hosted service.",
  },
};

export default function Page() {
  return <LegalPage slug="datenschutz" />;
}
