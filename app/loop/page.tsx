import { redirect } from "next/navigation";

/* Retired from the public site by Karl's ruling of 2026-10-02 (answer
 * retire-war-and-loop): the site is the offer, the legal pages and contact.
 * The route itself sends a visitor home, so the build writes no dashboard text
 * into any file a visitor can fetch (the HTML, the .rsc data route, the
 * .segments routes). The redirects in next.config.ts are the second line.
 * The former page body is kept, unimported, in ./RetiredLoopPage.tsx so this
 * is undone by restoring that file here; deleting it is a follow-up. */
export default function LoopPage(): never {
  redirect("/");
}
