"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/* Re-render the force-dynamic page on a cadence so the room stays live. */
export default function AutoRefresh({ everyMs = 5 * 60 * 1000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
