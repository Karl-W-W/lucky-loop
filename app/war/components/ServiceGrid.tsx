import type { Service } from "../data";
import { StatusIcon } from "./StatusIcon";

export default function ServiceGrid({ services }: { services: Service[] }) {
  const up = services.filter((s) => s.status === "good").length;
  const attention = services.length - up;

  return (
    <section className="war-card flex flex-col p-4" aria-label="Service status">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Services</h2>
        <span className="text-xs text-[var(--war-ink-3)]">
          {up} operational · {attention} need attention
        </span>
      </div>
      <ul className="flex flex-col">
        {services.map((s) => (
          <li
            key={s.name}
            className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-[var(--war-surface-2)]"
          >
            <StatusIcon role={s.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm">{s.name}</span>
                <span className="text-[11px] text-[var(--war-ink-3)]">{s.region}</span>
              </div>
              <div className="text-[11px] text-[var(--war-ink-2)]">{s.statusLabel}</div>
            </div>
            <div className="text-right text-[11px] leading-4 text-[var(--war-ink-2)]">
              <div className="tabular-nums">{s.p95} ms p95</div>
              <div className="tabular-nums text-[var(--war-ink-3)]">{s.uptime30d} 30d</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
