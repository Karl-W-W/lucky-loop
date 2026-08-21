import { getAgents, heraldGate, type AgentState, type LoopStatus } from "../data";

/* State is a chip: a shape-distinct glyph, a word, and a colour — all three,
 * because any one of them alone fails somebody. "on-demand" is deliberately
 * ink, not a status colour: it is neither health nor fault, and spending a
 * reserved status colour on it would blunt the ones that mean something. */
const CHIP: Record<AgentState, { tone: string; label: string; glyph: "disc" | "ring" | "dash" | "slash" }> = {
  live: { tone: "var(--war-good)", label: "live", glyph: "disc" },
  gated: { tone: "var(--war-warning)", label: "gated", glyph: "ring" },
  /* Neither "on demand" nor "dormant" is health or fault, so both wear ink
   * rather than a reserved status colour. Spending good/warning on "a human has
   * to start it" would blunt the two colours that mean something. */
  "on-demand": { tone: "var(--war-ink-3)", label: "on demand", glyph: "dash" },
  dormant: { tone: "var(--war-ink-3)", label: "dormant", glyph: "slash" },
};

function Glyph({ shape }: { shape: "disc" | "ring" | "dash" | "slash" }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none" stroke="currentColor">
      {shape === "disc" ? (
        <circle cx="5" cy="5" r="4" fill="currentColor" stroke="none" />
      ) : shape === "ring" ? (
        <circle cx="5" cy="5" r="3.5" strokeWidth="1.75" />
      ) : shape === "slash" ? (
        <>
          <circle cx="5" cy="5" r="3.5" strokeWidth="1.5" />
          <path d="M2.5 7.5 7.5 2.5" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : (
        <path d="M1.5 5h7" strokeWidth="1.75" strokeLinecap="round" />
      )}
    </svg>
  );
}

export default function AgentRoster({ status }: { status: LoopStatus | null }) {
  const agents = getAgents();
  return (
    <section className="war-card flex h-full flex-col gap-4 p-4" aria-label="Agent roster">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">Who works here</h2>
        <span className="text-xs text-[var(--war-ink-3)]">
          {agents.length} agents · data/agents.json
        </span>
      </div>

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const chip = CHIP[a.state];
          const gate = heraldGate(a, status);
          return (
            <li
              key={a.id}
              className="flex flex-col gap-2 rounded-md border border-[var(--war-border)] bg-[var(--war-surface-2)] p-3"
            >
              <div className="flex items-center gap-2">
                <span style={{ color: chip.tone }} className="shrink-0">
                  <Glyph shape={chip.glyph} />
                </span>
                <span className="text-sm font-semibold">{a.name}</span>
                <span className="ml-auto text-[11px] uppercase tracking-wide text-[var(--war-ink-3)]">
                  {chip.label}
                </span>
              </div>

              <div className="text-xs text-[var(--war-ink-3)]">
                {a.runtime} · {a.cadence}
              </div>

              <p className="text-xs leading-relaxed text-[var(--war-ink-2)]">{a.does}</p>

              {/* The limit is rendered as prominently as the capability. A
                * roster that lists only what agents CAN do is a brochure. */}
              <p className="text-xs leading-relaxed text-[var(--war-ink-3)]">
                <span className="text-[var(--war-ink-2)]">Cannot:</span> {a.cannot}
              </p>

              {gate ? (
                <p className="text-xs" style={{ color: gate.met ? "var(--war-good)" : "var(--war-ink-3)" }}>
                  {gate.met
                    ? `Gate met — ${gate.passes} passes, ${gate.docTypes} doc types. It can be woken.`
                    : `Unlocks at ${gate.needPasses} passes and ${gate.needDocTypes} doc types — now ${gate.passes} and ${gate.docTypes}.`}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-auto border-t border-[var(--war-border)] pt-3 text-xs text-[var(--war-ink-3)]">
        A charter, not a control panel. This page has no API routes and cannot start, stop or
        instruct anything — management stays on the command line. What it can do is state, in
        public, what each agent is permitted to do and what it is never permitted to do.
      </p>
    </section>
  );
}
