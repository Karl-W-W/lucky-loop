#!/usr/bin/env node
/* Build-time Growth Ledger: git commits → data/ledger.json.
 * Exits 0 without touching the file when git history is unavailable
 * (e.g. Vercel file-based deploys), so the committed ledger ships as-is. */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

try {
  const raw = execSync("git log --pretty=format:%H%x1f%ct%x1f%s -n 200", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const commits = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ct, msg] = line.split("\u001f");
      return { sha, t: Number(ct) * 1000, msg };
    });
  writeFileSync(
    new URL("../data/ledger.json", import.meta.url),
    JSON.stringify({ generatedAt: commits[0]?.t ?? 0, commits }, null, 2) + "\n",
  );
  console.log(`ledger: ${commits.length} commits`);
} catch {
  console.log("ledger: git unavailable, keeping committed data/ledger.json");
}
