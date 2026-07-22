const STAGES = [
  { name: "Perceive", hint: "read state" },
  { name: "Decide", hint: "plan next move" },
  { name: "Act", hint: "execute tools" },
  { name: "Evaluate", hint: "score outcome" },
  { name: "Adapt", hint: "update memory" },
];

export default function FlowPanel() {
  return (
    <section className="war-card flex flex-col gap-3 p-4" aria-label="Loop flow">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">The Loop</h2>
        <span className="text-xs text-[var(--war-ink-3)]">
          placeholder — renders from the LangGraph definition in /loop once it exists
        </span>
      </div>
      <ol className="flex flex-wrap items-stretch gap-y-3">
        {STAGES.map((s, i) => (
          <li key={s.name} className="flex items-center">
            {i > 0 && (
              <svg
                width="28"
                height="12"
                viewBox="0 0 28 12"
                aria-hidden
                className="mx-1 shrink-0"
              >
                <path
                  d="M2 6h20m0 0l-5-4m5 4l-5 4"
                  fill="none"
                  stroke="var(--war-ink-3)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <div
              className="flex min-w-[7.5rem] flex-col rounded-lg border px-3.5 py-2"
              style={{ borderColor: "var(--war-border)", background: "var(--war-surface-2)" }}
            >
              <span className="text-[13px] font-semibold">
                <span className="mr-1.5 text-[11px] font-normal text-[var(--war-ink-3)]">
                  {i + 1}
                </span>
                {s.name}
              </span>
              <span className="text-[11px] text-[var(--war-ink-2)]">{s.hint}</span>
            </div>
          </li>
        ))}
        <li className="flex items-center" aria-hidden>
          <svg width="28" height="12" viewBox="0 0 28 12" className="mx-1 shrink-0">
            <path
              d="M2 6h20m0 0l-5-4m5 4l-5 4"
              fill="none"
              stroke="var(--war-ink-3)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[11px] text-[var(--war-ink-3)]">↻ back to Perceive</span>
        </li>
      </ol>
    </section>
  );
}
