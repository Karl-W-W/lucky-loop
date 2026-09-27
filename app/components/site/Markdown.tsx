import type { ReactNode } from "react";

/* A deliberately small markdown renderer for content/legal/*.md.
 * Supported, and nothing else: "# " once, "## " / "### " headings (with ids so
 * the price card can link to a section), paragraphs, "- " lists, "1. " lists,
 * "> " blockquotes, "---" rules, **bold**, [text](https://…). No tables, no
 * HTML, no nested lists — scripts/check-legal.mjs refuses those upstream.
 * Anything unsupported renders as plain text, never as markup. */

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/§/g, "")
    .replace(/[äöüß]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+|\/[^)\s]*|mailto:[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      out.push(<strong key={`${key}-b${i++}`}>{m[1].slice(2, -2)}</strong>);
    } else if (m[2]) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m[2]);
      if (lm) {
        const href = lm[2];
        const external = /^https?:\/\//.test(href);
        out.push(
          <a key={`${key}-a${i++}`} href={href} rel={external ? "noopener noreferrer" : undefined}>
            {lm[1]}
          </a>,
        );
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  let k = 0;

  const flushPara = () => {
    if (para.length) {
      const key = `p${k++}`;
      nodes.push(<p key={key}>{inline(para.join(" "), key)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const key = `l${k++}`;
      const items = list.items.map((it, i) => <li key={`${key}-${i}`}>{inline(it, `${key}-${i}`)}</li>);
      nodes.push(list.kind === "ul" ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>);
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      const key = `q${k++}`;
      nodes.push(
        <blockquote key={key} lang="en">
          {quote.map((q, i) => (
            <p key={`${key}-${i}`}>{inline(q, `${key}-${i}`)}</p>
          ))}
        </blockquote>,
      );
      quote = [];
    }
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushAll(); continue; }
    let m: RegExpMatchArray | null;
    if ((m = /^# (.+)$/.exec(line))) { flushAll(); nodes.push(<h1 key={`h${k++}`}>{inline(m[1], `h${k}`)}</h1>); continue; }
    if ((m = /^## (.+)$/.exec(line))) { flushAll(); nodes.push(<h2 key={`h${k++}`} id={slug(m[1])}>{inline(m[1], `h${k}`)}</h2>); continue; }
    if ((m = /^### (.+)$/.exec(line))) { flushAll(); nodes.push(<h3 key={`h${k++}`} id={slug(m[1])}>{inline(m[1], `h${k}`)}</h3>); continue; }
    if (/^---+$/.test(line)) { flushAll(); nodes.push(<hr key={`r${k++}`} />); continue; }
    if ((m = /^> ?(.*)$/.exec(line))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = /^- (.+)$/.exec(line))) { flushPara(); flushQuote(); if (!list || list.kind !== "ul") { flushList(); list = { kind: "ul", items: [] }; } list.items.push(m[1]); continue; }
    if ((m = /^\d+\. (.+)$/.exec(line))) { flushPara(); flushQuote(); if (!list || list.kind !== "ol") { flushList(); list = { kind: "ol", items: [] }; } list.items.push(m[1]); continue; }
    flushList(); flushQuote(); para.push(line.trim());
  }
  flushAll();
  return <>{nodes}</>;
}
