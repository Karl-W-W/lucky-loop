import { dueState, mmdd, objectiveProgress, type Objective } from "../data";

/* Meter per dataviz spec: the unfilled track is a deeper step of the same
 * blue ramp as the fill, so state reads across the whole bar. */
function Meter({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className="h-2 w-full rounded-full"
      style={{ background: "#184f95" }}
    >
      <div
        className="h-2 rounded-full"
        style={{ width: `${pct}%`, background: "var(--war-series-1)" }}
      />
    </div>
  );
}

export default function OkrPanel({
  objectives,
  anchor,
}: {
  objectives: Objective[];
  anchor: number;
}) {
  return (
    <section className="war-card flex h-full flex-col gap-4 p-4" aria-label="Objectives and key results">
      {objectives.map((o) => {
        const due = dueState(o, anchor);
        const left =
          due.kind === "met"
            ? due.metOn
              ? `met ${mmdd(due.metOn)}`
              : "met"
            : due.kind === "due-today"
              ? "due today"
              : due.kind === "ahead"
                ? `${due.days} days left`
                : `${due.days} days past`;
        const pct = Math.round(objectiveProgress(o) * 100);
        return (
          <div key={o.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-sm font-semibold">
                <span className="mr-2 rounded bg-[var(--war-surface-2)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--war-ink-2)]">
                  {o.id}
                </span>
                {o.title}
              </h2>
              <span className="text-xs text-[var(--war-ink-3)]">
                Due {mmdd(o.due)} · {left} ·{" "}
                <span className="text-[var(--war-ink-2)]">{pct}%</span>
              </span>
            </div>
            <ul className="flex flex-col gap-3">
              {o.keyResults.map((kr) => (
                <li key={kr.id} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px]">
                      {kr.title}
                      {kr.note ? (
                        <span className="ml-2 text-[11px] text-[var(--war-ink-3)]">{kr.note}</span>
                      ) : null}
                    </span>
                    <span className="text-[13px] font-semibold">
                      {Math.round(kr.progress * 100)}%
                    </span>
                  </div>
                  <Meter value={kr.progress} label={`${kr.id}: ${kr.title}`} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
