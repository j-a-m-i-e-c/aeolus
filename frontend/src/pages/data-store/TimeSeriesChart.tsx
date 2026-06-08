// frontend/src/pages/data-store/TimeSeriesChart.tsx — SVG time-series chart with time range picker and legend

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDataStoreStore, type DataRecord } from "../../store/data-store-store";

// ── Palette ──
const SERIES_COLORS = ["#3BA4FF", "#5CE1E6", "#22C55E", "#F59E0B", "#A855F7", "#EF4444"];
const GRID_COLOR = "#2A3441";
const TEXT_PRIMARY = "#E6EDF3";
const TEXT_SECONDARY = "#9AA6B2";
const TEXT_MUTED = "#6B7785";
const BG_DARK = "#0B0F14";

// ── Layout ──
const PADDING = { top: 16, right: 16, bottom: 36, left: 56 };
const CHART_HEIGHT = 260;

// ── Time range presets ──
const TIME_RANGES = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
];

interface TimeSeriesChartProps {
  records: DataRecord[];
}

interface TooltipData {
  x: number;
  y: number;
  values: { field: string; value: number; color: string }[];
  timestamp: number;
}

/** Auto-detect numeric fields from record payloads */
function detectNumericFields(records: DataRecord[]): string[] {
  const fieldSet = new Set<string>();
  for (const record of records) {
    for (const [key, value] of Object.entries(record.payload)) {
      if (typeof value === "number" && isFinite(value)) {
        fieldSet.add(key);
      }
    }
    if (fieldSet.size > 0) break;
  }
  return Array.from(fieldSet).slice(0, SERIES_COLORS.length);
}

/** Compute nice round tick values */
function niceScale(min: number, max: number, targetTicks: number = 5): number[] {
  if (min === max) {
    return [min - 1, min, min + 1];
  }
  const range = max - min;
  const roughStep = range / (targetTicks - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / magnitude;

  let niceStep: number;
  if (residual <= 1.5) niceStep = magnitude;
  else if (residual <= 3) niceStep = 2 * magnitude;
  else if (residual <= 7) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;

  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + niceStep * 0.5; v += niceStep) {
    ticks.push(parseFloat(v.toPrecision(12)));
  }
  return ticks;
}

/** Format timestamp for x-axis */
function formatTime(ts: number, now: number): string {
  const diffMs = now - ts;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Format timestamp for tooltip */
function formatTooltipTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Build smooth SVG path using Catmull-Rom → cubic bezier conversion */
function smoothPath(points: { x: number; y: number }[], tension: number = 0.3): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`;
  }

  let d = `M${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3;

    d += `C${cp1x},${cp1y},${cp2x},${cp2y},${p2.x},${p2.y}`;
  }

  return d;
}

export function TimeSeriesChart({ records }: TimeSeriesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set());

  const timeRange = useDataStoreStore((s) => s.timeRange);
  const setTimeRange = useDataStoreStore((s) => s.setTimeRange);

  // Responsive width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Sort records by timestamp ascending for charting
  const sorted = useMemo(
    () => [...records].sort((a, b) => a.timestamp - b.timestamp),
    [records],
  );

  // Detect numeric fields
  const allFields = useMemo(() => detectNumericFields(sorted), [sorted]);

  // Visible fields (excluding hidden)
  const visibleFields = useMemo(
    () => allFields.filter((f) => !hiddenFields.has(f)),
    [allFields, hiddenFields],
  );

  // Extract series data
  const series = useMemo(() => {
    return visibleFields.map((field, _idx) => {
      const points = sorted
        .map((record) => {
          const val = record.payload[field];
          if (typeof val !== "number" || !isFinite(val)) return null;
          return { timestamp: record.timestamp, value: val };
        })
        .filter((p): p is { timestamp: number; value: number } => p !== null);

      return {
        field,
        color: SERIES_COLORS[allFields.indexOf(field) % SERIES_COLORS.length],
        points,
      };
    });
  }, [sorted, visibleFields, allFields]);

  // Compute scales
  const { xMin, xMax, yTicks, yMin, yMax, chartW, chartH } = useMemo(() => {
    const allValues = series.flatMap((s) => s.points.map((p) => p.value));
    const allTimes = series.flatMap((s) => s.points.map((p) => p.timestamp));

    const dataYMin = allValues.length > 0 ? Math.min(...allValues) : 0;
    const dataYMax = allValues.length > 0 ? Math.max(...allValues) : 100;
    const ticks = niceScale(dataYMin, dataYMax);

    return {
      xMin: allTimes.length > 0 ? Math.min(...allTimes) : 0,
      xMax: allTimes.length > 0 ? Math.max(...allTimes) : 1,
      yTicks: ticks,
      yMin: ticks[0],
      yMax: ticks[ticks.length - 1],
      chartW: width - PADDING.left - PADDING.right,
      chartH: CHART_HEIGHT - PADDING.top - PADDING.bottom,
    };
  }, [series, width]);

  // Map functions
  const mapX = useCallback(
    (ts: number) => {
      if (xMax === xMin) return PADDING.left + chartW / 2;
      return PADDING.left + ((ts - xMin) / (xMax - xMin)) * chartW;
    },
    [xMin, xMax, chartW],
  );

  const mapY = useCallback(
    (val: number) => {
      if (yMax === yMin) return PADDING.top + chartH / 2;
      return PADDING.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
    },
    [yMin, yMax, chartH],
  );

  // X-axis labels
  const xLabels = useMemo(() => {
    const now = Date.now();
    const count = Math.max(2, Math.min(6, Math.floor(chartW / 100)));
    const labels: { x: number; label: string }[] = [];
    for (let i = 0; i < count; i++) {
      const ts = xMin + (i / (count - 1)) * (xMax - xMin);
      labels.push({ x: mapX(ts), label: formatTime(ts, now) });
    }
    return labels;
  }, [xMin, xMax, chartW, mapX]);

  // Hover handler
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const ts = xMin + ((mouseX - PADDING.left) / chartW) * (xMax - xMin);

      const values: TooltipData["values"] = [];
      for (const s of series) {
        if (s.points.length === 0) continue;
        let closest = s.points[0];
        let minDist = Math.abs(s.points[0].timestamp - ts);
        for (const p of s.points) {
          const dist = Math.abs(p.timestamp - ts);
          if (dist < minDist) {
            minDist = dist;
            closest = p;
          }
        }
        values.push({ field: s.field, value: closest.value, color: s.color });
      }

      if (values.length > 0) {
        let closestTs = sorted[0]?.timestamp ?? ts;
        let minDist = Infinity;
        for (const entry of sorted) {
          const dist = Math.abs(entry.timestamp - ts);
          if (dist < minDist) {
            minDist = dist;
            closestTs = entry.timestamp;
          }
        }
        setTooltip({ x: mouseX, y: mouseY, values, timestamp: closestTs });
      }
    },
    [xMin, xMax, chartW, series, sorted],
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const toggleField = (field: string) => {
    setHiddenFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  };

  // Empty state
  if (records.length === 0 || allFields.length === 0) {
    return (
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 space-y-3">
        {/* Time range picker */}
        <div className="flex items-center gap-1">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => setTimeRange(tr.value)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                timeRange === tr.value
                  ? "bg-primary text-white"
                  : "text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-[#0D1117]"
              }`}
            >
              {tr.label}
            </button>
          ))}
        </div>
        <div
          className="flex items-center justify-center rounded-xl"
          style={{ height: CHART_HEIGHT, background: BG_DARK }}
        >
          <span className="text-sm text-[#6B7785]">
            No numeric data to chart
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 space-y-3">
      {/* Time range picker + Legend */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => setTimeRange(tr.value)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                timeRange === tr.value
                  ? "bg-primary text-white"
                  : "text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-[#0D1117]"
              }`}
            >
              {tr.label}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3">
          {allFields.map((field, idx) => (
            <button
              key={field}
              onClick={() => toggleField(field)}
              className={`flex items-center gap-1.5 text-xs transition-opacity ${
                hiddenFields.has(field) ? "opacity-40" : "opacity-100"
              }`}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{
                  backgroundColor: SERIES_COLORS[idx % SERIES_COLORS.length],
                }}
              />
              <span style={{ color: TEXT_SECONDARY }}>{field}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef} className="w-full rounded-xl overflow-hidden relative" style={{ background: BG_DARK }}>
        <svg
          width={width}
          height={CHART_HEIGHT}
          className="block"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: "crosshair" }}
        >
          <defs>
            {series.map((s, idx) => (
              <linearGradient
                key={`grad-${idx}`}
                id={`ds-area-gradient-${idx}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity="0.2" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {/* Grid lines + Y-axis labels */}
          {yTicks.map((tick) => {
            const y = mapY(tick);
            return (
              <g key={`y-${tick}`}>
                <line
                  x1={PADDING.left}
                  y1={y}
                  x2={PADDING.left + chartW}
                  y2={y}
                  stroke={GRID_COLOR}
                  strokeWidth="1"
                  strokeDasharray="4 3"
                />
                <text
                  x={PADDING.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill={TEXT_MUTED}
                  fontSize="11"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {tick % 1 === 0 ? tick : tick.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* X-axis labels */}
          {xLabels.map((label, i) => (
            <text
              key={`x-${i}`}
              x={label.x}
              y={CHART_HEIGHT - 8}
              textAnchor="middle"
              fill={TEXT_MUTED}
              fontSize="11"
              fontFamily="Inter, sans-serif"
            >
              {label.label}
            </text>
          ))}

          {/* Area fills */}
          {series.map((s, idx) => {
            if (s.points.length < 2) return null;
            const svgPoints = s.points.map((p) => ({
              x: mapX(p.timestamp),
              y: mapY(p.value),
            }));
            const linePath = smoothPath(svgPoints);
            const lastPt = svgPoints[svgPoints.length - 1];
            const firstPt = svgPoints[0];
            const areaPath = `${linePath}L${lastPt.x},${PADDING.top + chartH}L${firstPt.x},${PADDING.top + chartH}Z`;

            return (
              <path
                key={`area-${idx}`}
                d={areaPath}
                fill={`url(#ds-area-gradient-${idx})`}
              />
            );
          })}

          {/* Lines */}
          {series.map((s, idx) => {
            if (s.points.length < 2) return null;
            const svgPoints = s.points.map((p) => ({
              x: mapX(p.timestamp),
              y: mapY(p.value),
            }));
            const d = smoothPath(svgPoints);

            return (
              <path
                key={`line-${idx}`}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Data points */}
          {series.map((s, idx) =>
            s.points.length <= 50
              ? s.points.map((p, pi) => (
                  <circle
                    key={`dot-${idx}-${pi}`}
                    cx={mapX(p.timestamp)}
                    cy={mapY(p.value)}
                    r="2.5"
                    fill={BG_DARK}
                    stroke={s.color}
                    strokeWidth="1.5"
                  />
                ))
              : null,
          )}

          {/* Hover crosshair */}
          {tooltip && (
            <line
              x1={tooltip.x}
              y1={PADDING.top}
              x2={tooltip.x}
              y2={PADDING.top + chartH}
              stroke={TEXT_MUTED}
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.5"
            />
          )}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-50 rounded-lg border px-3 py-2 shadow-lg"
            style={{
              left: Math.min(tooltip.x + 12, width - 180),
              top: tooltip.y - 10,
              background: "#1A2330",
              borderColor: GRID_COLOR,
              transform: "translateY(-100%)",
            }}
          >
            <div
              className="text-[10px] mb-1"
              style={{ color: TEXT_MUTED, fontFamily: "JetBrains Mono, monospace" }}
            >
              {formatTooltipTime(tooltip.timestamp)}
            </div>
            {tooltip.values.map((v) => (
              <div key={v.field} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: v.color }}
                />
                <span style={{ color: TEXT_SECONDARY }}>{v.field}:</span>
                <span
                  style={{ color: TEXT_PRIMARY, fontFamily: "JetBrains Mono, monospace" }}
                >
                  {typeof v.value === "number" ? v.value.toFixed(2) : String(v.value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
