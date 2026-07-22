import Sparkline from "./Sparkline";

export type Delta = { dir: "up" | "down"; text: string; good: boolean };

export default function StatTile({
  label,
  value,
  hero = false,
  delta,
  trend,
  note,
}: {
  label: string;
  value: string;
  hero?: boolean;
  delta?: Delta;
  trend?: number[];
  note?: string;
}) {
  return (
    <div className="war-card flex flex-col gap-1.5 p-4">
      <div className="text-[13px] text-[var(--war-ink-2)]">{label}</div>
      <div className="flex items-end justify-between gap-3">
        <div
          className={
            hero
              ? "text-5xl font-semibold leading-none tracking-tight"
              : "text-[28px] font-semibold leading-none tracking-tight"
          }
        >
          {value}
        </div>
        {trend && trend.length > 1 ? <Sparkline values={trend} /> : null}
      </div>
      {delta ? (
        <div className="flex items-baseline gap-1 text-xs">
          <span
            className="font-medium"
            style={{ color: delta.good ? "var(--war-delta-good)" : "var(--war-danger-text)" }}
          >
            <span aria-hidden>{delta.dir === "up" ? "▲" : "▼"}</span>
            <span className="sr-only">{delta.dir === "up" ? "up" : "down"}</span>{" "}
            {delta.text.split(" vs ")[0]}
          </span>
          <span className="text-[var(--war-ink-3)]">vs {delta.text.split(" vs ")[1]}</span>
        </div>
      ) : null}
      {note ? <div className="text-xs text-[var(--war-ink-3)]">{note}</div> : null}
    </div>
  );
}
