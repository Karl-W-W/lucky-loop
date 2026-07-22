"use client";

import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { STEP_MIN, type TrafficPoint } from "../data";
import { fmtDayTime, fmtInt, fmtTime, niceTicks } from "../format";

const M = { top: 14, right: 76, bottom: 30, left: 50 };
const HEIGHT = 300;
const SERIES = [
  { key: "web" as const, label: "Web", color: "var(--war-series-1)" },
  { key: "api" as const, label: "API", color: "var(--war-series-2)" },
];

type Bucket = { t: number; web: number; api: number; errors: number };

/* Element-state (callback ref) pattern: the observer re-binds whenever the
 * measured element remounts (e.g. after a Table → Chart toggle). */
function useMeasuredWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    // ResizeObserver delivers an initial callback right after observe(), so
    // no synchronous seed is needed (and the lint rule forbids one).
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

export default function TrafficChart({
  points,
  rangeLabel,
  daySpan,
}: {
  points: TrafficPoint[];
  rangeLabel: string;
  daySpan: boolean; // range > 24h → date-qualified tick labels
}) {
  const [wrapRef, width] = useMeasuredWidth();
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hover, setHover] = useState<number | null>(null);
  const [kbdFocus, setKbdFocus] = useState(false);

  // Downsample to ≤160 buckets so paths stay light at 7d (2016 raw points).
  const k = Math.max(1, Math.ceil(points.length / 160));
  const bucketMin = k * STEP_MIN;
  const buckets = useMemo<Bucket[]>(() => {
    const out: Bucket[] = [];
    // Chunk from the newest edge backwards so the current bucket is always
    // full; any remainder lands on the oldest (least-read) edge.
    for (let end = points.length; end > 0; end -= k) {
      const chunk = points.slice(Math.max(0, end - k), end);
      const mean = (f: (p: TrafficPoint) => number) =>
        Math.round(chunk.reduce((s, p) => s + f(p), 0) / chunk.length);
      out.push({
        t: chunk[chunk.length - 1].t,
        web: mean((p) => p.web),
        api: mean((p) => p.api),
        errors: mean((p) => p.errors),
      });
    }
    return out.reverse();
  }, [points, k]);

  const last = buckets.length - 1;
  const fmtTick = daySpan ? fmtDayTime : fmtTime;

  const ticks = useMemo(
    () => niceTicks(Math.max(...buckets.map((b) => Math.max(b.web, b.api)))),
    [buckets],
  );
  const yMax = ticks[ticks.length - 1];

  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const x = (i: number) => M.left + (last === 0 ? 0 : (plotW * i) / last);
  const y = (v: number) => M.top + plotH * (1 - v / yMax);

  const paths = useMemo(() => {
    if (plotW <= 0) return { web: "", api: "" };
    const path = (key: "web" | "api") =>
      buckets
        .map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(b[key]).toFixed(1)}`)
        .join(" ");
    return { web: path("web"), api: path("api") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, plotW, yMax]);

  // Fewer, wider-spaced labels on narrow viewports so date-qualified ticks
  // never collide.
  const tickFractions = width < 560 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  const xTickIdx = tickFractions.map((f) => Math.round(f * last));

  function onMove(e: ReactPointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const i = Math.round(((e.clientX - rect.left) / rect.width) * last);
    setHover(Math.min(last, Math.max(0, i)));
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (view !== "chart" || buckets.length === 0) return;
    const cur = hover ?? last;
    const move = (i: number) => {
      setHover(Math.min(last, Math.max(0, i)));
      e.preventDefault();
    };
    if (e.key === "ArrowLeft") move(cur - 1);
    else if (e.key === "ArrowRight") move(cur + 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(last);
    else if (e.key === "Escape") setHover(null);
  }

  const h = hover !== null ? buckets[hover] : null;
  const endGap = Math.abs(y(buckets[last].web) - y(buckets[last].api));
  // Tooltip is 184px wide + 14px offset; flip before it would overflow and
  // clamp so the flipped position can never leave the container.
  const tooltipLeft =
    hover === null
      ? 0
      : Math.max(
          4,
          Math.min(width - 188, x(hover) + 198 > width ? x(hover) - 198 : x(hover) + 14),
        );

  return (
    <section className="war-card flex h-full flex-col p-4" aria-label="Traffic chart">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-sm font-semibold">Traffic — requests / min</h2>
          <p className="text-xs text-[var(--war-ink-3)]">
            {rangeLabel} · {bucketMin}-min buckets · UTC
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ul className="flex items-center gap-4" aria-label="Series legend">
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 text-xs text-[var(--war-ink-2)]">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-4 rounded-full"
                  style={{ background: s.color }}
                />
                {s.label}
              </li>
            ))}
          </ul>
          <div className="flex rounded-lg border p-0.5" style={{ borderColor: "var(--war-border)" }}>
            {(["chart", "table"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={
                  "rounded-md px-2.5 py-1 text-[11px] font-medium capitalize " +
                  (view === v
                    ? "bg-[var(--war-surface-2)] text-[var(--war-ink)]"
                    : "text-[var(--war-ink-3)] hover:text-[var(--war-ink-2)]")
                }
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "chart" ? (
        <div
          ref={wrapRef}
          className="relative"
          tabIndex={0}
          role="application"
          onKeyDown={onKey}
          onFocus={() => setKbdFocus(true)}
          onBlur={() => {
            setKbdFocus(false);
            setHover(null);
          }}
          aria-label={`Line chart of Web and API requests per minute, ${rangeLabel}. Use left and right arrow keys to inspect values; the table view lists every bucket.`}
        >
          {/* Announce keyboard-inspected values to screen readers. */}
          <div aria-live="polite" className="sr-only">
            {kbdFocus && h
              ? `${fmtDayTime(h.t)} UTC: Web ${fmtInt(h.web)} requests per minute, API ${fmtInt(
                  h.api,
                )}, ${fmtInt(h.errors)} errored`
              : ""}
          </div>
          {width > 0 && (
            <svg width={width} height={HEIGHT} aria-hidden>
              {/* gridlines + y ticks */}
              {ticks.map((tk) => (
                <g key={tk}>
                  <line
                    x1={M.left}
                    x2={M.left + plotW}
                    y1={y(tk)}
                    y2={y(tk)}
                    stroke={tk === 0 ? "var(--war-axis)" : "var(--war-grid)"}
                    strokeWidth="1"
                  />
                  <text
                    x={M.left - 8}
                    y={y(tk) + 3.5}
                    textAnchor="end"
                    fontSize="11"
                    fill="var(--war-ink-3)"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {fmtInt(tk)}
                  </text>
                </g>
              ))}
              {/* x ticks */}
              {xTickIdx.map((i) => (
                <text
                  key={i}
                  x={x(i)}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--war-ink-3)"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {fmtTick(buckets[i].t)}
                </text>
              ))}
              {/* series */}
              {SERIES.map((s) => (
                <path
                  key={s.key}
                  d={paths[s.key]}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {/* end markers (2px surface ring) + direct end labels when separated */}
              {SERIES.map((s) => (
                <g key={s.key}>
                  <circle
                    cx={x(last)}
                    cy={y(buckets[last][s.key])}
                    r="4.5"
                    fill={s.color}
                    stroke="var(--war-surface)"
                    strokeWidth="2"
                  />
                  {endGap >= 15 && (
                    <text
                      x={x(last) + 10}
                      y={y(buckets[last][s.key]) + 3.5}
                      fontSize="11"
                      fill="var(--war-ink-2)"
                    >
                      {s.label} {fmtInt(buckets[last][s.key])}
                    </text>
                  )}
                </g>
              ))}
              {/* crosshair + hover markers */}
              {h && hover !== null && (
                <g>
                  <line
                    x1={x(hover)}
                    x2={x(hover)}
                    y1={M.top}
                    y2={M.top + plotH}
                    stroke="var(--war-ink-3)"
                    strokeWidth="1"
                  />
                  {SERIES.map((s) => (
                    <circle
                      key={s.key}
                      cx={x(hover)}
                      cy={y(h[s.key])}
                      r="5"
                      fill={s.color}
                      stroke="var(--war-surface)"
                      strokeWidth="2"
                    />
                  ))}
                </g>
              )}
              {/* hit layer — the whole plot, never just the 2px lines */}
              <rect
                x={M.left}
                y={M.top}
                width={plotW}
                height={plotH}
                fill="transparent"
                onPointerMove={onMove}
                onPointerLeave={() => setHover(null)}
              />
            </svg>
          )}
          {/* tooltip: one readout, every series; values lead, labels follow */}
          {h && hover !== null && (
            <div
              className="pointer-events-none absolute z-10 w-[184px] rounded-lg border bg-[var(--war-surface-2)] px-3 py-2 shadow-lg"
              style={{ left: tooltipLeft, top: M.top + 6, borderColor: "var(--war-border)" }}
            >
              <div className="mb-1 text-[11px] text-[var(--war-ink-2)]">
                {fmtDayTime(h.t)} UTC
              </div>
              {SERIES.map((s) => (
                <div key={s.key} className="flex items-center gap-2 py-0.5">
                  <span
                    aria-hidden
                    className="inline-block h-0.5 w-3 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="text-[13px] font-semibold tabular-nums">
                    {fmtInt(h[s.key])}
                  </span>
                  <span className="text-[11px] text-[var(--war-ink-2)]">{s.label}</span>
                </div>
              ))}
              <div className="mt-1 border-t pt-1 text-[11px] text-[var(--war-ink-2)]" style={{ borderColor: "var(--war-border)" }}>
                <span className="tabular-nums">{fmtInt(h.errors)}</span> errored req/min
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          className="max-h-[300px] overflow-auto rounded-lg border"
          style={{ borderColor: "var(--war-border)" }}
          tabIndex={0}
          role="region"
          aria-label="Traffic data table, scrollable"
        >
          <table className="w-full text-[13px]">
            <caption className="sr-only">
              Web and API requests per minute and errored requests, by {bucketMin}-minute bucket, UTC, newest first.
            </caption>
            <thead className="sticky top-0 bg-[var(--war-surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--war-ink-2)]">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Time (UTC)</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Web</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">API</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Errors</th>
              </tr>
            </thead>
            <tbody>
              {[...buckets].reverse().map((b) => (
                <tr key={b.t} className="border-t" style={{ borderColor: "var(--war-grid)" }}>
                  <td className="px-3 py-1.5 tabular-nums text-[var(--war-ink-2)]">{fmtDayTime(b.t)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(b.web)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(b.api)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(b.errors)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
