import {
  daysBetween,
  loopState,
  tickIntervalMs,
  type LoopStateKind,
  type LoopStatus,
  type StatusRole,
} from "../data";
import { fmtAgo, fmtDate, fmtDayTime, fmtTime } from "../format";

/* Status color carries state and NOTHING else — never a series, never decoration
 * (war-room rule, and the dataviz spec behind it). It lands on the icon and the
 * accent rail; the label stays in ink, because a state announced in colored text
 * is a state a third of readers have to guess at. Icon + word + color, always
 * all three. */
const ROLE_VAR: Record<StatusRole, string> = {
  good: "var(--war-good)",
  warning: "var(--war-warning)",
  serious: "var(--war-serious)",
  critical: "var(--war-critical)",
};

/* Shape-distinct, not just hue-distinct: filled disc, hollow ring, clock,
 * triangle, stop, query. Printed in greyscale or read by a monochromat, each
 * one is still a different glyph. */
function StateIcon({ kind }: { kind: LoopStateKind }) {
  const base = {
    width: 18,
    height: 18,
    viewBox: "0 0 16 16",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (kind) {
    case "working":
      return (
        <svg {...base}>
          <circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "starving":
      return (
        <svg {...base}>
          <circle cx="8" cy="8" r="5.5" />
        </svg>
      );
    case "stale":
      return (
        <svg {...base}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.6V8.2l2.4 1.4" />
        </svg>
      );
    case "failing":
      return (
        <svg {...base}>
          <path d="M8 2.6 14.4 13.4H1.6z" />
          <path d="M8 6.6v2.6" />
          <path d="M8 11.5h.01" />
        </svg>
      );
    case "down":
      return (
        <svg {...base}>
          <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return (
        <svg {...base}>
          <circle cx="8" cy="8" r="6" />
          <path d="M6.3 6.2a1.8 1.8 0 1 1 2.3 2.5c-.4.3-.6.6-.6 1.05" />
          <path d="M8 11.9h.01" />
        </svg>
      );
  }
}

function Readout({
  label,
  value,
  sub,
  hero = false,
}: {
  label: string;
  value: string;
  sub: string;
  hero?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[13px] text-[var(--war-ink-2)]">{label}</dt>
      <dd
        className={
          hero
            ? "text-[32px] font-semibold leading-none tracking-tight"
            : "text-[26px] font-semibold leading-none tracking-tight"
        }
      >
        {value}
      </dd>
      <dd className="text-xs text-[var(--war-ink-3)]">{sub}</dd>
    </div>
  );
}

export default function LoopStatusPanel({
  status,
  anchor,
}: {
  status: LoopStatus | null;
  anchor: number;
}) {
  const state = loopState(status, anchor);
  const tone = ROLE_VAR[state.role];
  const loop = status?.loop;

  const syncedMs = status ? Date.parse(status.syncedAt) : NaN;
  const days = daysBetween(loop?.lastPassAt ?? null, anchor);
  const nextTick = loop?.scheduler?.nextTickAt ? Date.parse(loop.scheduler.nextTickAt) : NaN;
  const lastPassMs = loop?.lastPassAt ? Date.parse(loop.lastPassAt) : NaN;
  const lastFailMs = loop?.lastFailureAt ? Date.parse(loop.lastFailureAt) : NaN;
  const interval = tickIntervalMs(status);
  const intervalMin = interval ? Math.round(interval / 60_000) : null;

  return (
    <section className="war-card flex h-full flex-col gap-4 p-4" aria-label="Loop status">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">The loop</h2>
        {/* The age of the snapshot is never optional and never small print.
          * Every number below it is frozen at this instant; the clock on this
          * page keeps moving. Showing one without the other is precisely the
          * bug this panel's data file was created to end. */}
        <span className="text-xs text-[var(--war-ink-3)]">
          {Number.isFinite(syncedMs) ? <>snapshot {fmtAgo(syncedMs, anchor)}</> : "no snapshot"}
        </span>
      </div>

      <div
        className="flex items-start gap-3 rounded-md p-3"
        style={{
          background: `color-mix(in srgb, ${tone} 10%, transparent)`,
          boxShadow: `inset 3px 0 0 0 ${tone}`,
        }}
      >
        <span className="mt-px shrink-0" style={{ color: tone }}>
          <StateIcon kind={state.kind} />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold tracking-wide">{state.label}</span>
          <span className="text-xs text-[var(--war-ink-2)]">{state.detail}</span>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        <Readout
          hero
          label="Last pass"
          value={days === null ? "never" : days === 0 ? "today" : `${days}d`}
          sub={
            Number.isFinite(lastPassMs)
              ? `ago · ${fmtDayTime(lastPassMs)} UTC`
              : "no pass has ever been recorded"
          }
        />
        <Readout
          label="Queue"
          value={typeof loop?.queueDepth === "number" ? String(loop.queueDepth) : "—"}
          sub={
            typeof loop?.queueDepth === "number"
              ? loop.queueDepth === 1
                ? "document waiting"
                : "documents waiting"
              : "not reported"
          }
        />
        <Readout
          label="Passes"
          value={String(loop?.passCount ?? 0)}
          sub={`${loop?.processedCount ?? 0} items consumed`}
        />
        <Readout
          label="Doc types"
          value={String(loop?.docTypes?.length ?? 0)}
          sub={loop?.docTypes?.length ? loop.docTypes.join(" · ") : "none recorded"}
        />
        <Readout
          label="Cadence"
          value={intervalMin ? `${intervalMin}m` : loop?.scheduler?.active ? "on" : "—"}
          sub={
            !loop?.scheduler?.active
              ? "scheduler not active"
              : Number.isFinite(nextTick) && nextTick > anchor
                ? `next tick ${fmtAgo(nextTick, anchor)}`
                : "between ticks · snapshot predates the next one"
          }
        />
      </dl>

      <div className="mt-auto border-t border-[var(--war-border)] pt-3 text-xs text-[var(--war-ink-3)]">
        {loop ? (
          <>
            {/* Exit 4 is the resting state of a ten-minute timer over an empty
              * queue, not a fault — the unit lists 0, 2 and 4 as success. It is
              * spelled out rather than shown as a bare code so nobody has to
              * learn a number to read this line. */}
            Last tick{" "}
            {loop.lastTick?.at ? fmtAgo(Date.parse(loop.lastTick.at), anchor) : "unknown"}
            {typeof loop.lastTick?.exit === "number" ? (
              <> · exit {loop.lastTick.exit} — {loop.lastTick.meaning}</>
            ) : null}
            {Number.isFinite(lastFailMs) ? <> · last failure {fmtDayTime(lastFailMs)} UTC</> : null}
            {Number.isFinite(syncedMs) ? (
              <>
                <br />
                Snapshot taken {fmtDate(syncedMs)}, {fmtTime(syncedMs)} UTC, on the loop host — a
                sample, not a feed. It moves when someone runs{" "}
                <code className="text-[var(--war-ink-2)]">npm run sync:loop</code> and commits.
              </>
            ) : null}
          </>
        ) : (
          <>
            No <code className="text-[var(--war-ink-2)]">data/loop-status.json</code> is committed,
            so this panel can report nothing about the loop host.
          </>
        )}
      </div>
    </section>
  );
}
