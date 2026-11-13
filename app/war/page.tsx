import { redirect } from "next/navigation";

/* Retired from the public site by Karl's ruling of 2026-10-02 (answer
 * retire-war-and-loop): the site is the offer, the legal pages and contact.
 * The route itself sends a visitor home, so the build writes no dashboard text
 * into any file a visitor can fetch (the HTML, the .rsc data route, the
 * .segments routes). The redirects in next.config.ts are the second line.
 * ./Dashboard.tsx, ./data.ts and ./components stay, unimported here:
 * langflow/gen-flow.py anchors into them and the Today page reads
 * data/okrs.json. Deleting the retired code is a follow-up. */
export default function WarPage(): never {
  redirect("/");
}
