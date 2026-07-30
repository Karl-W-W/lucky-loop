import Link from "next/link";
import { feedbackEdges, getLoopDef, orderedNodes } from "@/app/loop/data";

/* Was a hardcoded five-element array with a caption admitting it was a
 * placeholder. It now maps over data/loop-def.json, which loop/run.py derives
 * from the compiled LangGraph on every run — so this panel and the loop that
 * actually executes cannot drift apart. Adding a node in loop/graph.py changes
 * this diagram with nobody editing it. */

export default function FlowPanel() {
  const def = getLoopDef();
  const nodes = orderedNodes();
  const feedback = feedbackEdges();

  return (
    <section className="war-card flex flex-col gap-3 p-4" aria-label="Loop flow">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">The Loop</h2>
        <span className="text-xs text-[var(--war-ink-3)]">
          rendered from the {def.framework} definition in{" "}
          <Link href="/loop" className="underline underline-offset-2">
            /loop
          </Link>{" "}
          · v{def.graphVersion}
        </span>
      </div>
      <ol className="flex flex-wrap items-stretch gap-y-3">
        {nodes.map((n, i) => (
          <li key={n.id} className="flex items-center">
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
        {feedback.map((e) => (
          <li key={`${e.from}-${e.to}`} className="flex items-center" aria-hidden>
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
            <span className="text-[11px] text-[var(--war-ink-3)]">↻ back to {e.to}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
