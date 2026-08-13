import type { Metadata } from "next";
import Dashboard from "./Dashboard";
import { currentAnchor } from "./data";

export const dynamic = "force-dynamic";

/* openGraph is restated rather than inherited: Next does not fall back to a
 * segment's own `title`/`description` when composing the parent's openGraph, so
 * without this a shared /war link would unfurl under the ROOT title and read as
 * the homepage. The image itself is inherited from app/opengraph-image.tsx. */
export const metadata: Metadata = {
  title: "War Room — Lucky Loop",
  description:
    "Lucky Loop's build log in public: progress against the MVP objective, plus every git commit and Vercel production deploy, derived from the repo at build time.",
  openGraph: {
    type: "website",
    siteName: "Lucky Loop",
    url: "/war",
    title: "War Room — Lucky Loop",
    description:
      "Lucky Loop's build log in public: progress against the MVP objective, plus every git commit and Vercel production deploy, derived from the repo at build time.",
  },
  twitter: {
    card: "summary_large_image",
    title: "War Room — Lucky Loop",
    description:
      "Lucky Loop's build log in public: progress against the MVP objective, plus every git commit and Vercel production deploy, derived from the repo at build time.",
  },
};

export default function WarPage() {
  return <Dashboard anchor={currentAnchor()} />;
}
