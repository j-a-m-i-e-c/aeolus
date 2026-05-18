// frontend/src/components/TimeRangeSelector.tsx — Pill-button toggle for chart time range

export type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d";

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

const TIME_RANGES: TimeRange[] = ["1h", "6h", "24h", "7d", "30d"];

export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="flex items-center gap-1">
      {TIME_RANGES.map((range) => {
        const isActive = range === value;
        return (
          <button
            key={range}
            onClick={() => onChange(range)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={{
              backgroundColor: isActive ? "#3BA4FF" : "transparent",
              color: isActive ? "#FFFFFF" : "#9AA6B2",
            }}
          >
            {range}
          </button>
        );
      })}
    </div>
  );
}
