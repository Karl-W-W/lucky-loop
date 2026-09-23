import Link from "next/link";
import LoopMark from "./LoopMark";
import Markdown from "./Markdown";
import SiteFooter from "./SiteFooter";
import { readLegal, type LegalSlug } from "@/app/lib/legal";

/* One shell for the four legal pages: masthead, the German text (with its
 * English summary as the blockquote under the title), the footer. */
export default function LegalPage({ slug }: { slug: LegalSlug }) {
  const source = readLegal(slug);
  // A contents list from the "## " headings, so a long AGB is navigable on a
  // phone. Ids match Markdown.tsx's slug() — same function, copied on purpose
  // so the renderer has no exports beyond its component.
  const toc = source
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.slice(3).trim())
    .map((t) => ({ t, id: t.toLowerCase().replace(/§/g, "").replace(/[äöüß]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[c] ?? c).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) }));
  return (
    <main className="ll-home">
      <div className="ll-shell">
        <header className="ll-masthead">
          <Link href="/" className="ll-masthead-link" aria-label="Lucky Loop home">
            <LoopMark className="ll-mark" />
            <span className="ll-wordmark">Lucky Loop</span>
          </Link>
        </header>
        {toc.length > 4 ? (
          <nav className="ll-toc" aria-label="Inhalt">
            <p className="ll-toc-title">Inhalt · Contents</p>
            <ol>
              {toc.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`}>{h.t}</a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <article className="ll-doc" lang="de">
          <Markdown source={source} />
        </article>
        <SiteFooter />
      </div>
    </main>
  );
}
