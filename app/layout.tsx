import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* Root layout metadata — shared by every page, so this is the product-level
 * description (the War Room sets its own in app/war/page.tsx). It is the OG /
 * search preview for any link to this site: keep it to what the site actually
 * shows.
 *
 * That claim used to be false. This block declared only `title` and
 * `description`, and Next does not synthesise Open Graph tags from those — so
 * every page shipped ZERO og:* and twitter:* tags, and every link to the site
 * unfurled in X, Slack, LinkedIn and Discord as bare text. For a project whose
 * entire launch is "build in public", the share card is the first surface
 * almost anyone sees, and it was the Vercel default.
 *
 * NO title.template here on purpose: each page already sets an absolute title
 * that carries the brand ("War Room — Lucky Loop"), so a "%s — Lucky Loop"
 * template would double it. */
export const metadata: Metadata = {
  // Required for the relative image URLs the opengraph-image convention emits;
  // without it a relative URL-based metadata field is a build error.
  metadataBase: new URL("https://lucky-loop-one.vercel.app"),
  title: "Lucky Loop",
  description:
    "An agent harness being built in public: an autonomous loop for everyday admin. Objectives, commits and deploys are published on the Lucky Loop War Room.",
  openGraph: {
    type: "website",
    siteName: "Lucky Loop",
    locale: "en",
    url: "/",
    title: "Lucky Loop — an agent harness for the admin you'd rather not do",
    description:
      "An agent harness being built in public: an autonomous loop for everyday admin. Objectives, commits and deploys are published on the Lucky Loop War Room.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lucky Loop — an agent harness for the admin you'd rather not do",
    description:
      "An agent harness being built in public: an autonomous loop for everyday admin. Objectives, commits and deploys are published on the Lucky Loop War Room.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
