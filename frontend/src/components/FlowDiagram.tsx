// frontend/src/components/FlowDiagram.tsx — Pure inline SVG flow diagram for structured automations

interface FlowDiagramProps {
  trigger: string;
  conditions: string[];
  actions: string[];
}

const COLORS = {
  bg: "#121821",
  triggerBorder: "#3BA4FF",
  conditionBorder: "#5CE1E6",
  actionBorder: "#2A3441",
  text: "#E6EDF3",
  muted: "#9AA6B2",
  arrow: "#6B7785",
};

const NODE_W = 200;
const NODE_H = 40;
const DIAMOND_SIZE = 50;
const GAP = 50;
const FONT = "'Inter', sans-serif";
const MONO = "'JetBrains Mono', monospace";

/** Truncate text to fit within a node */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

export function FlowDiagram({ trigger, conditions, actions }: FlowDiagramProps) {
  const cx = 140; // center x

  // Layout: vertical flow
  // Trigger → Condition1 → Condition2 → ... → Action1 → Action2 → ...
  let y = 20;

  const triggerY = y;
  y += NODE_H + GAP;

  // Compute condition positions
  const conditionPositions: number[] = [];
  for (const _c of conditions) {
    conditionPositions.push(y);
    y += DIAMOND_SIZE * 2 + GAP;
  }

  // Compute action positions
  const actionPositions: number[] = [];
  for (const _a of actions) {
    actionPositions.push(y);
    y += NODE_H + GAP;
  }

  // "No" branch end point (right side)
  const noEndX = cx + NODE_W / 2 + 60;

  const svgW = NODE_W + 80;
  const svgH = y;

  // First target after trigger: first condition or first action
  const firstTargetY = conditions.length > 0 ? conditionPositions[0] : (actionPositions[0] ?? y);
  // First action Y for condition → action arrows
  const firstActionY = actionPositions[0] ?? y;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{ background: COLORS.bg }}
      role="img"
      aria-label="Automation flow diagram"
    >
      {/* Arrow marker */}
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill={COLORS.arrow} />
        </marker>
      </defs>

      {/* Trigger node — rounded rect */}
      <rect
        x={cx - NODE_W / 2}
        y={triggerY}
        width={NODE_W}
        height={NODE_H}
        rx={12}
        ry={12}
        fill="none"
        stroke={COLORS.triggerBorder}
        strokeWidth={2}
      />
      <text
        x={cx}
        y={triggerY + NODE_H / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={COLORS.text}
        fontFamily={MONO}
        fontSize={11}
      >
        {truncate(trigger, 26)}
      </text>

      {/* Arrow: Trigger → first target */}
      <line
        x1={cx}
        y1={triggerY + NODE_H}
        x2={cx}
        y2={firstTargetY}
        stroke={COLORS.arrow}
        strokeWidth={1.5}
        markerEnd="url(#arrowhead)"
      />

      {/* Condition diamonds */}
      {conditions.map((cond, i) => {
        const cY = conditionPositions[i];
        const noEndY = cY + DIAMOND_SIZE;
        // Next target: next condition, or first action
        const nextY = i < conditions.length - 1
          ? conditionPositions[i + 1]
          : firstActionY;

        return (
          <g key={`cond-${i}`}>
            {/* Diamond */}
            <polygon
              points={`${cx},${cY} ${cx + DIAMOND_SIZE},${cY + DIAMOND_SIZE} ${cx},${cY + DIAMOND_SIZE * 2} ${cx - DIAMOND_SIZE},${cY + DIAMOND_SIZE}`}
              fill="none"
              stroke={COLORS.conditionBorder}
              strokeWidth={2}
            />
            <text
              x={cx}
              y={cY + DIAMOND_SIZE}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={COLORS.text}
              fontFamily={FONT}
              fontSize={10}
            >
              {truncate(cond, 18)}
            </text>

            {/* "Yes" arrow: Condition → next */}
            <line
              x1={cx}
              y1={cY + DIAMOND_SIZE * 2}
              x2={cx}
              y2={nextY}
              stroke={COLORS.arrow}
              strokeWidth={1.5}
              markerEnd="url(#arrowhead)"
            />
            <text
              x={cx + 8}
              y={cY + DIAMOND_SIZE * 2 + 14}
              fill={COLORS.muted}
              fontFamily={FONT}
              fontSize={9}
            >
              Yes
            </text>

            {/* "No" arrow: Condition → right side (end) */}
            <line
              x1={cx + DIAMOND_SIZE}
              y1={cY + DIAMOND_SIZE}
              x2={noEndX}
              y2={noEndY}
              stroke={COLORS.arrow}
              strokeWidth={1.5}
              markerEnd="url(#arrowhead)"
            />
            <text
              x={cx + DIAMOND_SIZE + 6}
              y={noEndY - 6}
              fill={COLORS.muted}
              fontFamily={FONT}
              fontSize={9}
            >
              No
            </text>
          </g>
        );
      })}

      {/* Action nodes — rects */}
      {actions.map((action, i) => {
        const aY = actionPositions[i];
        const nextActionY = i < actions.length - 1 ? actionPositions[i + 1] : null;

        return (
          <g key={`action-${i}`}>
            <rect
              x={cx - NODE_W / 2}
              y={aY}
              width={NODE_W}
              height={NODE_H}
              rx={4}
              ry={4}
              fill="none"
              stroke={COLORS.actionBorder}
              strokeWidth={2}
            />
            <text
              x={cx}
              y={aY + NODE_H / 2 + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={COLORS.text}
              fontFamily={FONT}
              fontSize={11}
            >
              {truncate(action, 26)}
            </text>

            {/* Arrow to next action if there is one */}
            {nextActionY !== null && (
              <line
                x1={cx}
                y1={aY + NODE_H}
                x2={cx}
                y2={nextActionY}
                stroke={COLORS.arrow}
                strokeWidth={1.5}
                markerEnd="url(#arrowhead)"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
