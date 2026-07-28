#!/usr/bin/env node
/* Reconcile data/deploys.json with Vercel — the ground truth for the
 * "Prod deploys" tile and the deploy rows of the Growth Ledger.
 *
 * Run it LOCALLY and commit the result. A Vercel build cannot commit back to
 * git, so this is the only path that makes the committed record authoritative
 * (scripts/capture-deploy.mjs covers the gap inside each build).
 *
 *   node scripts/sync-deploys.mjs           rewrite data/deploys.json
 *   node scripts/sync-deploys.mjs --check   exit 1 if the committed file drifts
 *                                           from Vercel (no writes) — run this
 *                                           before a launch/verification pass
 *
 * Auth + ids come from the environment, never from the repo:
 *   VERCEL_TOKEN                    required (a read-scoped token is enough)
 *   VERCEL_PROJECT_ID / ORG_ID      or .vercel/project.json (gitignored,
 *                                   created by `vercel link`)
 *   PROD_URL                        optional; defaults to the production URL
 *                                   already recorded in data/deploys.json
 *
 * Only id/time/url/target/sha are written. Vercel also returns the deploy
 * creator's name and email — those must never reach this repo.
 */
import { readFileSync, writeFileSync } from "node:fs";

const DEPLOYS_URL = new URL("../data/deploys.json", import.meta.url);
const PROJECT_JSON_URL = new URL("../.vercel/project.json", import.meta.url);
const API = "https://api.vercel.com";

function fail(msg) {
  console.error(`sync-deploys: ${msg}`);
  process.exit(1);
}

function readJson(url, fallback) {
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    return fallback;
  }
}

function resolveIds() {
  const linked = readJson(PROJECT_JSON_URL, {});
  const projectId = process.env.VERCEL_PROJECT_ID || linked.projectId;
  const teamId = process.env.VERCEL_ORG_ID || linked.orgId;
  if (!projectId || !teamId) {
    fail(
      "no project ids. Run `vercel link` (writes the gitignored .vercel/project.json) " +
        "or set VERCEL_PROJECT_ID and VERCEL_ORG_ID.",
    );
  }
  return { projectId, teamId };
}

async function fetchProductionDeploys({ projectId, teamId }) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) fail("VERCEL_TOKEN is not set — cannot read the deploy history.");

  const url =
    `${API}/v6/deployments?projectId=${encodeURIComponent(projectId)}` +
    `&teamId=${encodeURIComponent(teamId)}&target=production&state=READY&limit=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) fail(`Vercel API ${res.status} ${res.statusText}`);

  const body = await res.json();
  const raw = body.deployments ?? [];
  return raw
    .filter((d) => d.state === "READY" && d.target === "production" && d.meta?.githubCommitSha)
    .map((d) => ({
      id: d.uid || d.id || "",
      t: d.created ?? d.createdAt,
      target: "production",
      sha: d.meta.githubCommitSha,
    }));
}

function withUrls(deploys, existing) {
  const prodUrl =
    process.env.PROD_URL ||
    existing.find((d) => d.target === "production" && d.url)?.url ||
    "";
  if (!prodUrl) fail("no production URL known — set PROD_URL (e.g. https://example.vercel.app).");
  return deploys
    .map((d) => ({ id: d.id, t: d.t, url: prodUrl, target: d.target, sha: d.sha }))
    .sort((a, b) => b.t - a.t);
}

function fingerprint(list) {
  return list
    .map((d) => `${d.id}|${d.t}|${d.target}|${d.sha}|${d.url}`)
    .sort()
    .join("\n");
}

const check = process.argv.includes("--check");
const existing = readJson(DEPLOYS_URL, []);
const fresh = withUrls(await fetchProductionDeploys(resolveIds()), existing);

if (fingerprint(fresh) === fingerprint(existing)) {
  console.log(`sync-deploys: in sync — ${fresh.length} production deploys.`);
  process.exit(0);
}

const onlyVercel = fresh.filter((f) => !existing.some((e) => e.sha === f.sha && e.t === f.t));
const onlyLocal = existing.filter((e) => !fresh.some((f) => f.sha === e.sha && f.t === e.t));
console.log(
  `sync-deploys: DRIFT — Vercel has ${fresh.length} production deploys, ` +
    `data/deploys.json has ${existing.length}.`,
);
for (const d of onlyVercel) console.log(`  + ${new Date(d.t).toISOString()} ${d.sha.slice(0, 7)}`);
for (const d of onlyLocal) console.log(`  - ${new Date(d.t).toISOString()} ${d.sha.slice(0, 7)}`);

if (check) {
  console.error("sync-deploys: --check failed. Run without --check and commit the result.");
  process.exit(1);
}

writeFileSync(DEPLOYS_URL, JSON.stringify(fresh, null, 2) + "\n");
console.log("sync-deploys: wrote data/deploys.json — commit it.");
