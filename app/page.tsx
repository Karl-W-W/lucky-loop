import type { Metadata } from "next";
import Link from "next/link";
import LoopMark from "./components/site/LoopMark";
import LoopRail from "./components/site/LoopRail";
import PricingCard from "./components/site/PricingCard";
import SiteFooter from "./components/site/SiteFooter";
import { REPO_PUBLIC, getObjectives } from "./war/data";
import { getRuns } from "./loop/data";

// Karl's ruling of 2026-10-02: /war and /loop left the public site (see the
// redirects in next.config.ts), and the one-time Setup is sold before Hosted.
// The pass counts below are still derived from data/loop-runs.json.
const runs = getRuns();
const scheduledCount = runs.filter((r) => r.trigger === "schedule").length;

// Every "one pass recorded" on this page used to be a string literal, in
// three places. They would have kept saying "one" after the second pass —
// the exact shape of the countdown bug: a derived display with no state for
// what happens next.
const passCount = runs.length === 1 ? "one pass" : `${runs.length} passes`;

/* Real-document vs fixture counts come from the derivation
 * scripts/gen-okr-derived.mjs writes into data/okrs.json O3/KR1 at build, the
 * same numbers the legal gate holds the AGB and Kontakt page to.
 * If the derivation is missing the sentence says so instead of guessing. */
const kr1 = getObjectives()
  .find((o) => o.id === "O3")
  ?.keyResults.find((k) => k.id === "KR1");
const derived = kr1 && kr1.derived ? kr1.derived : null;
const realPasses = derived ? (derived as { passes?: number }).passes ?? null : null;
const fixturePasses = derived ? (derived as { fixturesExcluded?: number }).fixturesExcluded ?? null : null;
const docTypes = derived ? ((derived as { docTypes?: string[] }).docTypes ?? []) : [];

export const metadata: Metadata = {
  title: "Lucky Loop — an agent harness for the admin you'd rather not do",
  description:
    "Lucky Loop is an agent harness: a loop that perceives, decides, acts, evaluates and adapts, pointed at the admin that piles up. Built in the open.",
};

export default function Home() {
  return (
    <main className="ll-home">
      <div className="ll-shell">
        <header className="ll-masthead">
          <LoopMark className="ll-mark" />
          <span className="ll-wordmark">Lucky Loop</span>
          <nav className="ll-masthead-nav" aria-label="Primary">
            <a href="#pricing">Pricing</a>
            <Link href="/kontakt">Contact</Link>
          </nav>
        </header>

        <section className="ll-hero" aria-labelledby="ll-title">
          <p className="ll-eyebrow">Agent harness</p>
          <h1 id="ll-title" className="ll-h1">
            An agent harness for the admin you&rsquo;d rather not do.
          </h1>
          <p className="ll-lead">
            A harness is the scaffolding an agent runs inside: perceive, decide,
            act, evaluate, adapt. Lucky Loop points that loop at the work that
            piles up — mail, bills, admin.
          </p>
          {/* 2026-11-13: the sentence that called the War Room "public and live"
            * and pointed at /loop for each pass left with the dashboards, and
            * the hero's Hosted-only price line left because Setup is sold
            * first now (Karl, 2026-10-02). Removed, not reworded. */}
          <p className="ll-thesis">Luck as an engineered outcome.</p>
        </section>

        <section className="ll-section" aria-labelledby="ll-loop">
          <div className="ll-section-head">
            <h2 id="ll-loop" className="ll-h2">
              The loop
            </h2>
            <p className="ll-note">Five nodes · {passCount} recorded</p>
          </div>
          <LoopRail />
        </section>

        <section className="ll-section" aria-labelledby="ll-offer">
          <div className="ll-section-head">
            <h2 id="ll-offer" className="ll-h2">
              What is sold
            </h2>
            <p className="ll-note">Business customers · one loop per business</p>
          </div>
          {/* Setup first, then Hosted: Karl's answer "setup-first" of 2026-10-02.
            * Order changed, wording not. */}
          <div className="ll-strip">
            <div className="ll-strip-row">
              <span className="ll-strip-key">Setup</span>
              <p className="ll-strip-val">
                A custom system when the recurring work is yours alone: we map it, write the
                playbook, set up the agents and their checks, and hand you the loop running.
              </p>
            </div>
            <div className="ll-strip-row">
              <span className="ll-strip-key">Hosted</span>
              <p className="ll-strip-val">
                A loop of agents that runs a business&rsquo;s recurring admin — mail triage, bills,
                documents — on infrastructure we operate in Munich, with a human tending it. You
                step in only for decisions; they reach you as a queue, one word each.
              </p>
            </div>
            <div className="ll-strip-row">
              <span className="ll-strip-key">Today</span>
              <p className="ll-strip-val">
                {/* Every number here is derived at build from committed data and
                  * is dated by the snapshot it came from. No sentence about
                  * maturity is typed by hand. The closing clause that pointed at
                  * /war left with the dashboard (2026-11-13). */}
                {realPasses !== null && fixturePasses !== null
                  ? `The operator's own admin runs through it: ${realPasses} real-document ${realPasses === 1 ? "pass" : "passes"} (${docTypes.join(", ")}) and ${fixturePasses} synthetic ${fixturePasses === 1 ? "fixture" : "fixtures"} recorded, and the first customer loops are set up by hand.`
                  : "The operator's own admin runs through it; the first customer loops are set up by hand."}
              </p>
            </div>
          </div>
        </section>

        <section className="ll-section" aria-labelledby="ll-pricing">
          <div className="ll-section-head">
            <h2 id="ll-pricing" className="ll-h2">
              Pricing
            </h2>
            <p className="ll-note">Net · EUR · billed via Stripe</p>
          </div>
          <PricingCard />
        </section>

        <section className="ll-section" aria-labelledby="ll-next">
          <div className="ll-section-head">
            <h2 id="ll-next" className="ll-h2">
              What happens next
            </h2>
            <p className="ll-note">Early · {passCount} recorded</p>
          </div>
          <p className="ll-cta-note">
            {/* "real passes" was the same overclaim as the hero's "on real
              * items", missed on the first pass at it: one of the recorded
              * passes ran on a fabricated document. Counted, not characterised. */}
            Nothing to install: a loop is set up and tended for you, on infrastructure we
            operate. {passCount === "one pass" ? "One pass has" : `${runs.length} passes have`} run
            on its operator&rsquo;s own admin, the next ones happen in public, and the build is
            open to read.{" "}
            {scheduledCount > 0
              ? "The loop runs on a schedule and writes what it did back to its operator's vault."
              : "The loop does not run on a schedule yet."}
          </p>
          <div className="ll-cta-row">
            <a className="ll-cta" href="#pricing">
              Start your loop
            </a>
            {REPO_PUBLIC ? (
              <a
                className="ll-cta ll-cta--quiet"
                href="https://github.com/Karl-W-W/lucky-loop"
              >
                Read the source
              </a>
            ) : null}
          </div>
        </section>

        <section className="ll-closer" aria-label="Closing note">
          <span className="ll-closer-rule" aria-hidden />
          <p className="ll-closer-line">
            Luck is preparation meeting opportunity. We build the preparation.
          </p>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
