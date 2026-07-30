import type { ReactNode } from "react";

/* ArchitecturePanel — two labeled architecture diagrams for the War Room.
 *
 *   CURRENT  the build-time JSON pipeline that actually ships today. Derived
 *            from the repo, not from imagination: scripts/gen-ledger.mjs,
 *            data/*.json, app/war/data.ts, app/war/page.tsx.
 *   TARGET   the KR2 loop — the intended shape, not a report on any run.
 *            Rendered with a DESIGN badge, dashed amber borders and a hatched
 *            plane so it can never be read as the live system. Copy here is
 *            scoped to the drawing, never to the state of the world, so it
 *            stays true once the first pass ships.
 *
 * Canonical diagram source: docs/diagrams/current.mmd and
 * docs/diagrams/target.mmd (Mermaid — renders natively on GitHub). The markup
 * below is a hand-authored HTML/SVG twin of those files: no diagram library,
 * no client JS, no new dependency, nothing to hydrate. The two MUST stay
 * structurally identical — same nodes, same edges, same labels. Change one,
 * change the other in the same commit.
 *
 * Server component. No props, no repo imports, no links (a link to /loop
 * would be dead until the loop ships).
 */

/* --war-warning at partial alpha; there is no alpha token for it in
 * globals.css, same pattern as the hardcoded meter track in OkrPanel. */
const DESIGN_LINE = "color-mix(in srgb, var(--war-warning) 55%, transparent)";
const DESIGN_WASH = "color-mix(in srgb, var(--war-warning) 12%, transparent)";
const DESIGN_HATCH =
  "repeating-linear-gradient(135deg, color-mix(in srgb, var(--war-warning) 7%, transparent) 0 5px, transparent 5px 15px)";

function Arrow({ design = false }: { design?: boolean }) {
  const stroke = design ? "var(--war-warning)" : "var(--war-ink-3)";
  return (
    <svg
      width="28"
      height="12"
      viewBox="0 0 28 12"
      aria-hidden
      className="mx-auto my-2 shrink-0 self-center rotate-90 lg:mx-1 lg:my-0 lg:rotate-0"
    >
      <path
        d="M2 6h20"
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={design ? "3 3" : undefined}
      />
      <path
        d="M17 2l5 4l-5 4"
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Badge({ tone, children }: { tone: "live" | "design"; children: ReactNode }) {
  const color = tone === "live" ? "var(--war-good)" : "var(--war-warning)";
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 60%, transparent)`,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

function NodeCard({
  kicker,
  title,
  lines,
  design = false,
  children,
}: {
  kicker: string;
  title: string;
  lines?: string[];
  design?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-1 rounded-lg border px-3 py-2 ${
        design ? "border-dashed" : ""
      }`}
      style={{
        borderColor: design ? DESIGN_LINE : "var(--war-border)",
        background: "var(--war-surface-2)",
      }}
    >
      <span className="text-[10px] uppercase tracking-wider text-[var(--war-ink-3)]">
        {kicker}
      </span>
      <span className="break-words font-mono text-[12px] font-semibold leading-snug">
        {title}
      </span>
      {lines?.map((l) => (
        <span key={l} className="break-words text-[11px] leading-snug text-[var(--war-ink-2)]">
          {l}
        </span>
      ))}
      {children}
    </div>
  );
}

/* ---- CURRENT: nodes mirror docs/diagrams/current.mmd, in order ---------- */

/* Filenames only. Deliberately no per-file "generated / hand-edited" label:
 * how each file is produced can change without the diagram becoming a lie. */
const DATA_FILES = ["okrs.json", "ledger.json", "deploys.json", "links.json"];

/* ---- TARGET: nodes mirror docs/diagrams/target.mmd, in order ------------ */

const STAGES = ["Perceive", "Decide", "Act", "Evaluate", "Adapt"];

export default function ArchitecturePanel() {
  return (
    <section className="war-card flex flex-col gap-5 p-4" aria-label="Architecture">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">Architecture</h2>
        <span className="text-xs text-[var(--war-ink-3)]">
          source of truth: docs/diagrams/*.mmd
        </span>
      </div>

      {/* ================= CURRENT ================= */}
      <figure className="m-0 flex flex-col gap-3">
        <figcaption className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold">Current — static JSON pipeline</h3>
            <Badge tone="live">Running today</Badge>
          </div>
          <p className="text-[11px] leading-snug text-[var(--war-ink-2)]">
            This page is server-rendered from JSON that is committed to the repo and bundled at
            build time. No database, no API routes, no data source at request time.
          </p>
        </figcaption>

        <ol className="flex flex-col lg:flex-row lg:items-stretch">
          <li className="flex min-w-0 flex-col lg:flex-1 lg:basis-0 lg:flex-row lg:items-stretch">
            <NodeCard kicker="source" title="git log" lines={["commit history in this repo"]} />
          </li>
          <li className="flex min-w-0 flex-col lg:flex-1 lg:basis-0 lg:flex-row lg:items-stretch">
            <Arrow />
            <NodeCard
              kicker="build step"
              title="scripts/gen-ledger.mjs"
              lines={["runs as npm prebuild"]}
            />
          </li>
          <li className="flex min-w-0 flex-col lg:flex-[1.4_1_0%] lg:flex-row lg:items-stretch">
            <Arrow />
            <NodeCard
              kicker="committed data"
              title="data/*.json"
              lines={["committed to git; the build step above regenerates ledger.json"]}
            >
              <ul className="mt-0.5 flex flex-wrap gap-1">
                {DATA_FILES.map((f) => (
                  <li
                    key={f}
                    className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-[var(--war-ink-2)]"
                    style={{ borderColor: "var(--war-border)" }}
                  >
                    {f}
                  </li>
                ))}
              </ul>
            </NodeCard>
          </li>
          <li className="flex min-w-0 flex-col lg:flex-1 lg:basis-0 lg:flex-row lg:items-stretch">
            <Arrow />
            <NodeCard
              kicker="accessors"
              title="app/war/data.ts"
              lines={["typed accessors, 5-min time anchor"]}
            />
          </li>
          <li className="flex min-w-0 flex-col lg:flex-1 lg:basis-0 lg:flex-row lg:items-stretch">
            <Arrow />
            <NodeCard kicker="render" title="/war" lines={["Next.js server render on Vercel"]} />
          </li>
        </ol>

        <p className="text-[11px] leading-snug text-[var(--war-ink-3)]">
          When git history is unavailable at build time, gen-ledger.mjs writes nothing and the
          committed ledger.json ships as-is.
        </p>
      </figure>

      <hr className="border-0 border-t" style={{ borderColor: "var(--war-border)" }} />

      {/* ================= TARGET — DESIGN ================= */}
      <figure className="m-0 flex flex-col gap-3">
        <figcaption className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold">Target — the loop (KR2)</h3>
            <Badge tone="design">Design — target shape</Badge>
          </div>
          <p className="text-[11px] leading-snug text-[var(--war-ink-2)]">
            The intended shape of the loop. As of 2026-07-30 one pass of this shape has actually
            run — the record is on /loop. It stays labelled DESIGN because the steady state it
            describes has not: passes are still started by hand, one item at a time, and the
            artifact is carried to the repo by a human. One manual pass is not the system.
          </p>
        </figcaption>

        <div
          className="flex flex-col gap-3 rounded-xl border border-dashed p-3"
          style={{ borderColor: DESIGN_LINE, backgroundImage: DESIGN_HATCH }}
        >
          <p
            className="rounded-md border border-dashed px-2 py-1 text-[11px] font-semibold leading-snug"
            style={{
              borderColor: DESIGN_LINE,
              background: DESIGN_WASH,
              color: "var(--war-warning)",
            }}
          >
            DESIGN — TARGET ARCHITECTURE. One pass of this shape has run; the unattended,
            repeating steady state it describes has not.
          </p>

          <ol className="flex flex-col lg:flex-row lg:items-stretch">
            <li className="flex min-w-0 flex-col lg:flex-1 lg:basis-0 lg:flex-row lg:items-stretch">
              <NodeCard
                design
                kicker="input"
                title="gitignored inbox directory"
                lines={["one exported item", "no live inbox credentials"]}
              />
            </li>
            <li className="flex min-w-0 flex-col lg:flex-[2_1_0%] lg:flex-row lg:items-stretch">
              <Arrow design />
              <NodeCard
                design
                kicker="harness"
                title="LangGraph pass"
                lines={["local runner (Mac or DGX) — not on Vercel"]}
              >
                <ol className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-1">
                  {STAGES.map((s, i) => (
                    <li key={s} className="flex items-center gap-1">
                      {i > 0 ? (
                        <span aria-hidden className="text-[10px] text-[var(--war-warning)]">
                          →
                        </span>
                      ) : null}
                      <span
                        className="rounded border border-dashed px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ borderColor: DESIGN_LINE }}
                      >
                        {s}
                      </span>
                    </li>
                  ))}
                </ol>
                <span className="text-[10px] text-[var(--war-ink-3)]">
                  Adapt retries Decide, or converges
                </span>
              </NodeCard>
            </li>
            <li className="flex min-w-0 flex-col lg:flex-[1.2_1_0%] lg:flex-row lg:items-stretch">
              <Arrow design />
              <NodeCard
                design
                kicker="each pass emits"
                title="sanitized run artifact"
                lines={["redacted before commit, committed to the repo"]}
              />
            </li>
            <li className="flex min-w-0 flex-col lg:flex-1 lg:basis-0 lg:flex-row lg:items-stretch">
              <Arrow design />
              <NodeCard
                design
                kicker="same pipeline as above"
                title="git commit, npm build"
                lines={["committed JSON, like the ledger"]}
              />
            </li>
            <li className="flex min-w-0 flex-col lg:flex-1 lg:basis-0 lg:flex-row lg:items-stretch">
              <Arrow design />
              <NodeCard
                design
                kicker="render"
                title="/loop and /war"
                lines={["render the committed artifact"]}
              />
            </li>
          </ol>

          <div className="flex min-w-0 flex-col gap-1 lg:flex-row lg:items-stretch lg:gap-2">
            <span className="text-[11px] text-[var(--war-ink-3)] lg:self-center">
              <span aria-hidden>↳ </span>the same pass also emits
            </span>
            <NodeCard
              design
              kicker="write-back"
              title="decision + outcome events"
              lines={["private memory vault — never published"]}
            />
          </div>
        </div>
      </figure>
    </section>
  );
}
