const ROSTER = [
  { role: "Incident commander", name: "Riley Chen", since: "since 14:05", initials: "RC" },
  { role: "Primary on-call", name: "Sam Okafor", since: "shift ends 20:00", initials: "SO" },
  { role: "Comms lead", name: "Dana Petrov", since: "status page owner", initials: "DP" },
];

export default function OnCall() {
  return (
    <section className="war-card flex h-full flex-col p-4" aria-label="On-call roster">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">On call</h2>
        <span className="text-xs text-[var(--war-ink-3)]">INC-2412 bridge open</span>
      </div>
      <ul className="flex flex-col gap-1">
        {ROSTER.map((p) => (
          <li key={p.role} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--war-surface-2)]">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold text-[var(--war-ink-2)]"
              style={{ borderColor: "var(--war-border)", background: "var(--war-surface-2)" }}
            >
              {p.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm">{p.name}</div>
              <div className="text-[11px] text-[var(--war-ink-3)]">{p.role}</div>
            </div>
            <span className="text-[11px] text-[var(--war-ink-3)]">{p.since}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2 border-t pt-3" style={{ borderColor: "var(--war-border)" }}>
        <a
          href="#bridge"
          className="rounded-lg bg-[var(--war-surface-2)] px-3 py-1.5 text-[13px] font-medium hover:bg-[var(--war-grid)]"
        >
          Join bridge
        </a>
        <a
          href="#runbook"
          className="rounded-lg px-3 py-1.5 text-[13px] text-[var(--war-ink-2)] hover:bg-[var(--war-surface-2)]"
        >
          Runbook
        </a>
      </div>
    </section>
  );
}
