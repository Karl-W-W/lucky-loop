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

/* See the note in app/war/page.tsx: openGraph does not compose from a segment's
 * own title/description, so it is restated here or a shared /loop link unfurls
 * under the homepage's title. /loop is the most persuasive page on the site and
 * the one most likely to be linked directly. */
export const metadata: Metadata = {
  title: "The Loop — Lucky Loop",
  description:
    "Every pass the loop has made, rendered from the artifacts it wrote: the LangGraph definition it executed, the assertion it declared, and how it terminated.",
  openGraph: {
    type: "website",
    siteName: "Lucky Loop",
    url: "/loop",
    title: "The Loop — Lucky Loop",
    description:
      "Every pass the loop has made, rendered from the artifacts it wrote: the LangGraph definition it executed, the assertion it declared, and how it terminated.",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Loop — Lucky Loop",
    description:
      "Every pass the loop has made, rendered from the artifacts it wrote: the LangGraph definition it executed, the assertion it declared, and how it terminated.",
  },
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
  /* DERIVED, not asserted — and COUNTED, not universalised.
   *
   * This was `runs.some(r => r.trigger === "schedule")` feeding copy that said
   * "Passes are triggered by a timer, not by hand". One scheduled run made that
   * true of ALL passes, including the attended 2026-07-30 one. Promoting a
   * one-instance fact to a universal claim is the same shape as the countdown
   * and the hardcoded "one pass recorded" — fixed twice already this session.
   *
   * `trigger` is absent on pre-2026-08-11 runs, so those count as unknown, not
   * as manual. */
  const scheduledCount = runs.filter((r) => r.trigger === "schedule").length;
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

        {/* ---------------- everything before the latest ----------------
          * This page rendered getLatestRun() and NOTHING else, so each new pass
          * erased the one before it — run #1 was already invisible the moment
          * the second landed. A feed that deletes yesterday gives nobody a
          * reason to come back tomorrow, and "every pass the loop has made" is
          * what this page's own metadata promises.
          *
          * Collapsed rows on purpose: the newest pass keeps the full node-by-node
          * detail, the history stays scannable. Every field is read off the
          * record — nothing here is a count someone has to remember to update. */}
        {runs.length > 1 && (
          <section className="war-card flex flex-col gap-3 p-4" aria-label="Earlier passes">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Earlier passes</h2>
              <span className="text-xs text-[var(--war-ink-3)]">
                {runs.length - 1} before this one
              </span>
            </div>
            <ol className="flex flex-col">
              {runs.slice(1).map((r) => (
                <li
                  key={r.runId}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t py-2 text-xs first:border-t-0"
                  style={{ borderColor: "var(--war-border)" }}
                >
                  <span className="font-mono text-[11px] text-[var(--war-ink-3)]">{r.runId}</span>
                  <span className="text-[var(--war-ink-2)]">{fmtUtc(r.startedAt)}</span>
                  <span className="font-medium">{String(r.item.docType ?? "document")}</span>
                  <span className="text-[var(--war-ink-3)]">
                    {r.iterations} iteration{r.iterations === 1 ? "" : "s"} ·{" "}
                    {(r.durationMs / 1000).toFixed(1)}s ·{" "}
                    {r.trigger === "schedule" ? "by timer" : r.trigger === "manual" ? "by hand" : "trigger not recorded"}
                  </span>
                  <span
                    className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{
                      background: isConverged(r) ? "var(--war-good)" : "var(--war-critical)",
                      color: "#fff",
                    }}
                  >
                    {r.terminationReason}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ---------------- the honesty note ---------------- */}
        <section className="war-card flex flex-col gap-2 p-4" aria-label="What this page is">
          <h2 className="text-sm font-semibold">What you are looking at</h2>
          <p className="text-xs leading-relaxed text-[var(--war-ink-2)]">
            Documents enter the loop from a gitignored inbox on disk — some real, from
            Karl&rsquo;s own admin pile; some fabricated, to exercise the redaction gates. The
            artifacts below do not record which is which, so do not read a pass as evidence about
            real mail unless it says so. They never reach this repository. The loop runs on
            private hardware against a local model, so no document content leaves the machine and
            no API credential exists anywhere in the loop.
          </p>
          <p className="text-xs leading-relaxed text-[var(--war-ink-2)]">
            Everything above is what survived redaction: typed categories, coarse amount bands, and
            summaries composed in code from those categories. Sender names, amounts, account and
            invoice numbers are removed before the artifact is written, and the writer refuses to
            emit anything that still matches a PII pattern or reuses a proper noun from the source.
            That is why you see &ldquo;cloud-provider&rdquo; and a band rather than a company and a
            number.
          </p>
          {/* This page renders getLatestRun() and nothing else, so without a
            * date and a trigger it presents a 9-day-old attended run as the
            * current state of a live system. Both facts below are static —
            * derived from the artifact, never from a clock — so neither can
            * freeze the way the countdown did. */}
          <p className="text-xs leading-relaxed text-[var(--war-ink-3)]">
            {runs.length} pass{runs.length === 1 ? "" : "es"} recorded · latest{" "}
            {fmtUtc(latest?.startedAt ?? def.generatedAt)} · definition generated{" "}
            {fmtUtc(def.generatedAt)}
          </p>
          <p className="text-xs leading-relaxed text-[var(--war-ink-3)]">
            {scheduledCount > 0
              ? `${scheduledCount} of ${runs.length} recorded ${runs.length === 1 ? "pass was" : "passes were"} started by a timer on the machine that runs the loop rather than by hand, and wrote a decision and an outcome event back to the operator's own vault. The rest were started by hand.`
              : "Every pass so far was started by hand. There is no schedule yet and the loop does not run on its own."}
          </p>
        </section>
      </div>
    </div>
  );
}
