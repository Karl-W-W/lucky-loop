import type { Metadata } from "next";
import Link from "next/link";
import LoopMark from "./components/site/LoopMark";
import LoopRail from "./components/site/LoopRail";
import PricingCard from "./components/site/PricingCard";
import SiteFooter from "./components/site/SiteFooter";
import { REPO_PUBLIC, getObjectives } from "./war/data";
import { getRuns } from "./loop/data";
import { eur, pricing } from "./lib/legal";

// /loop shipped 2026-07-31: the loop ran end-to-end on a real triage item and
// /loop renders that pass from the artifacts the run itself wrote.
//
// DERIVED, not hardcoded. This was `const LOOP_LIVE = true` — a boolean
// asserting the existence of data it never looked at, so an emptied
// loop-runs.json would still have linked /loop and described it as "pass by
// pass" while /loop rendered its own empty state.
const runs = getRuns();
const LOOP_LIVE = runs.length > 0;
const scheduledCount = runs.filter((r) => r.trigger === "schedule").length;

// Every "one pass recorded" on this page used to be a string literal, in
// three places. They would have kept saying "one" after the second pass —
// the exact shape of the countdown bug: a derived display with no state for
// what happens next.
const passCount = runs.length === 1 ? "one pass" : `${runs.length} passes`;

/* Real-document vs fixture counts come from the same derivation /war shows
 * (scripts/gen-okr-derived.mjs writes them into data/okrs.json O3/KR1 at
 * build), so the price card and the War Room cannot disagree about maturity.
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
  description: `Lucky Loop is an agent harness with a public War Room: a loop that perceives, decides, acts, evaluates and adapts, pointed at the admin that piles up. Built in the open. Hosted for businesses at ${eur(pricing.hosted.monthlyEur)} a month.`,
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
            <Link href="/war">War Room</Link>
            <Link href="/kontakt">Contact</Link>
          </nav>
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
          {/* No claim about WHAT the passes ran on. "on real items" was true
            * of pass one and false the moment a synthetic test document went
            * through — and any fixed description of the mix rots the same way
            * the next time the mix changes. /loop carries the composition,
            * where it can be stated against the actual records. The comment
            * sits OUTSIDE the paragraph: an expression boundary inside the text
            * run once swallowed the space and rendered "andlive". */}
          <p className="ll-sub">
            The War Room, the dashboard we run the business on, is public and
            live. The loop has made{" "}
            {runs.length === 1 ? "its first pass" : `${runs.length} recorded passes`} — you can
            read exactly what each one did.
          </p>
          <p className="ll-thesis">Luck as an engineered outcome.</p>
          {/* The one plain-language line the first screen owes a business
            * owner: what it is, for whom, the price, the exit — each word from
            * data/pricing.json, none beyond real maturity ("tended by a human"). */}
          <p className="ll-hero-offer">
            For businesses: a hosted loop that triages mail and bills, tended by a human —{" "}
            <a href="#pricing">from {eur(pricing.hosted.monthlyEur)} a month, cancel monthly</a>.
          </p>
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
          <div className="ll-strip">
            <div className="ll-strip-row">
              <span className="ll-strip-key">Hosted</span>
              <p className="ll-strip-val">
                A loop of agents that runs a business&rsquo;s recurring admin — mail triage, bills,
                documents — on infrastructure we operate in Munich, with a human tending it. You
                step in only for decisions; they reach you as a queue, one word each.
              </p>
            </div>
            <div className="ll-strip-row">
              <span className="ll-strip-key">Setup</span>
              <p className="ll-strip-val">
                A custom system when the recurring work is yours alone: we map it, write the
                playbook, set up the agents and their checks, and hand you the loop running.
              </p>
            </div>
            <div className="ll-strip-row">
              <span className="ll-strip-key">Today</span>
              <p className="ll-strip-val">
                {/* Every number here is derived at build from committed data — the
                  * same derivation /war renders — and is dated by the snapshot it
                  * came from. No sentence about maturity is typed by hand. */}
                {realPasses !== null && fixturePasses !== null
                  ? `The operator's own admin runs through it: ${realPasses} real-document ${realPasses === 1 ? "pass" : "passes"} (${docTypes.join(", ")}) and ${fixturePasses} synthetic ${fixturePasses === 1 ? "fixture" : "fixtures"} recorded, the first customer loops are set up by hand, and the numbers on `
                  : "The operator's own admin runs through it; the first customer loops are set up by hand, and the numbers on "}
                <Link href="/war">/war</Link> say what runs unattended and what does not.
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
                The War Room. Progress against the objectives, the ops numbers, plus a
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
