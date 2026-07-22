/* 12-point stat-tile sparkline: de-emphasis hue for the history,
 * accent (series slot 1) for the current period. Bare tile — no hover layer. */
export default function Sparkline({ values }: { values: number[] }) {
  const W = 116;
  const H = 34;
  const PAD = 4;
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => PAD + ((W - 2 * PAD) * i) / (values.length - 1);
  const y = (v: number) => PAD + (H - 2 * PAD) * (1 - (v - min) / span);
  const pt = (i: number) => `${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`;

  const history = values.map((_, i) => pt(i)).join(" ");
  const last = values.length - 1;

  return (
    <svg width={W} height={H} aria-hidden className="shrink-0">
      <polyline
        points={history}
        fill="none"
        stroke="var(--war-ink-3)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1={x(last - 1)}
        y1={y(values[last - 1])}
        x2={x(last)}
        y2={y(values[last])}
        stroke="var(--war-series-1)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle
        cx={x(last)}
        cy={y(values[last])}
        r="4"
        fill="var(--war-series-1)"
        stroke="var(--war-surface)"
        strokeWidth="2"
      />
    </svg>
  );
}
