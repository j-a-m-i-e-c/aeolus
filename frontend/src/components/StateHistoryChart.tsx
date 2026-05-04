// frontend/src/components/StateHistoryChart.tsx — SVG line chart for device state history

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryEntry } from "../lib/api-client";

// ── Aeolus palette ──
const SERIES_COLORS = ["#3BA4FF", "#5CE1E6", "#22C55E", "#F59E0B"];
const GRID_COLOR = "#2A3441";
const TEXT_PRIMARY = "#E6EDF3";
const TEXT_SECONDARY = "#9AA6B2";
const TEXT_MUTED = "#6B7785";
const BG_DARK = "#0B0F14";

// ── Layout constants ──
const PADDING = { top: 16, right: 16, bottom: 36, left: 56 };

interface StateHistoryChartProps {
  data: HistoryEntry[];
  /** Which state keys to chart. If not provided, auto-detect numeric fields. */
  fields?: string[];
  height?: number;
}

interface TooltipData {
  x: number;
  y: number;
  values: { field: string; value: number; color: string }[];
  timestamp: number;
}

/** Extract numeric fields from the first entry that has data */
function detectNumericFields(data: HistoryEntry[]): string[] {
  const fieldSet = new Set<string>();
  for (const entry of data) {
    for (const [key, value] of Object.entries(entry.state)) {
      if (typeof value === "number" && isFinite(value)) {
        fieldSet.add(key);
      }
    }
    if (fieldSet.size > 0) break;
  }
  return Array.from(fieldSet).slice(0, SERIES_COLORS.length);
}

/** Compute nice round tick values for a given data range */
function niceScale(min: number, max: number, targetTicks: number = 5): number[] {
  if (min === max) {
    const v = min;
    return [v - 1, v, v + 1];
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

/** Format a timestamp as relative time (e.g. "5m ago") or absolute HH:MM */
function formatTime(ts: number, now: number): string {
  const diffMs = now - ts;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Format a timestamp for the tooltip */
function formatTooltipTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Build a smooth SVG path using Catmull-Rom → cubic bezier conversion */
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

export function StateHistoryChart({ data, fields, height = 280 }: StateHistoryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [prevData, setPrevData] = useState(data);
  const [animProgress, setAnimProgress] = useState(1);

  // ── Responsive width ──
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

  // ── Animate on data change ──
  useEffect(() => {
    if (data !== prevData) {
      setAnimProgress(0);
      setPrevData(data);
      const start = performance.now();
      const duration = 200; // ms

      function tick(now: number) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // ease-in-out
        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        setAnimProgress(eased);
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
  }, [data, prevData]);

  // ── Resolve fields ──
  const resolvedFields = useMemo(
    () => fields ?? detectNumericFields(data),
    [data, fields],
  );

  // ── Sort data by timestamp ascending ──
  const sorted = useMemo(
    () => [...data].sort((a, b) => a.timestamp - b.timestamp),
    [data],
  );

  // ── Extract series data ──
  const series = useMemo(() => {
    return resolvedFields.map((field, idx) => {
      const points = sorted
        .map((entry) => {
          const val = entry.state[field];
          if (typeof val !== "number" || !isFinite(val)) return null;
          return { timestamp: entry.timestamp, value: val };
        })
        .filter((p): p is { timestamp: number; value: number } => p !== null);

      return {
        field,
        color: SERIES_COLORS[idx % SERIES_COLORS.length],
        points,
      };
    });
  }, [sorted, resolvedFields]);

  // ── Compute scales ──
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
      chartH: height - PADDING.top - PADDING.bottom,
    };
  }, [series, width, height]);

  // ── Map data to SVG coordinates ──
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

  // ── X-axis time labels ──
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

  // ── Hover handler ──
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Convert mouseX to timestamp
      const ts = xMin + ((mouseX - PADDING.left) / chartW) * (xMax - xMin);

      // Find closest data point for each series
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
        // Find the closest timestamp across all series
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

  // ── Empty state ──
  if (data.length === 0 || resolvedFields.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex items-center justify-center rounded-xl"
        style={{ height, background: BG_DARK }}
      >
        <span className="text-sm" style={{ color: TEXT_MUTED }}>
          No history data
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full rounded-xl overflow-hidden" style={{ background: BG_DARK }}>
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 pt-3 pb-1">
        {series.map((s) => (
          <div key={s.field} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-xs" style={{ color: TEXT_SECONDARY, fontFamily: "Inter, sans-serif" }}>
              {s.field}
            </span>
          </div>
        ))}
      </div>

      {/* Chart SVG */}
      <svg
        width={width}
        height={height}
        className="block"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: "crosshair" }}
      >
        <defs>
          {series.map((s, idx) => (
            <linearGradient
              key={`grad-${idx}`}
              id={`area-gradient-${idx}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* Horizontal grid lines + Y-axis labels */}
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
            y={height - 8}
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
          const svgPoints = s.points.map((p) => ({ x: mapX(p.timestamp), y: mapY(p.value) }));
          const linePath = smoothPath(svgPoints);
          const lastPt = svgPoints[svgPoints.length - 1];
          const firstPt = svgPoints[0];
          const areaPath = `${linePath}L${lastPt.x},${PADDING.top + chartH}L${firstPt.x},${PADDING.top + chartH}Z`;

          return (
            <path
              key={`area-${idx}`}
              d={areaPath}
              fill={`url(#area-gradient-${idx})`}
              opacity={animProgress}
              style={{ transition: "opacity 200ms ease-in-out" }}
            />
          );
        })}

        {/* Lines */}
        {series.map((s, idx) => {
          if (s.points.length < 2) return null;
          const svgPoints = s.points.map((p) => ({ x: mapX(p.timestamp), y: mapY(p.value) }));
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
              opacity={animProgress}
              style={{ transition: "opacity 200ms ease-in-out" }}
            />
          );
        })}

        {/* Data points (dots) */}
        {series.map((s, idx) =>
          s.points.map((p, pi) => (
            <circle
              key={`dot-${idx}-${pi}`}
              cx={mapX(p.timestamp)}
              cy={mapY(p.value)}
              r="3"
              fill={BG_DARK}
              stroke={s.color}
              strokeWidth="1.5"
              opacity={animProgress}
              style={{ transition: "opacity 200ms ease-in-out" }}
            />
          )),
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

      {/* Tooltip overlay */}
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
                {typeof v.value === "number" ? v.value.toFixed(1) : String(v.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}