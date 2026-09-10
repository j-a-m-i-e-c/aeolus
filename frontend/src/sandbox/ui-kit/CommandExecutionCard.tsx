import { useState } from "react";
import {
  commandExecutionProof,
  type CommandExecutionProof,
} from "./command-execution";
import { proofHeadlineProps, proofStageProps, type CommandProof } from "./command-proof";
import { tokens } from "./primitives";

export interface CommandExecutionCardProps {
  /**
   * The projected group, straight from `aeolus.read(...)` of a
   * `devices.executionEvidence()` value. Passed raw rather than pre-built so a pane
   * needs one line and cannot forget the null case. A {@link CommandExecutionProof}
   * is accepted too, for a pane that already built one.
   */
  evidence: unknown;
  /** Section heading. Defaults to "Execution". */
  label?: string;
  /** Expand every command's stages on mount. */
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

/**
 * One command inside the group.
 *
 * Each member keeps its own tier and its own hardware chain, because that is the
 * honest reading: a cue's lighting desk can prove its transition completed while the
 * effects rack on the same cue can only prove acknowledgement, and flattening the two
 * into a single group verdict would misreport both.
 */
function GroupMember({ proof, expanded }: { proof: CommandProof; expanded: boolean }) {
  return (
    <div style={{ marginTop: 7, paddingTop: 7, borderTop: `1px solid ${tokens.color.border}` }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <div style={{ color: tokens.color.text, fontSize: 11.5, fontWeight: 700 }}>
          {proof.intent}
        </div>
        <div style={{ ...proofHeadlineProps(proof), whiteSpace: "nowrap" }}>
          {proof.mark} {proof.headline}
        </div>
      </div>

      {proof.chain !== "" && (
        <div style={{ color: tokens.color.textSecondary, fontSize: 10.5, marginTop: 2 }}>
          {proof.chain}
        </div>
      )}

      {/* Why this command stopped where it did. Shown unexpanded as well: a member
          that proved less than the one above it should say so without the reader
          having to open anything, or the group reads as an unexplained inconsistency. */}
      {!expanded && proof.settled && !proof.proven && (
        <div style={{ color: tokens.color.textMuted, fontSize: 10, marginTop: 2 }}>
          {proof.stages.find((stage) => stage.status === "failed")?.label ?? ""}
        </div>
      )}
      {!expanded && proof.proven && proof.tier !== "observed" && (
        <div style={{ color: tokens.color.textMuted, fontSize: 10, marginTop: 2 }}>
          {proof.stages.find(
            (stage) =>
              stage.state === "OBSERVED" &&
              (stage.status === "not-configured" ||
                stage.status === "unavailable" ||
                stage.status === "not-required"),
          )?.label ?? ""}
        </div>
      )}

      {proof.clampNote !== "" && (
        <div style={{ color: tokens.color.warning, fontSize: 10.5, marginTop: 3 }}>
          {proof.clampNote}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 5 }}>
          {/* All four stages, always — the same fixed scaffold as a single command's
              proof, so the group teaches the model rather than abbreviating it. */}
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

          <div style={{ marginTop: 5 }}>
            <DetailRow name="Target actuator" value={proof.targetDeviceName} />
            <DetailRow
              name="Observation"
              value={
                proof.observedDeviceName !== "" &&
                proof.observedDeviceName !== proof.targetDeviceName
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
          </div>
        </div>
      )}
    </div>
  );
}

function isExecutionProof(value: unknown): value is CommandExecutionProof {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { commands?: unknown }).commands) &&
    typeof (value as { summary?: unknown }).summary === "string"
  );
}

/**
 * Render everything one operator action or one trigger actually proved.
 *
 * Use this in place of `CommandProofCard` wherever a single execution issues more
 * than one physical command. The group names its cause and its elapsed time; each
 * command keeps its own tier and hardware chain.
 *
 * Returns `null` when there is no execution to show, so a pane can mount it
 * unconditionally.
 */
export function CommandExecutionCard({
  evidence,
  label = "Execution",
  defaultExpanded = false,
}: CommandExecutionCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const group = isExecutionProof(evidence) ? evidence : commandExecutionProof(evidence);
  if (!group) return null;

  return (
    <div style={SURFACE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={HEADING}>{label.toUpperCase()}</div>
        <div
          style={{
            fontFamily: tokens.font.sans,
            fontSize: 11,
            fontWeight: 850,
            letterSpacing: ".08em",
            whiteSpace: "nowrap",
            color: !group.settled
              ? tokens.color.warning
              : group.proven
                ? tokens.color.success
                : tokens.color.error,
          }}
        >
          {group.mark} {group.headline}
        </div>
      </div>

      {/* What caused this, from the record rather than from the button. An execution
          nothing triggered on the record simply shows nothing here. */}
      {group.trigger !== "" && (
        <div style={{ color: tokens.color.text, fontSize: 11.5, fontWeight: 700, marginTop: 4 }}>
          Triggered by {group.trigger}
        </div>
      )}

      <div style={{ color: tokens.color.textSecondary, fontSize: 10.5, marginTop: 2 }}>
        {group.summary}
      </div>

      {group.commands.map((proof) => (
        <GroupMember key={proof.commandId} proof={proof} expanded={expanded} />
      ))}

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
          <DetailRow name="Execution" value={group.executionId} />
        </div>
      )}
    </div>
  );
}
