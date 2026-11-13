import Link from "next/link";
import { LEGAL_PAGES, impressum } from "@/app/lib/legal";
import { REPO_PUBLIC } from "@/app/war/data";

/* The footer every stranger-facing page carries (2026-09-22): the legal pages
 * German law requires of a commercial site, the price and the source. The
 * links to /war and /loop left on 2026-11-13 (Karl's ruling of 2026-10-02). Rendered from data/impressum.json and app/lib/legal.ts so a
 * page cannot drift from the legal identity it stands under. */
export default function SiteFooter({ dark = false }: { dark?: boolean }) {
  return (
    <footer className={dark ? "ll-footer ll-footer--dark" : "ll-footer"} aria-label="Site footer">
      <nav className="ll-footer-nav" aria-label="Legal and site links">
        <Link href="/#pricing">Pricing</Link>
        {LEGAL_PAGES.map((p) => (
          <Link key={p.slug} href={`/${p.slug}`}>
            {p.short}
          </Link>
        ))}
        {REPO_PUBLIC ? <a href="https://github.com/Karl-W-W/lucky-loop">Source</a> : null}
      </nav>
      <p className="ll-footer-line">
        {impressum.name} · {impressum.city.replace(/^\d+\s+/, "")} · business customers only (§ 14 BGB) ·{" "}
        <a href={`mailto:${impressum.email}`}>{impressum.email}</a>
      </p>
    </footer>
  );
}
