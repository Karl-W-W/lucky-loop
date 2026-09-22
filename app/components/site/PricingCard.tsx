import Link from "next/link";
import { eur, impressum, pricing } from "@/app/lib/legal";

/* The price card — what is sold, to whom, at what price, how it is charged.
 * Every value comes from data/pricing.json (Karl's numbers, 2026-09-22) and
 * scripts/check-legal.mjs refuses a build whose AGB disagree with it. The
 * button is a Stripe Payment Link once Karl pastes one; until then a mailto,
 * because no key or link exists in this repo and none may be invented. */
export default function PricingCard() {
  const { hosted, setup, methods, processor, vatNote, paymentLink } = pricing;
  const mailto = `mailto:${impressum.email}?subject=${encodeURIComponent("Lucky Loop: start my loop")}`;
  return (
    <div className="ll-price" id="pricing">
      <div className="ll-price-main">
        <p className="ll-price-name">{hosted.name}</p>
        <p className="ll-price-amount">
          <span className="ll-price-numeral">{eur(hosted.monthlyEur)}</span>
          <span className="ll-price-per">per month</span>
        </p>
        <span className="ll-price-rule" aria-hidden />
        <p className="ll-price-included">
          One loop for one business, set up and tended for you: the agents, your written playbook, the
          decisions queue you answer from your phone, and a human who reads what the loop did.
        </p>
        <p className="ll-price-setup">
          <span className="ll-price-setup-name">{setup.name}</span>
          <span className="ll-price-setup-amount">from {eur(setup.fromEur)}</span>
          <span className="ll-price-setup-note">one-time · quoted before you order · {setup.refund}</span>
        </p>
      </div>
      <dl className="ll-price-terms">
        <div>
          <dt>Billed</dt>
          <dd>{hosted.billing}, {methods.join(" or ")} via {processor}. {vatNote}</dd>
        </div>
        <div>
          <dt>Cancel</dt>
          <dd>
            {hosted.cancellation}; the paid month runs out. Setup fee {setup.refund}.{" "}
            <Link href="/agb">Terms</Link>
          </dd>
        </div>
        <div>
          <dt>For</dt>
          <dd>
            Businesses only (Unternehmer, § 14 BGB). Sold by {impressum.name}, Munich —{" "}
            <Link href="/impressum">Impressum</Link>.
          </dd>
        </div>
      </dl>
      <div className="ll-cta-row">
        {paymentLink ? (
          <a className="ll-cta" href={paymentLink} rel="noopener noreferrer">
            Start your loop
          </a>
        ) : (
          <a className="ll-cta" href={mailto}>
            Start your loop
          </a>
        )}
        <Link className="ll-cta ll-cta--quiet" href="/kontakt">
          Ask a question
        </Link>
      </div>
      {paymentLink ? null : (
        <p className="ll-price-foot">
          Orders are confirmed by e-mail; payment by {methods.join(" or ")} follows through {processor}.
        </p>
      )}
    </div>
  );
}
