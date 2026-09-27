import type { Metadata } from "next";
import LegalPage from "@/app/components/site/LegalPage";

/* Content lives in content/legal/kontakt.md (German, binding; English summary at
 * the top). openGraph is restated because it does not compose from a segment's
 * own title — see app/loop/page.tsx. */
export const metadata: Metadata = {
  title: "Kontakt · Contact — Lucky Loop",
  description:
    "So erreichen Sie Lucky Loop: E-Mail, Antwortzeit, was eine Anfrage enthalten sollte. How to reach Lucky Loop, and how fast you hear back.",
  openGraph: {
    type: "website",
    siteName: "Lucky Loop",
    url: "/kontakt",
    title: "Kontakt · Contact — Lucky Loop",
    description:
      "So erreichen Sie Lucky Loop: E-Mail, Antwortzeit, was eine Anfrage enthalten sollte. How to reach Lucky Loop, and how fast you hear back.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kontakt · Contact — Lucky Loop",
    description:
      "So erreichen Sie Lucky Loop: E-Mail, Antwortzeit, was eine Anfrage enthalten sollte. How to reach Lucky Loop, and how fast you hear back.",
  },
};

export default function Page() {
  return <LegalPage slug="kontakt" />;
}
