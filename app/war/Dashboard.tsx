"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getWarData, RANGES, STEP_MIN, type RangeKey } from "./data";
import { fmtCompact, fmtDate, fmtTime } from "./format";
import Clock from "./components/Clock";
import IncidentFeed from "./components/IncidentFeed";
import OnCall from "./components/OnCall";
import RangePicker from "./components/RangePicker";
import ServiceGrid from "./components/ServiceGrid";
import StatTile, { type Delta } from "./components/StatTile";
import TrafficChart from "./components/TrafficChart";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function resample(vals: number[], n = 12): number[] {
  if (vals.length < n) return vals;
  const k = vals.length / n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.floor(i * k);
    const e = Math.max(s + 1, Math.floor((i + 1) * k));
    out.push(mean(vals.slice(s, e)));
  }
  return out;
}

function delta(cur: number, prev: number, upIsGood: boolean, vs: string): Delta {
  const pct = ((cur - prev) / prev) * 100;
  const up = pct >= 0;
  return {
    dir: up ? "up" : "down",
    text: `${up ? "+" : ""}${pct.toFixed(1)}% vs ${vs}`,
    good: up === upIsGood,
  };
}

export default function Dashboard({ anchor }: { anchor: number }) {
  const data = useMemo(() => getWarData(anchor), [anchor]);
  const [range, setRange] = useState<RangeKey>("24h");
  const router = useRouter();
  const def = RANGES.find((r) => r.key === range)!;
  const bucketCount = def.minutes / STEP_MIN;

  // Re-render the dynamic page on the data cadence so "refreshed every 5 min"
  // is true: a new anchor arrives and every card re-derives from it.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [router]);

  const view = useMemo(() => {
    const windowPts = data.points.slice(-bucketCount);
    const priorPts = data.points.slice(-2 * bucketCount, -bucketCount);
    const hasPrior = priorPts.length >= bucketCount;
    const vs = `prior ${def.key}`;

    const req = windowPts.map((p) => p.web + p.api);
    const priorReq = priorPts.map((p) => p.web + p.api);
    const lastPt = windowPts[windowPts.length - 1];

    const errPct = (pts: typeof windowPts) => {
      const total = pts.reduce((s, p) => s + p.web + p.api, 0);
      return (pts.reduce((s, p) => s + p.errors, 0) / total) * 100;
    };
    const errNow = errPct(windowPts);
    const errPrior = hasPrior ? errPct(priorPts) : 0;
    const errDiff = errNow - errPrior;

    return {
      windowPts,
      feed: data.feed.filter((e) => e.at >= anchor - def.minutes * 60000),
      reqNow: fmtCompact(lastPt.web + lastPt.api),
      reqDelta: hasPrior ? delta(mean(req), mean(priorReq), true, vs) : undefined,
      reqTrend: resample(req),
      errNow: `${errNow.toFixed(1)}%`,
      errDelta: hasPrior
        ? ({
            dir: errDiff >= 0 ? "up" : "down",
            text: `${errDiff >= 0 ? "+" : ""}${errDiff.toFixed(1)} pp vs ${vs}`,
            good: errDiff <= 0,
          } as Delta)
        : undefined,
      // Trend in the tile's own unit (rate %), matching the value it sits under.
      errTrend: resample(windowPts.map((p) => (p.errors / (p.web + p.api)) * 100)),
      p95Now: `${lastPt.p95} ms`,
      p95Delta: hasPrior
        ? delta(mean(windowPts.map((p) => p.p95)), mean(priorPts.map((p) => p.p95)), false, vs)
        : undefined,
      p95Trend: resample(windowPts.map((p) => p.p95)),
    };
  }, [data, anchor, bucketCount, def.key, def.minutes]);

  return (
    <div className="war-root min-h-screen font-sans">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-[var(--war-good)] opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--war-good)]" />
            </span>
            <span className="sr-only">Live</span>
            <div>
              <h1 className="text-xl font-semibold leading-tight tracking-tight">War Room</h1>
              <p className="text-xs text-[var(--war-ink-3)]">
                Lucky Loop · production · all times UTC
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--war-ink-2)]">{fmtDate(anchor)}</span>
            <Clock />
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <RangePicker value={range} onChange={setRange} />
          <span className="text-xs text-[var(--war-ink-3)]">
            Data as of {fmtTime(anchor)} UTC · refreshed every 5 min
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Active incidents"
            value={String(data.activeIncidents.count)}
            hero
            note={data.activeIncidents.breakdown}
          />
          <StatTile
            label="Requests / min"
            value={view.reqNow}
            delta={view.reqDelta}
            trend={view.reqTrend}
          />
          <StatTile
            label="Error rate"
            value={view.errNow}
            delta={view.errDelta}
            trend={view.errTrend}
          />
          <StatTile
            label="p95 latency"
            value={view.p95Now}
            delta={view.p95Delta}
            trend={view.p95Trend}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <TrafficChart
              points={view.windowPts}
              rangeLabel={def.label}
              daySpan={def.minutes > 24 * 60}
            />
          </div>
          <ServiceGrid services={data.services} />
          <div className="lg:col-span-2">
            <IncidentFeed events={view.feed} anchor={anchor} rangeLabel={def.label} />
          </div>
          <OnCall />
        </div>

        <footer className="pb-2 pt-1 text-center text-[11px] text-[var(--war-ink-3)]">
          Demo telemetry, deterministic per 5-minute window · Lucky Loop War Room
        </footer>
      </div>
    </div>
  );
}
