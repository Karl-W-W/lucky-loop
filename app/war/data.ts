import okrsJson from "@/data/okrs.json";
import ledgerJson from "@/data/ledger.json";
import deploysJson from "@/data/deploys.json";
import linksJson from "@/data/links.json";

/* Real data only — everything on /war derives from versioned JSON in /data
 * (see CLAUDE.md). No mock telemetry. */

export type StatusRole = "good" | "warning" | "serious" | "critical";

export type KeyResult = { id: string; title: string; progress: number; note?: string };
export type Objective = { id: string; title: string; due: string; keyResults: KeyResult[] };
export type Commit = { sha: string; t: number; msg: string };
export type Deploy = { t: number; url: string; target: string; sha: string };
export type LinkItem = { name: string; url: string; note?: string };

export type LedgerEntry = {
  id: string;
  t: number;
  kind: "commit" | "deploy";
  title: string;
  detail?: string;
  href?: string;
};

const STEP_MS = 5 * 60 * 1000;

/* Request-scoped anchor on a 5-min grid: stable within a window, identical
 * between server render and hydration. */
export function currentAnchor(): number {
  return Math.floor(Date.now() / STEP_MS) * STEP_MS;
}

export function getObjectives(): Objective[] {
  return okrsJson.objectives;
}

export function getLinks(): LinkItem[] {
  return linksJson;
}

export function getCommits(): Commit[] {
  return ledgerJson.commits;
}

export function getDeploys(): Deploy[] {
  return deploysJson as Deploy[];
}

const githubUrl = linksJson.find((l) => l.name === "GitHub")?.url ?? "";

export function getLedger(): LedgerEntry[] {
  const commits: LedgerEntry[] = getCommits().map((c) => ({
    id: `c-${c.sha}`,
    t: c.t,
    kind: "commit",
    title: c.msg,
    detail: c.sha.slice(0, 7),
    href: githubUrl ? `${githubUrl}/commit/${c.sha}` : undefined,
  }));
  const deploys: LedgerEntry[] = getDeploys().map((d, i) => ({
    id: `d-${i}-${d.t}`,
    t: d.t,
    kind: "deploy",
    title: `Deployed to ${d.target}`,
    detail: d.url.replace(/^https?:\/\//, ""),
    href: d.url,
  }));
  return [...commits, ...deploys].sort((a, b) => b.t - a.t);
}

/* Commits per UTC day for the trailing `days` days, oldest → newest. */
export function commitsPerDay(anchor: number, days = 7): number[] {
  const day = (x: number) => Math.floor(x / 86400000);
  const today = day(anchor);
  const counts = new Array<number>(days).fill(0);
  for (const c of getCommits()) {
    const idx = days - 1 - (today - day(c.t));
    if (idx >= 0 && idx < days) counts[idx] += 1;
  }
  return counts;
}

export function daysUntil(dateISO: string, anchor: number): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const end = Date.UTC(y, m - 1, d, 23, 59, 59);
  return Math.max(0, Math.ceil((end - anchor) / 86400000));
}

export function objectiveProgress(o: Objective): number {
  if (o.keyResults.length === 0) return 0;
  return o.keyResults.reduce((s, kr) => s + kr.progress, 0) / o.keyResults.length;
}
