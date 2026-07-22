import type { StatusRole } from "../data";

export const STATUS_COLOR: Record<StatusRole, string> = {
  good: "var(--war-good)",
  warning: "var(--war-warning)",
  serious: "var(--war-serious)",
  critical: "var(--war-critical)",
};

/* Spoken severity for screen readers — the icon shape/color is aria-hidden. */
const SR_WORD: Record<StatusRole, string> = {
  good: "ok",
  warning: "warning",
  serious: "serious",
  critical: "critical",
};

/* Distinct shape per role so state never rides on color alone:
 * good = circle/check, warning = triangle, serious = diamond, critical = octagon. */
export function StatusIcon({ role, size = 14 }: { role: StatusRole; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: STATUS_COLOR[role],
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (role === "good") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.2" />
        <path d="M5.4 8.2l1.8 1.8 3.4-3.8" />
      </svg>
    );
  }
  if (role === "warning") {
    return (
      <svg {...common}>
        <path d="M8 2.2L14.6 13H1.4L8 2.2z" />
        <path d="M8 6.4v3" />
        <circle cx="8" cy="11.4" r="0.4" fill={STATUS_COLOR[role]} stroke="none" />
      </svg>
    );
  }
  if (role === "serious") {
    return (
      <svg {...common}>
        <path d="M8 1.6L14.4 8 8 14.4 1.6 8 8 1.6z" />
        <path d="M8 5.2v3.4" />
        <circle cx="8" cy="10.9" r="0.4" fill={STATUS_COLOR[role]} stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M5.2 1.8h5.6l4 4v5.6l-4 4H5.2l-4-4V5.8l4-4z" transform="translate(0 -0.6) scale(0.97)" />
      <path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" />
    </svg>
  );
}

export function StatusChip({
  role,
  label,
}: {
  role: StatusRole | "neutral";
  label: string;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium text-[var(--war-ink-2)]"
      style={{ borderColor: "var(--war-border)" }}
    >
      {role === "neutral" ? (
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--war-ink-3)]" />
      ) : (
        <>
          <StatusIcon role={role} size={12} />
          <span className="sr-only">{SR_WORD[role]}: </span>
        </>
      )}
      {label}
    </span>
  );
}
