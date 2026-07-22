/* All formatting is pinned to en-US + UTC so server and client render
 * identically (war-room convention: everything in UTC). */

const int = new Intl.NumberFormat("en-US");

const timeUTC = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const dayTimeUTC = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const dateUTC = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function fmtInt(n: number): string {
  return int.format(Math.round(n));
}

/* Auto-compact stat-tile values: 8,420 · 12.4K · 1.2M
 * (999,950+ rounds to M so toFixed can never emit "1000.0K") */
export function fmtCompact(n: number): string {
  if (n < 10000) return int.format(Math.round(n));
  if (n < 999950) return `${(n / 1e3).toFixed(1)}K`;
  return `${(n / 1e6).toFixed(1)}M`;
}

export function fmtTime(t: number): string {
  return timeUTC.format(new Date(t));
}

export function fmtDayTime(t: number): string {
  return dayTimeUTC.format(new Date(t));
}

export function fmtDate(t: number): string {
  return dateUTC.format(new Date(t));
}

/* Feed timestamps: same UTC day as the anchor → "14:03", else "Jul 20, 09:12". */
export function fmtFeedTime(t: number, anchor: number): string {
  const day = (x: number) => Math.floor(x / 86400000);
  return day(t) === day(anchor) ? fmtTime(t) : fmtDayTime(t);
}

export function fmtAgo(t: number, anchor: number): string {
  const min = Math.max(1, Math.round((anchor - t) / 60000));
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 >= 15 && h < 10 ? `${h}h ${min % 60}m ago` : `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* Clean y-axis ticks: 0 … niceMax in 3–5 rounded steps. */
export function niceTicks(maxVal: number): number[] {
  const steps = [1, 2, 2.5, 5, 10];
  const target = 4;
  const raw = maxVal / target;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  let step = steps[steps.length - 1] * mag;
  for (const s of steps) {
    if (s * mag >= raw) {
      step = s * mag;
      break;
    }
  }
  const top = Math.ceil(maxVal / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return ticks;
}
