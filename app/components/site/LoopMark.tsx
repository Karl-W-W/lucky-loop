// Brand mark: four arrows closing into a circle — the loop.
// Hand-authored SVG. Decorative: the wordmark beside it carries the name.
const QUARTER_TURNS = [0, 90, 180, 270];

export default function LoopMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {QUARTER_TURNS.map((deg) => (
        <g key={deg} transform={`rotate(${deg} 24 24)`}>
          <path d="M37.95 25.22A14 14 0 0 1 27.62 37.52" />
          <path d="M31.23 38.62 27.62 37.52 30.19 34.76" />
        </g>
      ))}
    </svg>
  );
}
