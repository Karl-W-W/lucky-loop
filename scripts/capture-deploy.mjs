#!/usr/bin/env node
/* Build-time capture of the deployment currently being built.
 *
 * WHY THIS EXISTS. `data/deploys.json` is the committed record of Vercel
 * deploys, and the "Prod deploys" tile counts it. A Vercel build cannot commit
 * back to git, so the committed record can only ever describe deploys that
 * happened BEFORE the last commit — which is how the tile came to say "1" while
 * Vercel had shipped four production deploys.
 *
 * Two mechanisms keep the number true, neither of which is "remember to edit
 * the JSON":
 *
 *   1. THIS SCRIPT (automatic, every build). Vercel's system env vars describe
 *      the deployment being built, so the deploy you are looking at is always
 *      counted in the copy of deploys.json that ships inside it.
 *   2. `node scripts/sync-deploys.mjs` (local, authoritative). Rewrites
 *      deploys.json from the Vercel API and is committed. `--check` exits
 *      non-zero on drift — run it before launch.
 *
 * Between commits, (1) alone can only see the current build, so deploys that
 * happened since the last commit of deploys.json would be missed. To cover
 * that gap we also keep a rolling copy in Vercel's build cache (`.next/cache`,
 * restored between builds): each build appends itself, so a later build can see
 * the deploys that came before it. The cache is best-effort — it is cold on the
 * first build and may be evicted — so it can only ever ADD known-real deploys
 * on top of the committed floor; it never removes any. Records are deduped by
 * deployment id.
 *
 * No PII: only deployment id, time, url, target and commit sha are recorded.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEPLOYS_URL = new URL("../data/deploys.json", import.meta.url);
const CACHE_URL = new URL("../.next/cache/lucky-loop-deploys.json", import.meta.url);

function readJsonArray(url) {
  try {
    const parsed = JSON.parse(readFileSync(url, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** A record is only usable if it can be identified and rendered. */
function isValidRecord(d) {
  return Boolean(
    d &&
      typeof d.sha === "string" &&
      d.sha.length >= 7 &&
      typeof d.url === "string" &&
      d.url.startsWith("https://") &&
      typeof d.target === "string" &&
      d.target.length > 0 &&
      Number.isFinite(d.t) &&
      d.t > 0,
  );
}

function sameDeploy(a, b) {
  if (a.id && b.id) return a.id === b.id;
  return a.sha === b.sha && a.target === b.target;
}

/** Merge `extra` into `base` without ever dropping a record from `base`. */
function mergeDeploys(base, extra) {
  const out = base.slice();
  for (const d of extra) {
    if (isValidRecord(d) && !out.some((existing) => sameDeploy(existing, d))) out.push(d);
  }
  return out.sort((a, b) => b.t - a.t);
}

function currentDeployFromEnv() {
  const env = process.env;
  if (env.VERCEL !== "1") return null;
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  const target = env.VERCEL_TARGET_ENV || env.VERCEL_ENV;
  if (!sha || !target) return null;
  // Production serves on the project's production domain; previews on their own.
  const host =
    target === "production"
      ? env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL
      : env.VERCEL_URL || env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) return null;
  return {
    id: env.VERCEL_DEPLOYMENT_ID || "",
    // Build start, not the deployment's `created` — seconds apart. The local
    // reconcile replaces it with the exact API value (deduped by id).
    t: Date.now(),
    url: `https://${host}`,
    target,
    sha,
  };
}

export function captureCurrentDeploy() {
  const current = currentDeployFromEnv();
  if (!current) {
    console.log("deploys: not a Vercel build — data/deploys.json left untouched");
    return;
  }

  const committed = readJsonArray(DEPLOYS_URL).filter(isValidRecord);
  const cached = readJsonArray(CACHE_URL);
  const merged = mergeDeploys(mergeDeploys(committed, cached), [current]);

  writeFileSync(DEPLOYS_URL, JSON.stringify(merged, null, 2) + "\n");

  // Persist for the next build. Best effort: a missing/!writable cache dir is
  // not a build failure, it just means the next build starts from the commit.
  try {
    mkdirSync(dirname(fileURLToPath(CACHE_URL)), { recursive: true });
    writeFileSync(CACHE_URL, JSON.stringify(merged, null, 2) + "\n");
  } catch {
    console.warn("deploys: could not write the build-cache copy (non-fatal)");
  }

  const added = merged.length - committed.length;
  console.log(
    `deploys: ${merged.length} recorded (${committed.length} committed` +
      `${added > 0 ? `, +${added} from this build and the build cache` : ""}) · ` +
      `current ${current.target} ${current.sha.slice(0, 7)}` +
      `${cached.length === 0 ? " · build cache was cold" : ""}`,
  );
}
