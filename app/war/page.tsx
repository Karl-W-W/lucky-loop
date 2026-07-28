import type { Metadata } from "next";
import Dashboard from "./Dashboard";
import { currentAnchor } from "./data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "War Room — Lucky Loop",
  description:
    "Lucky Loop's build log in public: progress against the MVP objective, plus every git commit and Vercel production deploy, derived from the repo at build time.",
};

export default function WarPage() {
  return <Dashboard anchor={currentAnchor()} />;
}
