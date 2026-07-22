"use client";

import { useEffect, useState } from "react";

/* Renders a deterministic placeholder on the server and first client paint,
 * then ticks every second — no hydration mismatch. */
export default function Clock() {
  const [now, setNow] = useState("--:--:--");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    const tick = () => setNow(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-xl font-semibold tabular-nums" suppressHydrationWarning>
      {now} <span className="text-sm font-normal text-[var(--war-ink-3)]">UTC</span>
    </span>
  );
}
