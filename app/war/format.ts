/* All formatting is pinned to en-US + UTC so server and client render
 * identically (war-room convention: everything in UTC). */

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

const dayUTC = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function fmtTime(t: number): string {
  return timeUTC.format(new Date(t));
}

export function fmtDayTime(t: number): string {
  return dayTimeUTC.format(new Date(t));
}

export function fmtDate(t: number): string {
  return dateUTC.format(new Date(t));
}

/* Short calendar day, e.g. "Jul 27" — for window labels. */
export function fmtDay(t: number): string {
  return dayUTC.format(new Date(t));
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
