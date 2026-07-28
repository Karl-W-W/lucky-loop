import type { LedgerEntry } from "../data";
import { fmtAgo, fmtFeedTime } from "../format";
import { StatusChip } from "./StatusIcon";

const MAX_ROWS = 25;

export default function LedgerFeed({
  entries,
  anchor,
  /* The build could not see the whole git history (see isLedgerTruncated in
   * ../data). The list below is then a floor, and the heading says so. */
  truncated = false,
}: {
  entries: LedgerEntry[];
  anchor: number;
  truncated?: boolean;
}) {
  const shown = entries.slice(0, MAX_ROWS);
  return (
    <section className="war-card flex h-full flex-col p-4" aria-label="Growth ledger">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Growth Ledger</h2>
        <span className="text-xs text-[var(--war-ink-3)]">
          commits + deploys · UTC
          {truncated ? " · history truncated (floor, not the full history)" : ""}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--war-ink-3)]">No entries yet.</p>
      ) : (
        <ol className="flex flex-col">
          {shown.map((e) => (
            <li
              key={e.id}
              className="flex gap-3 rounded-lg px-2 py-2 hover:bg-[var(--war-surface-2)]"
            >
              <div className="w-24 shrink-0 pt-0.5 text-[11px] leading-4 text-[var(--war-ink-3)]">
                <div className="tabular-nums">{fmtFeedTime(e.t, anchor)}</div>
                <div>{fmtAgo(e.t, anchor)}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {e.kind === "deploy" ? (
                    <StatusChip role="good" label="Deploy" />
                  ) : (
                    <StatusChip role="neutral" label="Commit" />
                  )}
                  {e.href ? (
                    <a
                      href={e.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {e.title}
                    </a>
                  ) : (
                    <span className="truncate text-sm font-medium">{e.title}</span>
                  )}
                </div>
                {e.detail ? (
                  <div className="mt-0.5 font-mono text-[11px] text-[var(--war-ink-3)]">
                    {e.detail}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {entries.length > MAX_ROWS ? (
        <p className="mt-2 text-center text-[11px] text-[var(--war-ink-3)]">
          {entries.length - MAX_ROWS} older entries in git log
        </p>
      ) : null}
    </section>
  );
}
