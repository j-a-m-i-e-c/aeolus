// frontend/src/components/FlowDiagram.tsx — Pure inline SVG flow diagram for structured automations

interface FlowDiagramProps {
  trigger: string;
  conditionText?: string;
  actionsText: string;
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

export function FlowDiagram({ trigger, conditionText, actionsText }: FlowDiagramProps) {
  const hasCondition = !!conditionText;

  // Layout: vertical flow
  // Trigger → (Condition?) → Action
  let y = 20;
  const cx = 140; // center x

  const triggerY = y;
  y += NODE_H + GAP;

  const conditionY = hasCondition ? y : 0;
  if (hasCondition) y += DIAMOND_SIZE * 2 + GAP;

  const actionY = y;
  y += NODE_H + 20;

  // "No" branch end point (right side)
  const noEndX = cx + NODE_W / 2 + 60;
  const noEndY = hasCondition ? conditionY + DIAMOND_SIZE : 0;

  const svgW = NODE_W + 80;
  const svgH = y;

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

      {/* Arrow: Trigger → Condition or Action */}
      <line
        x1={cx}
        y1={triggerY + NODE_H}
        x2={cx}
        y2={hasCondition ? conditionY : actionY}
        stroke={COLORS.arrow}
        strokeWidth={1.5}
        markerEnd="url(#arrowhead)"
      />

      {hasCondition && (
        <>
          {/* Condition node — diamond */}
          <polygon
            points={`${cx},${conditionY} ${cx + DIAMOND_SIZE},${conditionY + DIAMOND_SIZE} ${cx},${conditionY + DIAMOND_SIZE * 2} ${cx - DIAMOND_SIZE},${conditionY + DIAMOND_SIZE}`}
            fill="none"
            stroke={COLORS.conditionBorder}
            strokeWidth={2}
          />
          <text
            x={cx}
            y={conditionY + DIAMOND_SIZE}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={COLORS.text}
            fontFamily={FONT}
            fontSize={10}
          >
            {truncate(conditionText!, 18)}
          </text>

          {/* "Yes" arrow: Condition → Action */}
          <line
            x1={cx}
            y1={conditionY + DIAMOND_SIZE * 2}
            x2={cx}
            y2={actionY}
            stroke={COLORS.arrow}
            strokeWidth={1.5}
            markerEnd="url(#arrowhead)"
          />
          <text
            x={cx + 8}
            y={conditionY + DIAMOND_SIZE * 2 + 14}
            fill={COLORS.muted}
            fontFamily={FONT}
            fontSize={9}
          >
            Yes
          </text>

          {/* "No" arrow: Condition → right side (end) */}
          <line
            x1={cx + DIAMOND_SIZE}
            y1={conditionY + DIAMOND_SIZE}
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
        </>
      )}

      {/* Action node — rect */}
      <rect
        x={cx - NODE_W / 2}
        y={actionY}
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
        y={actionY + NODE_H / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={COLORS.text}
        fontFamily={FONT}
        fontSize={11}
      >
        {truncate(actionsText, 26)}
      </text>
    </svg>
  );
}
