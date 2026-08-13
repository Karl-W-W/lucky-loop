import { ImageResponse } from "next/og";

/* The browser-tab mark. Replaces the create-next-app scaffold favicon that had
 * shipped untouched since the repo's first commit — a white triangle on black,
 * i.e. Vercel's logo standing in for ours on every open tab and bookmark.
 *
 * Next cannot GENERATE a `favicon.ico` (only `icon`), so app/favicon.ico was
 * removed and this emits <link rel="icon"> instead.
 *
 * Drawn at 64px rather than 32 so downscaling stays crisp, with a heavier
 * stroke than the in-page mark: at tab size the 2.4 stroke of
 * app/components/site/LoopMark.tsx disappears. */

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

const CREAM = "#f5f2e9";
const PINE = "#1e3a2f";

const QUARTER_TURNS = [0, 90, 180, 270];

function markDataUri() {
  const groups = QUARTER_TURNS.map(
    (deg) =>
      `<g transform="rotate(${deg} 24 24)">` +
      `<path d="M37.95 25.22A14 14 0 0 1 27.62 37.52"/>` +
      `<path d="M31.23 38.62 27.62 37.52 30.19 34.76"/>` +
      `</g>`,
  ).join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" ` +
    `stroke="${CREAM}" stroke-width="3.6" stroke-linecap="round" ` +
    `stroke-linejoin="round">${groups}</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: PINE,
          borderRadius: 14,
        }}
      >
        <img src={markDataUri()} width={48} height={48} alt="" />
      </div>
    ),
    size,
  );
}
