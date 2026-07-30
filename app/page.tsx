import type { Metadata } from "next";
import Link from "next/link";
import LoopMark from "./components/site/LoopMark";
import LoopRail from "./components/site/LoopRail";

// /loop shipped 2026-07-31: the loop ran end-to-end on a real triage item and
// /loop renders that pass from the artifacts the run itself wrote.
const LOOP_LIVE = true;

export const metadata: Metadata = {
  title: "Lucky Loop — an agent harness for the admin you'd rather not do",
  description:
    "Lucky Loop is an agent harness with a public War Room: a loop that perceives, decides, acts, evaluates and adapts, pointed at the admin that piles up. Built in the open.",
};

export default function Home() {
  return (
    <main className="ll-home">
      <div className="ll-shell">
        <header className="ll-masthead">
          <LoopMark className="ll-mark" />
          <span className="ll-wordmark">Lucky Loop</span>
        </header>

        <section className="ll-hero" aria-labelledby="ll-title">
          <p className="ll-eyebrow">Agent harness · public War Room</p>
          <h1 id="ll-title" className="ll-h1">
            An agent harness for the admin you&rsquo;d rather not do.
          </h1>
          <p className="ll-lead">
            A harness is the scaffolding an agent runs inside: perceive, decide,
            act, evaluate, adapt. Lucky Loop points that loop at the work that
            piles up — mail, bills, admin — and runs it where you can watch.
          </p>
          <p className="ll-sub">
            The War Room, the dashboard we run the company on, is public and
            live. The loop has made its first pass on a real item — you can read
            exactly what it did.
          </p>
          <p className="ll-thesis">Luck as an engineered outcome.</p>
        </section>

        <section className="ll-section" aria-labelledby="ll-loop">
          <div className="ll-section-head">
            <h2 id="ll-loop" className="ll-h2">
              The loop
            </h2>
            <p className="ll-note">Five nodes · running</p>
          </div>
          <LoopRail />
        </section>

        <section className="ll-section" aria-labelledby="ll-where">
          <div className="ll-section-head">
            <h2 id="ll-where" className="ll-h2">
              Where to look
            </h2>
            <p className="ll-note">Public · no login</p>
          </div>

          <div className="ll-strip">
            <div className="ll-strip-row">
              <Link href="/war" className="ll-strip-key">
                /war
              </Link>
              <p className="ll-strip-val">
                The War Room. Progress against the launch objective, plus a
                ledger of commits and deploys. Live now.
              </p>
            </div>
            <div className="ll-strip-row">
              {LOOP_LIVE ? (
                <Link href="/loop" className="ll-strip-key">
                  /loop
                </Link>
              ) : (
                <span className="ll-strip-key ll-strip-key--pending">/loop</span>
              )}
              <p className="ll-strip-val">
                {LOOP_LIVE
                  ? "The loop itself, pass by pass — the graph it ran, and how it terminated."
                  : "Not live yet — being built in the open."}
              </p>
            </div>
          </div>
        </section>

        <section className="ll-closer" aria-label="Closing note">
          <span className="ll-closer-rule" aria-hidden />
          <p className="ll-closer-line">
            Luck is preparation meeting opportunity. We build the preparation.
          </p>
        </section>
      </div>
    </main>
  );
}
