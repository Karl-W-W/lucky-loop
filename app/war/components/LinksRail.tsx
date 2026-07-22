import type { LinkItem } from "../data";

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export default function LinksRail({ links }: { links: LinkItem[] }) {
  return (
    <section className="war-card flex h-full flex-col p-4" aria-label="Tool links">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Links</h2>
        <span className="text-xs text-[var(--war-ink-3)]">data/links.json</span>
      </div>
      <ul className="flex flex-col">
        {links.map((l) => {
          const configured = l.url.length > 0;
          const row = (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{l.name}</div>
                <div className="truncate text-[11px] text-[var(--war-ink-3)]">
                  {configured ? host(l.url) : (l.note ?? "not configured")}
                </div>
              </div>
              {configured ? (
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
                  <path
                    d="M5 3h6v6M11 3L3.5 10.5"
                    fill="none"
                    stroke="var(--war-ink-3)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span className="shrink-0 text-[11px] text-[var(--war-ink-3)]">—</span>
              )}
            </>
          );
          return (
            <li key={l.name}>
              {configured ? (
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--war-surface-2)]"
                >
                  {row}
                </a>
              ) : (
                <div className="flex items-center gap-3 rounded-lg px-2 py-2 opacity-60">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
