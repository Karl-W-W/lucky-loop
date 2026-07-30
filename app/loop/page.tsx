import type { Metadata } from "next";
import Link from "next/link";
import {
  feedbackEdges,
  fmtUtc,
  getLatestRun,
  getLoopDef,
  getRuns,
  isConverged,
  orderedNodes,
} from "./data";

export const metadata: Metadata = {
  title: "The Loop — Lucky Loop",
  description:
    "Every pass the loop has made, rendered from the artifacts it wrote: the LangGraph definition it executed, the assertion it declared, and how it terminated.",
};

const LABELS: Record<string, string> = {
  chars: "characters",
  lines: "lines",
  amountBucket: "amount band",
  hasDueDate: "due date found",
  issuerKind: "issuer kind",
  docType: "document type",
  humanSummary: "summary",
  runId: "run",
  source: "source",
};

function label(key: string): string {
  return LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function value(v: string | number | boolean): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

export default function LoopPage() {
  const def = getLoopDef();
  const runs = getRuns();
  const latest = getLatestRun();
  const nodes = orderedNodes();
  const feedback = feedbackEdges();

  return (
    <div className="war-root min-h-screen font-sans">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div>
            <h1 className="text-xl font-semibold leading-tight tracking-tight">The Loop</h1>
            <p className="text-xs text-[var(--war-ink-3)]">
              Lucky Loop · {def.framework} v{def.graphVersion} · all times UTC
            </p>
          </div>
          <nav className="flex items-center gap-4 text-xs">
            <Link href="/" className="underline underline-offset-4 hover:opacity-80">
              home
            </Link>
            <Link href="/war" className="underline underline-offset-4 hover:opacity-80">
              war room
            </Link>
          </nav>
        </header>

        {/* ---------------- the definition ---------------- */}
        <section className="war-card flex flex-col gap-3 p-4" aria-label="Loop definition">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Definition</h2>
            <span className="text-xs text-[var(--war-ink-3)]">
              derived from the compiled graph, not drawn
            </span>
          </div>
          <ol className="flex flex-wrap items-stretch gap-y-3">
            {nodes.map((n, i) => (
              <li key={n.id} className="flex items-center">
                {i > 0 && (
                  <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden className="mx-1 shrink-0">
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
                  className="flex min-w-[8rem] flex-col rounded-lg border px-3.5 py-2"
                  style={{ borderColor: "var(--war-border)", background: "var(--war-surface-2)" }}
                >
                  <span className="text-[13px] font-semibold capitalize">
                    <span className="mr-1.5 text-[11px] font-normal text-[var(--war-ink-3)]">
                      {i + 1}
                    </span>
                    {n.id}
                  </span>
                  <span className="text-[11px] text-[var(--war-ink-2)]">{n.hint}</span>
                </div>
              </li>
            ))}
          </ol>
          {feedback.map((e) => (
            <p key={`${e.from}-${e.to}`} className="text-[11px] text-[var(--war-ink-3)]">
              ↻ conditional edge: <span className="capitalize">{e.from}</span> →{" "}
              <span className="capitalize">{e.to}</span> when the declared assertion fails and the
              iteration cap is not yet spent.
            </p>
          ))}
          <p className="text-[11px] text-[var(--war-ink-3)]">
            {def.nodes.length} nodes · {def.edges.length} edges ·{" "}
            {def.assertions.length} declarable assertions · terminates as{" "}
            {def.terminationReasons.join(" | ")} · read from {def.derivedFrom}
          </p>
        </section>

        {/* ---------------- the latest pass ---------------- */}
        {latest ? (
          <section className="war-card flex flex-col gap-4 p-4" aria-label="Latest pass">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">
                Latest pass <span className="font-mono text-xs font-normal">{latest.runId}</span>
              </h2>
              <span
                className="rounded px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  background: isConverged(latest) ? "var(--war-good)" : "var(--war-critical)",
                  color: "#fff",
                }}
              >
                {latest.terminationReason}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
              {[
                ["started", fmtUtc(latest.startedAt)],
                ["duration", `${(latest.durationMs / 1000).toFixed(1)}s`],
                ["iterations", String(latest.iterations)],
                ["model", latest.model],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[var(--war-ink-3)]">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-col gap-2">
              {latest.nodes.map((step, i) => (
                <div
                  key={step.node}
                  className="rounded-lg border p-3"
                  style={{ borderColor: "var(--war-border)", background: "var(--war-surface-2)" }}
                >
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="text-[11px] text-[var(--war-ink-3)]">{i + 1}</span>
                    <span className="text-[13px] font-semibold capitalize">{step.node}</span>
                  </div>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    {Object.entries(step.output).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="shrink-0 text-[var(--war-ink-3)]">{label(k)}</dt>
                        <dd className="font-medium">{value(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="war-card p-4" aria-label="Latest pass">
            <p className="text-sm">
              No pass recorded yet. The loop writes this page; nothing here is hand-authored, so it
              stays empty until a pass actually runs.
            </p>
          </section>
        )}

        {/* ---------------- the honesty note ---------------- */}
        <section className="war-card flex flex-col gap-2 p-4" aria-label="What this page is">
          <h2 className="text-sm font-semibold">What you are looking at</h2>
          <p className="text-xs leading-relaxed text-[var(--war-ink-2)]">
            One real document — a bill from Karl&rsquo;s own admin pile — entered the loop from a
            gitignored inbox on disk. It never reaches this repository. The loop ran on private
            hardware against a local model, so no document content left the machine and no API
            credential exists anywhere in the loop.
          </p>
          <p className="text-xs leading-relaxed text-[var(--war-ink-2)]">
            Everything above is what survived redaction: typed categories, coarse amount bands, and
            summaries composed in code from those categories. Sender names, amounts, account and
            invoice numbers are removed before the artifact is written, and the writer refuses to
            emit anything that still matches a PII pattern or reuses a proper noun from the source.
            That is why you see &ldquo;cloud-provider&rdquo; and a band rather than a company and a
            number.
          </p>
          <p className="text-xs leading-relaxed text-[var(--war-ink-3)]">
            {runs.length} pass{runs.length === 1 ? "" : "es"} recorded · definition generated{" "}
            {fmtUtc(def.generatedAt)}
          </p>
        </section>
      </div>
    </div>
  );
}
