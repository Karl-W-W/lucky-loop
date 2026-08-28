import {
  failureSignals,
  failureState,
  type FailureStateKind,
  type FailureStatus,
  type StatusRole,
} from "../data";
import { fmtAgo, fmtDate, fmtDayTime, fmtTime } from "../format";

/* Status colour carries state and nothing else — same rule as every other panel
 * here. Icon + word + colour, always all three, so the state survives greyscale
 * and survives a monochromat reading it. */
const ROLE_VAR: Record<StatusRole, string> = {
  good: "var(--war-good)",
  warning: "var(--war-warning)",
  serious: "var(--war-serious)",
  critical: "var(--war-critical)",
};

/* Shape-distinct, not hue-distinct: check, clock, query, wave, cross. */
function StateIcon({ kind }: { kind: FailureStateKind }) {
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
    case "quiet":
      return (
        <svg {...base}>
          <circle cx="8" cy="8" r="6" />
          <path d="M5.2 8.3 7.1 10.2 10.9 6" />
        </svg>
      );
    case "stale":
      return (
        <svg {...base}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.6V8.2l2.4 1.4" />
        </svg>
      );
    case "degrading":
      return (
        <svg {...base}>
          <path d="M1.8 9.4c1.6-2.6 3-2.6 4.6 0s3 2.6 4.6 0 3-2.6 3.2-1.4" />
          <path d="M1.8 5.2c1.6-2.6 3-2.6 4.6 0" opacity="0.5" />
        </svg>
      );
    case "failing":
      return (
        <svg {...base}>
          <circle cx="8" cy="8" r="6" />
          <path d="M5.9 5.9 10.1 10.1" />
          <path d="M10.1 5.9 5.9 10.1" />
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
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[13px] text-[var(--war-ink-2)]">{label}</dt>
      <dd
        className="text-[26px] font-semibold leading-none tracking-tight tabular-nums"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </dd>
      <dd className="text-xs text-[var(--war-ink-3)]">{sub}</dd>
    </div>
  );
}

export default function FailurePanel({
  status,
  anchor,
}: {
  status: FailureStatus | null;
  anchor: number;
}) {
  const state = failureState(status, anchor);
  const tone = ROLE_VAR[state.role];
  const syncedMs = status ? Date.parse(status.syncedAt) : NaN;
  const reaps = status?.loopHost.orphanReaps;
  const dead = status?.loopHost.deadMan;
  const units = status?.loopHost.failedUnits;
  const ws = status?.workstation;
  const deadMs = dead?.lastAt ? Date.parse(dead.lastAt) : NaN;
  const signals = failureSignals(status);

  return (
    <section className="war-card flex h-full flex-col gap-4 p-4" aria-label="Failure channel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">What is failing</h2>
        {/* Never optional, never small print — see LoopStatusPanel. */}
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

      {status ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          <Readout
            label="Signals"
            value={String(signals)}
            sub={signals === 0 ? "nothing failing at sample" : "live failure signals"}
            tone={signals > 0 ? ROLE_VAR.critical : undefined}
          />
          <Readout
            label="Sockets reaped"
            value={String(reaps?.today ?? 0)}
            sub={`today · ${reaps?.window ?? 0} in ${status.windowDays}d · ${
              reaps?.distinctSessions ?? 0
            } session(s)`}
            tone={(reaps?.today ?? 0) > 0 ? ROLE_VAR.warning : undefined}
          />
          <Readout
            label="Failed units"
            value={String((units?.named.length ?? 0) + (units?.otherCount ?? 0))}
            sub={
              units?.named.length
                ? units.named.join(" · ")
                : units?.otherCount
                  ? "none of this project's own"
                  : "none"
            }
            tone={(units?.named.length ?? 0) + (units?.otherCount ?? 0) > 0 ? ROLE_VAR.critical : undefined}
          />
          <Readout
            label="Stuck jobs"
            value={String(ws?.failingJobs ?? 0)}
            sub={ws?.kinds.length ? ws.kinds.join(" · ") : "workstation clear"}
            tone={(ws?.failingJobs ?? 0) > 0 ? ROLE_VAR.critical : undefined}
          />
          <Readout
            label="Route deaths"
            value={ws?.routeDeaths === null || ws?.routeDeaths === undefined ? "—" : String(ws.routeDeaths)}
            sub="lifetime · one tunnel drop each"
          />
        </dl>
      ) : null}

      <div className="mt-auto border-t border-[var(--war-border)] pt-3 text-xs text-[var(--war-ink-3)]">
        {status ? (
          <>
            {/* The dead-man's switch is the loop's own last word. One entry from
              * August means it fired once and never again — which is either a
              * healthy loop or a switch nobody wired to anything. Saying WHICH
              * is not something this file can know, so it says the count and the
              * date and stops. */}
            Dead-man&rsquo;s switch:{" "}
            {dead?.entries
              ? `${dead.entries} entr${dead.entries === 1 ? "y" : "ies"}, last ${
                  Number.isFinite(deadMs) ? fmtDayTime(deadMs) : "unknown"
                }`
              : "never fired"}
            {typeof status.loopHost.serviceRestarts === "number" ? (
              <> · chat backend restarts {status.loopHost.serviceRestarts}</>
            ) : null}
            {Number.isFinite(syncedMs) ? (
              <>
                <br />
                Sampled {fmtDate(syncedMs)}, {fmtTime(syncedMs)} UTC by{" "}
                <code className="text-[var(--war-ink-2)]">npm run sync:failures</code> — counts only,
                never a name or a path. It moves when someone runs it and commits, so a quiet panel
                may mean a quiet system or an old sample. The age above tells you which.
              </>
            ) : null}
          </>
        ) : (
          <>
            No <code className="text-[var(--war-ink-2)]">data/failure-status.json</code> is
            committed. Silence here is the absence of a measurement, not the absence of failure —
            the distinction this panel exists to hold.
          </>
        )}
      </div>
    </section>
  );
}
