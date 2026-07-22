import { RANGES, type RangeKey } from "../data";

export default function RangePicker({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (key: RangeKey) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="war-card inline-flex items-center gap-1 p-1"
    >
      {RANGES.map((r) => {
        const selected = r.key === value;
        return (
          <button
            key={r.key}
            type="button"
            aria-pressed={selected}
            title={r.label}
            onClick={() => onChange(r.key)}
            className={
              "rounded-lg px-3 py-1.5 text-[13px] transition-colors " +
              (selected
                ? "bg-[var(--war-surface-2)] font-semibold text-[var(--war-ink)] shadow-[inset_0_0_0_1px_var(--war-border)]"
                : "text-[var(--war-ink-2)] hover:bg-[var(--war-surface-2)]/60")
            }
          >
            {selected ? (
              <span aria-hidden className="mr-1 font-bold">
                ✓
              </span>
            ) : null}
            {r.key}
          </button>
        );
      })}
    </div>
  );
}
