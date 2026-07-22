export type RangeKey = "6h" | "24h" | "3d" | "7d";

export const RANGES: { key: RangeKey; label: string; minutes: number }[] = [
  { key: "6h", label: "Last 6 hours", minutes: 6 * 60 },
  { key: "24h", label: "Last 24 hours", minutes: 24 * 60 },
  { key: "3d", label: "Last 3 days", minutes: 3 * 24 * 60 },
  { key: "7d", label: "Last 7 days", minutes: 7 * 24 * 60 },
];

export const STEP_MIN = 5;
const STEP_MS = STEP_MIN * 60 * 1000;
const SPAN_MIN = 7 * 24 * 60;

export type TrafficPoint = {
  t: number; // bucket end, ms epoch (UTC)
  web: number; // requests/min
  api: number; // requests/min
  errors: number; // errored requests/min
  p95: number; // ms
};

export type StatusRole = "good" | "warning" | "serious" | "critical";

export type Service = {
  name: string;
  status: StatusRole;
  statusLabel: string;
  region: string;
  p95: number;
  uptime30d: string;
};

export type FeedEvent = {
  id: string;
  at: number; // ms epoch (UTC)
  kind: "incident" | "deploy" | "alert" | "note";
  severity?: StatusRole;
  status?: string; // Investigating / Monitoring / Resolved
  title: string;
  detail: string;
  service?: string;
};

export type WarData = {
  anchor: number;
  points: TrafficPoint[]; // full 7 days, 5-min buckets
  services: Service[];
  feed: FeedEvent[]; // newest first
  activeIncidents: { count: number; breakdown: string };
};

/* Deterministic integer-hash noise in [0, 1) — bit-exact on every JS engine,
 * so server render and client hydration can never disagree. */
function noise(seed: number): number {
  let h = Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/* Quantize transcendental results: sin/pow may differ by an ulp across
 * engines, which could flip a Math.round boundary between server and client. */
function q(x: number): number {
  return Math.round(x * 1e9) / 1e9;
}

function diurnal(t: number, phaseMin: number, amp: number): number {
  const m = (t / 60000) % 1440; // minute of UTC day
  return 1 + amp * q(Math.sin(((m - phaseMin) / 1440) * 2 * Math.PI));
}

function weekendFactor(t: number, dip: number): number {
  const dow = Math.floor(t / 86400000 + 4) % 7; // epoch day 0 was a Thursday
  return dow === 0 || dow === 6 ? dip : 1;
}

/* Smooth 0→1→0 ramp across a window. */
function windowRamp(t: number, start: number, end: number): number {
  if (t <= start || t >= end) return 0;
  return q(Math.sin(((t - start) / (end - start)) * Math.PI));
}

function buildPoints(anchor: number): TrafficPoint[] {
  const n = SPAN_MIN / STEP_MIN;
  const start = anchor - SPAN_MIN * 60 * 1000;
  const points: TrafficPoint[] = [];

  // Incident A (resolved): API gateway 5xx spike, 3.2h → 2.1h before now.
  const aStart = anchor - 3.2 * 3600 * 1000;
  const aEnd = anchor - 2.1 * 3600 * 1000;
  // Incident B (ongoing): checkout errors, started 32 min ago.
  const bStart = anchor - 32 * 60 * 1000;
  const bEnd = anchor + STEP_MS;

  for (let i = 1; i <= n; i++) {
    const t = start + i * STEP_MS;
    const b = Math.floor(t / STEP_MS);

    let web =
      3400 *
      diurnal(t, 540, 0.55) *
      weekendFactor(t, 0.74) *
      (0.9 + 0.2 * noise(b * 2 + 1));
    let api =
      2150 *
      diurnal(t, 630, 0.45) *
      weekendFactor(t, 0.85) *
      (0.9 + 0.2 * noise(b * 3 + 7));

    let errRate = 0.006 + 0.004 * noise(b * 5 + 3);
    let p95 =
      182 * q(Math.pow(diurnal(t, 540, 0.55), 0.25)) * (1 + 0.18 * noise(b * 7 + 5));

    const a = windowRamp(t, aStart, aEnd);
    if (a > 0) {
      api *= 1 - 0.45 * a;
      errRate += 0.085 * a;
      p95 *= 1 + 1.6 * a;
    }
    const bb = windowRamp(t, bStart, bEnd);
    if (bb > 0) {
      web *= 1 - 0.07 * bb;
      errRate += 0.032 * bb;
      p95 *= 1 + 0.55 * bb;
    }

    web = Math.round(web);
    api = Math.round(api);
    points.push({
      t,
      web,
      api,
      errors: Math.round((web + api) * errRate),
      p95: Math.round(p95),
    });
  }
  return points;
}

const SERVICES: Service[] = [
  { name: "Web app", status: "good", statusLabel: "Operational", region: "us-east", p95: 96, uptime30d: "99.99%" },
  { name: "API gateway", status: "good", statusLabel: "Operational", region: "us-east", p95: 141, uptime30d: "99.97%" },
  { name: "Checkout", status: "serious", statusLabel: "Degraded", region: "us-east", p95: 438, uptime30d: "99.72%" },
  { name: "Payments", status: "warning", statusLabel: "Watch", region: "eu-west", p95: 210, uptime30d: "99.90%" },
  { name: "Auth", status: "good", statusLabel: "Operational", region: "global", p95: 88, uptime30d: "100.00%" },
  { name: "Database", status: "good", statusLabel: "Operational", region: "us-east", p95: 12, uptime30d: "99.99%" },
  { name: "Search", status: "good", statusLabel: "Operational", region: "us-east", p95: 133, uptime30d: "99.95%" },
  { name: "Edge / CDN", status: "good", statusLabel: "Operational", region: "global", p95: 34, uptime30d: "100.00%" },
];

function buildFeed(anchor: number): FeedEvent[] {
  const ago = (min: number) => anchor - min * 60 * 1000;
  const events: FeedEvent[] = [
    { id: "e1", at: ago(12), kind: "deploy", title: "web@2026.07.22-r3 promoted to 100%", detail: "Canary held 45 min at 5% with error rate at baseline.", service: "Web app" },
    { id: "e2", at: ago(32), kind: "incident", severity: "serious", status: "Investigating", title: "Elevated error rate on checkout API", detail: "Error rate 3.8% vs 0.6% baseline. Rollback of checkout@r118 in progress.", service: "Checkout" },
    { id: "e3", at: ago(48), kind: "alert", severity: "warning", title: "p95 latency above 400 ms on checkout API", detail: "Alerting at 438 ms over a 10-minute window.", service: "Checkout" },
    { id: "e4", at: ago(65), kind: "incident", severity: "warning", status: "Monitoring", title: "Payment webhook delivery delays", detail: "Provider reports elevated queue depth; retries are succeeding.", service: "Payments" },
    { id: "e5", at: ago(126), kind: "incident", severity: "good", status: "Resolved", title: "API gateway 5xx spike resolved", detail: "Root cause: connection pool exhaustion after a config push; change rolled back.", service: "API gateway" },
    { id: "e6", at: ago(155), kind: "note", title: "Status page updated for INC-2412", detail: "Public incident published; next update within 60 minutes.", service: "API gateway" },
    { id: "e7", at: ago(192), kind: "incident", severity: "critical", status: "Investigating", title: "API gateway elevated 5xx", detail: "Error rate peaked at 9.1%; gateway pods restarting under connection pressure.", service: "API gateway" },
    { id: "e8", at: ago(238), kind: "deploy", title: "api@2026.07.22-r7 config push", detail: "Connection pool tuning applied to gateway fleet (later rolled back).", service: "API gateway" },
    { id: "e9", at: ago(1490), kind: "deploy", title: "web@2026.07.21-r2 shipped", detail: "Checkout accessibility fixes and bundle trim (-8% JS).", service: "Web app" },
    { id: "e10", at: ago(1685), kind: "alert", severity: "good", title: "Disk pressure on db-replica-3 cleared", detail: "Autovacuum completed; disk usage back under 70%.", service: "Database" },
    { id: "e11", at: ago(2905), kind: "incident", severity: "good", status: "Resolved", title: "Search indexing lag resolved", detail: "Backfill completed after consumer group rebalance.", service: "Search" },
    { id: "e12", at: ago(4310), kind: "deploy", title: "search@2026.07.19-r5 shipped", detail: "Index compaction schedule moved off peak hours.", service: "Search" },
    { id: "e13", at: ago(6810), kind: "deploy", title: "payments@2026.07.17-r1 shipped", detail: "Webhook retry backoff now jittered.", service: "Payments" },
    { id: "e14", at: ago(9420), kind: "note", title: "Game-day chaos drill completed", detail: "Region failover exercised; RTO 11 min against a 15 min target.", service: "Edge / CDN" },
  ];
  return events.sort((x, y) => y.at - x.at);
}

/* Request-scoped anchor, rounded to the 5-min grid so mock data is
 * deterministic per window and identical between server render and hydration. */
export function currentAnchor(): number {
  return Math.floor(Date.now() / STEP_MS) * STEP_MS;
}

const cache = new Map<number, WarData>();

/* Pure function of the anchor — same output on server and client. */
export function getWarData(anchor: number): WarData {
  const hit = cache.get(anchor);
  if (hit) return hit;
  if (cache.size > 12) cache.clear(); // one entry per 5-min window; keep the map bounded
  const data: WarData = {
    anchor,
    points: buildPoints(anchor),
    services: SERVICES,
    feed: buildFeed(anchor),
    activeIncidents: { count: 2, breakdown: "1 degraded · 1 watch" },
  };
  cache.set(anchor, data);
  return data;
}
