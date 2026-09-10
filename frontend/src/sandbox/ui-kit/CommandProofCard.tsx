// frontend/src/sandbox/ui-kit/CommandProofCard.tsx — the default Command Proof surface
//
// Why this is a component and not another pure helper. Before it existed, seven of the
// eight showcase panes carried a byte-identical block of proof JSX that differed only
// in one muted hex value, under a heading that named no action: an anonymous
// "COMMAND EVIDENCE" box at the bottom of the pane. Two problems came out of that.
// Duplication meant the presentation drifted per tab, which is the exact failure the
// ui-kit was introduced to stop. And an anonymous block cannot answer the first
// question an operator has — "proof of WHAT?" — because nothing in it names the
// command.
//
// So the default treatment is contextual: it belongs directly beneath the control that
// caused it, it leads with the operation's own name, and it names the hardware chain
// that supplied the proof. The full four-stage ladder is one click away rather than
// permanently occupying a third of the pane.
//
// It stays as inert as the rest of the kit: props in, elements out. No I/O, no SDK, no
// host access. A pane keeps ownership of when to render it.

import { useState } from "react";
import { commandProof, proofHeadlineProps, proofStageProps, type CommandProof } from "./command-proof";
import { tokens } from "./primitives";

export interface CommandProofCardProps {
  /**
   * The projected evidence record, straight from `aeolus.read(...)`. Passed raw
   * rather than pre-built so a pane needs one line and cannot forget the null case.
   * A {@link CommandProof} is accepted too, for a pane that already built one.
   */
  evidence: unknown;
  /** Section heading. "Last command" suits a pane with several controls. */
  label?: string;
  /** Start expanded. Useful where the proof IS the pane's subject. */
  defaultExpanded?: boolean;
}

const SURFACE: Record<string, string | number> = {
  marginTop: 9,
  padding: 9,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: 10,
  background: "rgba(18, 24, 33, 0.55)",
  fontFamily: tokens.font.sans,
};

const HEADING: Record<string, string | number> = {
  color: tokens.color.textMuted,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: ".1em",
};

const TOGGLE: Record<string, string | number> = {
  marginTop: 7,
  padding: 0,
  border: "none",
  background: "none",
  color: tokens.color.primary,
  fontFamily: tokens.font.sans,
  fontSize: 10.5,
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "left",
};

/** One `label — value` line in the expanded detail block. */
function DetailRow({ name, value }: { name: string; value: string }) {
  if (value === "") return null;
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 10.5, padding: "1px 0" }}>
      <span style={{ color: tokens.color.textMuted, minWidth: 96, flexShrink: 0 }}>{name}</span>
      <span style={{ color: tokens.color.textSecondary, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

function isProof(value: unknown): value is CommandProof {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { stages?: unknown }).stages)
  );
}

/**
 * Render what a command actually proved.
 *
 * Returns `null` when there is no command, so a pane can mount it unconditionally and
 * still show nothing rather than an empty scaffold implying a command that never
 * happened.
 */
export function CommandProofCard({ evidence, label = "Last command", defaultExpanded = false }: CommandProofCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const proof = isProof(evidence) ? evidence : commandProof(evidence);
  if (!proof) return null;

  return (
    <div style={SURFACE}>
      <div style={HEADING}>{label.toUpperCase()}</div>

      {/* The operation's own name and the tier it reached, on one line. This is the
          whole compact treatment: what was asked for, and what was proven. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <div style={{ color: tokens.color.text, fontSize: 12, fontWeight: 700 }}>{proof.intent}</div>
        <div style={{ ...proofHeadlineProps(proof), whiteSpace: "nowrap" }}>
          {proof.mark} {proof.headline}
        </div>
      </div>

      {/* Actuator → sensor. Names the hardware that supplied the proof, which is the
          difference between "verified" and "the flow meter said so". */}
      {proof.chain !== "" && (
        <div style={{ color: tokens.color.textSecondary, fontSize: 10.5, marginTop: 2 }}>{proof.chain}</div>
      )}

      {proof.clampNote !== "" && (
        <div style={{ color: tokens.color.warning, fontSize: 10.5, marginTop: 3 }}>{proof.clampNote}</div>
      )}

      <button
        type="button"
        style={TOGGLE}
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        {expanded ? "Hide proof" : "View proof"}
      </button>

      {expanded && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${tokens.color.border}` }}>
          {/* All four stages, always. An unreached stage still appears and still says
              why — that is what teaches the model rather than just reporting it. */}
          {proof.stages.map((stage) => {
            const visual = proofStageProps(stage);
            return (
              <div key={stage.state} style={visual.style}>
                <span style={{ flexShrink: 0 }}>{visual.mark}</span>
                <span>{stage.label}</span>
                <span style={visual.termStyle}>({stage.state})</span>
              </div>
            );
          })}

          {/* Per-stage evidence, where the record carried any. */}
          {proof.stages.some((stage) => stage.detail !== "") && (
            <div style={{ marginTop: 5 }}>
              {proof.stages
                .filter((stage) => stage.detail !== "")
                .map((stage) => (
                  <div key={`${stage.state}-detail`} style={{ color: tokens.color.textMuted, fontSize: 10, padding: "1px 0" }}>
                    {stage.state}: {stage.detail}
                  </div>
                ))}
            </div>
          )}

          <div style={{ marginTop: 6 }}>
            {/* Human device names lead; raw ids are secondary detail. */}
            <DetailRow name="Target actuator" value={proof.targetDeviceName} />
            <DetailRow
              name="Observation"
              value={
                proof.observedDeviceName !== "" && proof.observedDeviceName !== proof.targetDeviceName
                  ? proof.observedDeviceName
                  : ""
              }
            />
            <DetailRow name="Condition" value={proof.conditionText} />
            <DetailRow name="Proof tier" value={proof.tier} />
            <DetailRow
              name="Device ceiling"
              value={proof.ceiling !== "" && proof.ceiling !== proof.tier ? proof.ceiling : ""}
            />
            <DetailRow name="Command" value={proof.commandId} />
            <DetailRow name="Execution" value={proof.executionId} />
          </div>
        </div>
      )}
    </div>
  );
}
