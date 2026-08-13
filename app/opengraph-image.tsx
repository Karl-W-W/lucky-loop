import { ImageResponse } from "next/og";

/* The share card. For a build-in-public launch this is the FIRST thing almost
 * anyone sees — a link unfurled in X, Slack, LinkedIn or Discord — long before
 * they see a page. Until now every share rendered as bare grey text.
 *
 * Palette is the pine/cream/brass brand, not either page system: pine is a
 * `.ll-home` token, so the card belongs to the front door, while being dark
 * enough to stand out in feeds that are overwhelmingly light. It reads as the
 * same product as /war without pretending to be a dashboard screenshot.
 *
 * DELIBERATELY NO PASS COUNT. Every other count on this site is derived from
 * data/loop-runs.json and re-derives on each build, which is the rule. A social
 * card cannot honour that rule: X and Slack cache an unfurled image for days
 * and there is no way to invalidate it, so a number correct at build time goes
 * on being served after it is wrong — on the one surface we cannot correct.
 * The day-after rule says a derived display needs a defined state for after the
 * boundary; the honest state for an uncacheable number is not to publish it. */

export const alt =
  "Lucky Loop — an agent harness for the admin you'd rather not do";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

const CREAM = "#f5f2e9";
const PINE = "#1e3a2f";
const BRASS = "#c9a24b";

// The LoopMark, inlined: four arrows closing into a circle. Satori renders SVG
// through <img>, so the mark ships as a data URI rather than as JSX. Kept in
// sync by hand with app/components/site/LoopMark.tsx — same viewBox, same paths.
const QUARTER_TURNS = [0, 90, 180, 270];

function loopMarkDataUri(stroke: string) {
  const groups = QUARTER_TURNS.map(
    (deg) =>
      `<g transform="rotate(${deg} 24 24)">` +
      `<path d="M37.95 25.22A14 14 0 0 1 27.62 37.52"/>` +
      `<path d="M31.23 38.62 27.62 37.52 30.19 34.76"/>` +
      `</g>`,
  ).join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" ` +
    `stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" ` +
    `stroke-linejoin="round">${groups}</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PINE,
          padding: 72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <img src={loopMarkDataUri(BRASS)} width={92} height={92} alt="" />
          <div
            style={{
              display: "flex",
              fontSize: 44,
              letterSpacing: -0.5,
              color: CREAM,
              fontWeight: 600,
            }}
          >
            Lucky Loop
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div
            style={{
              display: "flex",
              fontSize: 68,
              lineHeight: 1.15,
              letterSpacing: -1.5,
              color: CREAM,
              maxWidth: 940,
            }}
          >
            An agent harness for the admin you&rsquo;d rather not do.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              lineHeight: 1.4,
              color: "#b9c4b6",
              maxWidth: 900,
            }}
          >
            It reads what piles up, decides what each item is, files it, and
            checks its own work — in public, pass by pass.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", width: 56, height: 2, background: BRASS }} />
          <div style={{ display: "flex", fontSize: 24, color: BRASS, letterSpacing: 1 }}>
            Building in public · the War Room is open
          </div>
        </div>
      </div>
    ),
    size,
  );
}
