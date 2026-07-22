import type { Metadata } from "next";
import Dashboard from "./Dashboard";
import { currentAnchor } from "./data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "War Room — Lucky Loop",
  description: "Live operations dashboard: traffic, service health, and incidents.",
};

export default function WarPage() {
  return <Dashboard anchor={currentAnchor()} />;
}
