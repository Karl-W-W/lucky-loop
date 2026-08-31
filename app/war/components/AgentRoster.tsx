import { getAgents, getAgentLiveness, agentLimits, heraldGate, type AgentState, type LoopStatus } from "../data";

/* State is a chip: a shape-distinct glyph, a word, and a colour — all three,
 * because any one of them alone fails somebody.
 *
 * These three values are DERIVED (scripts/sync-agent-liveness.mjs), never
 * declared. The roster used to carry a hand-typed `state` that read "live" for
 * two agents with no evidence path at all; that field is gone.
 *
 * "not instrumented" wears ink, not a status colour. It is neither health nor
 * fault — it is the absence of a measurement — and spending a reserved status
 * colour on it would blunt the two that mean something. It is also NOT a
 * fallback: an agent reads this way only because nothing here can observe it,
 * and the row says which. */
const CHIP: Record<AgentState, { tone: string; label: string; glyph: "disc" | "ring" | "slash" }> = {
  live: { tone: "var(--war-good)", label: "live", glyph: "disc" },
  idle: { tone: "var(--war-warning)", label: "idle", glyph: "ring" },
  unknown: { tone: "var(--war-ink-3)", label: "not instrumented", glyph: "slash" },
};

function Glyph({ shape }: { shape: "disc" | "ring" | "slash" }) {
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
  const liveness = getAgentLiveness();
  return (
    <section className="war-card flex h-full flex-col gap-4 p-4" aria-label="Agent roster">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">Who works here</h2>
        {/* Both numbers are DERIVED. A hand-typed count is the same lie as a
          * hand-typed canvas label — see _run_count() in gen-flow.py. */}
        <span className="text-xs text-[var(--war-ink-3)]">
          {agents.length} agents · {agents.filter((a) => a.hermes).length} generated from this file ·{" "}
          {liveness.derivedCount}/{liveness.totalCount} liveness derived at{" "}
          {liveness.syncedAt.replace("T", " ").replace("Z", "Z")}
        </span>
      </div>

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const live = liveness.of(a.id);
          const chip = CHIP[live.state];
          const gate = heraldGate(a, status);
          const limits = agentLimits(a);
          return (
            <li
              key={a.id}
              className="flex flex-col gap-2 rounded-md border border-[var(--war-border)] bg-[var(--war-surface-2)] p-3"
            >
              <div className="flex items-center gap-2">
                <span style={{ color: chip.tone }} className="shrink-0" title={live.evidence}>
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

              {/* Generated agents carry their deployment facts, because those
                * are the ones that used to drift silently: the model actually
                * pinned, and whether this profile can stage at all. */}
              {a.hermes ? (
                <div className="flex flex-col gap-1 rounded border border-[var(--war-border)] bg-[var(--war-surface)] px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] text-[var(--war-ink-3)]">
                    <span className="text-[var(--war-series-1)]">generated</span>
                    <span>{a.hermes.host}</span>
                    <span>·</span>
                    <span>{a.hermes.model}</span>
                  </div>
                  {a.hermes.staging && !a.hermes.staging.available ? (
                    <div className="font-mono text-[10px] text-[var(--war-warning)]">
                      cannot stage from {a.hermes.host}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <p className="text-xs leading-relaxed text-[var(--war-ink-2)]">{a.does}</p>

              {/* The limit is rendered as prominently as the capability. A
                * roster that lists only what agents CAN do is a brochure. For a
                * generated agent these are the exact lines of its own "Never"
                * section — the page and the agent read the same source. */}
              <div className="text-xs leading-relaxed text-[var(--war-ink-3)]">
                <span className="text-[var(--war-ink-2)]">Cannot:</span>{" "}
                {limits.length === 1 ? (
                  limits[0]
                ) : (
                  <ul className="mt-1 flex list-none flex-col gap-1">
                    {limits.map((c, i) => (
                      <li key={i} className="border-l border-[var(--war-axis)] pl-2">
                        {c.replace(/\*\*/g, "").replace(/^Never /, "")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

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
