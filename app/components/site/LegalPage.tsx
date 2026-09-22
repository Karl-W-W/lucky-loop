import Link from "next/link";
import LoopMark from "./LoopMark";
import Markdown from "./Markdown";
import SiteFooter from "./SiteFooter";
import { readLegal, type LegalSlug } from "@/app/lib/legal";

/* One shell for the four legal pages: masthead, the German text (with its
 * English summary as the blockquote under the title), the footer. */
export default function LegalPage({ slug }: { slug: LegalSlug }) {
  const source = readLegal(slug);
  return (
    <main className="ll-home">
      <div className="ll-shell">
        <header className="ll-masthead">
          <Link href="/" className="ll-masthead-link" aria-label="Lucky Loop home">
            <LoopMark className="ll-mark" />
            <span className="ll-wordmark">Lucky Loop</span>
          </Link>
        </header>
        <article className="ll-doc" lang="de">
          <Markdown source={source} />
        </article>
        <SiteFooter />
      </div>
    </main>
  );
}
