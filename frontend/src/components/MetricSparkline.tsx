// frontend/src/components/MetricSparkline.tsx — SVG sparkline chart for metrics history

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Aeolus palette ──
const AEOLUS_BLUE = "#3BA4FF";
const WIND_CYAN = "#5CE1E6";
const SOFT_RED = "#EF4444";
const TEXT_SECONDARY = "#9AA6B2";
const CARD_BG = "#121821";

// ── Layout constants ──
const PADDING = { top: 8, right: 12, bottom: 8, left: 12 };

interface MetricSparklineProps {
  /** Chart title/label */
  label: string;
  /** Primary data points (avg values) */
  data: Array<{ timestamp: number; value: number }>;
  /** Optional peak data points (secondary line) */
  peakData?: Array<{ timestamp: number; value: number }>;
  /** Optional spike markers */
  spikes?: Array<{ at: number; value: number }>;
  /** Current (most recent) value to display prominently */
  currentValue?: number;
  /** Unit suffix (e.g., "MB", "msg/s", "ms") */
  unit?: string;
  /** Chart height in pixels (default 80) */
  height?: number;
  /** Line color override */
  color?: string;
}

/** Format a timestamp for the spike tooltip */
function formatSpikeTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Format the current value with appropriate precision */
function formatValue(value: number, unit?: string): string {
  let formatted: string;
  if (value >= 1000) {
    formatted = value.toFixed(0);
  } else if (value >= 100) {
    formatted = value.toFixed(1);
  } else if (value >= 1) {
    formatted = value.toFixed(1);
  } else {
    formatted = value.toFixed(2);
  }
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Build a smooth SVG path using Catmull-Rom → cubic bezier conversion.
 * Reuses the same interpolation approach as StateHistoryChart.
 */
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

export function MetricSparkline({
  label,
  data,
  peakData,
  spikes,
  currentValue,
  unit,
  height = 80,
  color,
}: MetricSparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  const [hoveredSpike, setHoveredSpike] = useState<{
    at: number;
    value: number;
    x: number;
    y: number;
  } | null>(null);

  const lineColor = color ?? AEOLUS_BLUE;

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

  // ── Sort data by timestamp ──
  const sorted = useMemo(
    () => [...data].sort((a, b) => a.timestamp - b.timestamp),
    [data],
  );

  const sortedPeak = useMemo(
    () => (peakData ? [...peakData].sort((a, b) => a.timestamp - b.timestamp) : []),
    [peakData],
  );

  // ── Compute scales ──
  const { xMin, xMax, yMin, yMax, chartW, chartH } = useMemo(() => {
    const allValues = [
      ...sorted.map((p) => p.value),
      ...sortedPeak.map((p) => p.value),
      ...(spikes ?? []).map((s) => s.value),
    ];
    const allTimes = [
      ...sorted.map((p) => p.timestamp),
      ...sortedPeak.map((p) => p.timestamp),
    ];

    const dataYMin = allValues.length > 0 ? Math.min(...allValues) : 0;
    const dataYMax = allValues.length > 0 ? Math.max(...allValues) : 1;
    // Add 10% padding to y-axis
    const yPad = (dataYMax - dataYMin) * 0.1 || 1;

    return {
      xMin: allTimes.length > 0 ? Math.min(...allTimes) : 0,
      xMax: allTimes.length > 0 ? Math.max(...allTimes) : 1,
      yMin: dataYMin - yPad,
      yMax: dataYMax + yPad,
      chartW: width - PADDING.left - PADDING.right,
      chartH: height - PADDING.top - PADDING.bottom,
    };
  }, [sorted, sortedPeak, spikes, width, height]);

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

  // ── Build SVG paths ──
  const primaryPath = useMemo(() => {
    if (sorted.length < 2) return "";
    const points = sorted.map((p) => ({ x: mapX(p.timestamp), y: mapY(p.value) }));
    return smoothPath(points);
  }, [sorted, mapX, mapY]);

  const peakPath = useMemo(() => {
    if (sortedPeak.length < 2) return "";
    const points = sortedPeak.map((p) => ({ x: mapX(p.timestamp), y: mapY(p.value) }));
    return smoothPath(points);
  }, [sortedPeak, mapX, mapY]);

  // ── Build area fill path ──
  const areaPath = useMemo(() => {
    if (sorted.length < 2) return "";
    const points = sorted.map((p) => ({ x: mapX(p.timestamp), y: mapY(p.value) }));
    const linePath = smoothPath(points);
    const lastPt = points[points.length - 1];
    const firstPt = points[0];
    const bottomY = PADDING.top + chartH;
    return `${linePath}L${lastPt.x},${bottomY}L${firstPt.x},${bottomY}Z`;
  }, [sorted, mapX, mapY, chartH]);

  // ── Spike marker positions ──
  const spikeMarkers = useMemo(() => {
    if (!spikes || spikes.length === 0) return [];
    return spikes.map((spike) => ({
      ...spike,
      cx: mapX(spike.at),
      cy: mapY(spike.value),
    }));
  }, [spikes, mapX, mapY]);

  // ── Unique gradient ID ──
  const gradientId = useMemo(
    () => `sparkline-gradient-${label.replace(/\s+/g, "-").toLowerCase()}`,
    [label],
  );

  // ── Handle empty data ──
  if (!data || data.length === 0) {
    return (
      <div
        ref={containerRef}
        className="w-full rounded-lg border border-[#1E2A3A] p-4"
        style={{ background: CARD_BG }}
      >
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-xs font-medium"
            style={{ color: TEXT_SECONDARY, fontFamily: "Inter, sans-serif" }}
          >
            {label}
          </span>
        </div>
        <div
          className="flex items-center justify-center"
          style={{ height }}
        >
          <span className="text-sm" style={{ color: TEXT_SECONDARY }}>
            No data
          </span>
        </div>
      </div>
    );
  }

  // ── Handle < 2 data points ──
  if (data.length < 2) {
    return (
      <div
        ref={containerRef}
        className="w-full rounded-lg border border-[#1E2A3A] p-4"
        style={{ background: CARD_BG }}
      >
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-xs font-medium"
            style={{ color: TEXT_SECONDARY, fontFamily: "Inter, sans-serif" }}
          >
            {label}
          </span>
          {currentValue !== undefined && (
            <span
              className="text-lg font-semibold"
              style={{ color: "#E6EDF3", fontFamily: "Inter, sans-serif" }}
            >
              {formatValue(currentValue, unit)}
            </span>
          )}
        </div>
        <div
          className="flex items-center justify-center"
          style={{ height }}
        >
          <span className="text-sm" style={{ color: TEXT_SECONDARY }}>
            Not enough data
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg border border-[#1E2A3A] p-4 relative"
      style={{ background: CARD_BG }}
    >
      {/* Header: label + current value */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-xs font-medium"
          style={{ color: TEXT_SECONDARY, fontFamily: "Inter, sans-serif" }}
        >
          {label}
        </span>
        {currentValue !== undefined && (
          <span
            className="text-lg font-semibold"
            style={{ color: "#E6EDF3", fontFamily: "Inter, sans-serif" }}
          >
            {formatValue(currentValue, unit)}
          </span>
        )}
      </div>

      {/* Chart SVG */}
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gradient fill below primary line */}
        {areaPath && (
          <path
            d={areaPath}
            fill={`url(#${gradientId})`}
          />
        )}

        {/* Peak line (secondary, Wind Cyan at 60% opacity) */}
        {peakPath && (
          <path
            d={peakPath}
            fill="none"
            stroke={WIND_CYAN}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.6}
          />
        )}

        {/* Primary line (Aeolus Blue) */}
        {primaryPath && (
          <path
            d={primaryPath}
            fill="none"
            stroke={lineColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Spike markers */}
        {spikeMarkers.map((spike, idx) => (
          <circle
            key={`spike-${idx}`}
            cx={spike.cx}
            cy={spike.cy}
            r={4}
            fill={SOFT_RED}
            className="cursor-pointer"
            onMouseEnter={(e) => {
              const rect = (e.target as SVGCircleElement).ownerSVGElement?.getBoundingClientRect();
              if (rect) {
                setHoveredSpike({
                  at: spike.at,
                  value: spike.value,
                  x: spike.cx,
                  y: spike.cy,
                });
              }
            }}
            onMouseLeave={() => setHoveredSpike(null)}
          />
        ))}
      </svg>

      {/* Spike tooltip */}
      {hoveredSpike && (
        <div
          className="absolute pointer-events-none z-50 rounded-md border px-2 py-1 shadow-lg"
          style={{
            left: Math.min(
              (hoveredSpike.x / width) * 100,
              85,
            ).toString() + "%",
            bottom: `${height - hoveredSpike.y + 24}px`,
            background: "#1A2330",
            borderColor: "#2A3441",
            whiteSpace: "nowrap",
          }}
        >
          <div
            className="text-[10px]"
            style={{ color: TEXT_SECONDARY, fontFamily: "Inter, sans-serif" }}
          >
            {formatSpikeTime(hoveredSpike.at)}
          </div>
          <div
            className="text-xs font-medium"
            style={{ color: SOFT_RED, fontFamily: "Inter, sans-serif" }}
          >
            {formatValue(hoveredSpike.value, unit)}
          </div>
        </div>
      )}
    </div>
  );
}
