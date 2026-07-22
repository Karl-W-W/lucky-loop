import type { FeedEvent } from "../data";
import { fmtAgo, fmtFeedTime } from "../format";
import { StatusChip } from "./StatusIcon";

function chip(e: FeedEvent) {
  if (e.kind === "deploy") return <StatusChip role="neutral" label="Deploy" />;
  if (e.kind === "note") return <StatusChip role="neutral" label="Note" />;
  const label = e.status ?? "Alert";
  return <StatusChip role={e.severity ?? "warning"} label={label} />;
}

export default function IncidentFeed({
  events,
  anchor,
  rangeLabel,
}: {
  events: FeedEvent[];
  anchor: number;
  rangeLabel: string;
}) {
  return (
    <section className="war-card flex h-full flex-col p-4" aria-label="Activity feed">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Activity</h2>
        <span className="text-xs text-[var(--war-ink-3)]">{rangeLabel} · UTC</span>
      </div>
      {events.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--war-ink-3)]">
          No events in this window.
        </p>
      ) : (
        <ol className="flex flex-col">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex gap-3 rounded-lg px-2 py-2.5 hover:bg-[var(--war-surface-2)]"
            >
              <div className="w-24 shrink-0 pt-0.5 text-[11px] leading-4 text-[var(--war-ink-3)]">
                <div className="tabular-nums">{fmtFeedTime(e.at, anchor)}</div>
                <div>{fmtAgo(e.at, anchor)}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {chip(e)}
                  <span className="text-sm font-medium">{e.title}</span>
                </div>
                <p className="mt-0.5 text-[13px] text-[var(--war-ink-2)]">{e.detail}</p>
                {e.service ? (
                  <span className="mt-1 inline-block rounded bg-[var(--war-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--war-ink-2)]">
                    {e.service}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
