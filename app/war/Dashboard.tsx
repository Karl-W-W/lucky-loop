import {
  commitsPerDay,
  daysUntil,
  getDeploys,
  getLedger,
  getLinks,
  getObjectives,
  objectiveProgress,
} from "./data";
import { fmtAgo, fmtDate, fmtTime } from "./format";
import AutoRefresh from "./components/AutoRefresh";
import Clock from "./components/Clock";
import FlowPanel from "./components/FlowPanel";
import LedgerFeed from "./components/LedgerFeed";
import LinksRail from "./components/LinksRail";
import OkrPanel from "./components/OkrPanel";
import StatTile from "./components/StatTile";

export default function Dashboard({ anchor }: { anchor: number }) {
  const objectives = getObjectives();
  const o1 = objectives[0];
  const ledger = getLedger();
  const deploys = getDeploys();
  const perDay = commitsPerDay(anchor);
  const commits7d = perDay.reduce((a, b) => a + b, 0);
  const lastDeploy = deploys.length
    ? deploys.reduce((a, b) => (a.t > b.t ? a : b))
    : null;

  return (
    <div className="war-root min-h-screen font-sans">
      <AutoRefresh />
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
                Lucky Loop · building in public · all times UTC
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--war-ink-2)]">{fmtDate(anchor)}</span>
            <Clock />
          </div>
        </header>

        <div className="flex justify-end">
          <span className="text-xs text-[var(--war-ink-3)]">
            Data as of {fmtTime(anchor)} UTC · refreshed every 5 min
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Days to MVP"
            value={String(daysUntil(o1.due, anchor))}
            hero
            note={`${o1.id} due ${o1.due.slice(5).replace("-", "/")}`}
          />
          <StatTile
            label="MVP progress"
            value={`${Math.round(objectiveProgress(o1) * 100)}%`}
            note={`across ${o1.keyResults.length} key results`}
          />
          <StatTile
            label="Commits · 7d"
            value={String(commits7d)}
            trend={perDay}
            note="per day, UTC"
          />
          <StatTile
            label="Deploys"
            value={String(deploys.length)}
            note={lastDeploy ? `last ${fmtAgo(lastDeploy.t, anchor)}` : "first deploy pending"}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <OkrPanel objectives={objectives} anchor={anchor} />
          </div>
          <LinksRail links={getLinks()} />
          <div className="lg:col-span-3">
            <FlowPanel />
          </div>
          <div className="lg:col-span-3">
            <LedgerFeed entries={ledger} anchor={anchor} />
          </div>
        </div>

        <footer className="pb-2 pt-1 text-center text-[11px] text-[var(--war-ink-3)]">
          Real data from git, Vercel, and data/*.json · Lucky Loop War Room
        </footer>
      </div>
    </div>
  );
}
