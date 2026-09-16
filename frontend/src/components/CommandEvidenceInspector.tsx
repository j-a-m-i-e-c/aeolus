// frontend/src/components/CommandEvidenceInspector.tsx — platform-owned command audit surface
//
// Command Evidence is runtime provenance, not authored application UI. Keeping it in
// the Automation Pane chrome means every automation gets the same truthful history
// without asking each custom UI to spend space re-rendering Aeolus infrastructure.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { authFetch } from "../lib/auth-fetch";
import { API_URL } from "../lib/env";
import {
  CommandExecutionCard,
  CommandProofCard,
} from "../sandbox/ui-kit";
import {
  useCommandActivityStore,
  type CommandActivity,
} from "../store/command-activity-store";

interface Props {
  open: boolean;
  ruleId: string;
  ruleName: string;
  onClose: () => void;
}

type EvidenceRecord = Record<string, unknown> & {
  commandId: string;
  executionId?: string;
  requestedAt?: number;
  transitions?: unknown[];
};

const EMPTY_ACTIVITY: CommandActivity[] = [];
const HISTORY_LIMIT = 100;

function recordId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const id = (value as { commandId?: unknown }).commandId;
  return typeof id === "string" ? id : "";
}

function timestampOf(value: EvidenceRecord): number {
  return typeof value.requestedAt === "number" && Number.isFinite(value.requestedAt)
    ? value.requestedAt
    : 0;
}

function mergeTransitions(history: unknown, live: unknown): unknown[] {
  const combined = new Map<string, unknown>();
  for (const source of [history, live]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (!entry || typeof entry !== "object") continue;
      const transition = entry as { toState?: unknown; timestamp?: unknown };
      const state = typeof transition.toState === "string" ? transition.toState : "";
      const at = typeof transition.timestamp === "number" ? transition.timestamp : 0;
      if (!state) continue;
      const key = `${state}:${at}`;
      // History is passed first and carries per-rung detail. A later live copy of the
      // same transition must not erase it, while a genuinely newer transition is added.
      if (!combined.has(key)) combined.set(key, entry);
    }
  }
  return [...combined.values()].sort((a, b) => {
    const aAt = typeof (a as { timestamp?: unknown }).timestamp === "number"
      ? ((a as { timestamp: number }).timestamp)
      : 0;
    const bAt = typeof (b as { timestamp?: unknown }).timestamp === "number"
      ? ((b as { timestamp: number }).timestamp)
      : 0;
    return aAt - bAt;
  });
}

/**
 * Merge WebSocket activity into the last durable snapshot.
 *
 * The live event intentionally carries less metadata than the REST record. Spreading
 * it over the durable record advances lifecycle/terminal fields without discarding
 * intent labels, device names, capability snapshots or observation contracts.
 */
function mergeEvidence(history: EvidenceRecord[], live: CommandActivity[]): EvidenceRecord[] {
  const byId = new Map<string, EvidenceRecord>();
  for (const command of history) byId.set(command.commandId, command);

  for (const activity of live) {
    const existing = byId.get(activity.commandId);
    if (existing) {
      // Durable history owns identity/context (intent, device names, capability
      // snapshot and the true requestedAt). The live feed is deliberately smaller,
      // so only let it advance lifecycle fields rather than spreading it over the
      // richer snapshot and accidentally replacing metadata with a partial view.
      byId.set(activity.commandId, {
        ...existing,
        lifecycleState: activity.lifecycleState,
        transitions: mergeTransitions(existing.transitions, activity.transitions),
        ...(existing.executionId === undefined && activity.executionId !== undefined
          ? { executionId: activity.executionId }
          : {}),
        ...(activity.terminalAt !== undefined ? { terminalAt: activity.terminalAt } : {}),
        ...(activity.success !== undefined ? { success: activity.success } : {}),
        ...(activity.failureKind !== undefined ? { failureKind: activity.failureKind } : {}),
        ...(activity.error !== undefined ? { error: activity.error } : {}),
      });
    } else {
      byId.set(activity.commandId, activity as unknown as EvidenceRecord);
    }
  }

  return [...byId.values()].sort((a, b) => timestampOf(b) - timestampOf(a));
}

interface EvidenceGroup {
  key: string;
  executionId: string;
  requestedAt: number;
  commands: EvidenceRecord[];
}

function groupByExecution(commands: EvidenceRecord[]): EvidenceGroup[] {
  const grouped = new Map<string, EvidenceGroup>();
  for (const command of commands) {
    const executionId = typeof command.executionId === "string" ? command.executionId : "";
    const key = executionId || `command:${command.commandId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.commands.push(command);
      existing.requestedAt = Math.max(existing.requestedAt, timestampOf(command));
    } else {
      grouped.set(key, {
        key,
        executionId,
        requestedAt: timestampOf(command),
        commands: [command],
      });
    }
  }

  const groups = [...grouped.values()];
  for (const group of groups) {
    // Within an execution the issue order is part of the story.
    group.commands.sort((a, b) => timestampOf(a) - timestampOf(b));
  }
  groups.sort((a, b) => b.requestedAt - a.requestedAt);
  return groups;
}

function formatWhen(timestamp: number): string {
  if (!timestamp) return "Command";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function CommandEvidenceInspector({ open, ruleId, ruleName, onClose }: Props) {
  const liveActivity = useCommandActivityStore(
    (state) => state.activityByRule[ruleId] ?? EMPTY_ACTIVITY,
  );
  const [history, setHistory] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!ruleId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(
        `${API_URL}/api/automations/${encodeURIComponent(ruleId)}/command-evidence?limit=${HISTORY_LIMIT}`,
      );
      if (!response.ok) throw new Error(`Command evidence request failed (${response.status})`);
      const body = await response.json() as { commands?: unknown };
      const commands = Array.isArray(body.commands)
        ? body.commands.filter((entry): entry is EvidenceRecord => recordId(entry) !== "")
        : [];
      setHistory(commands);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load command evidence");
    } finally {
      setLoading(false);
    }
  }, [ruleId]);

  useEffect(() => {
    if (!open) return;
    void fetchHistory();
  }, [open, fetchHistory]);

  // A lifecycle WebSocket event is emitted only after the durable write commits.
  // Refresh shortly afterwards so a brand-new live command picks up its intent,
  // capability snapshot and hardware names without waiting for the inspector to close.
  useEffect(() => {
    if (!open || liveActivity.length === 0) return;
    const timer = setTimeout(() => void fetchHistory(), 120);
    return () => clearTimeout(timer);
  }, [open, liveActivity, fetchHistory]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const commands = useMemo(
    () => mergeEvidence(history, liveActivity),
    [history, liveActivity],
  );
  const groups = useMemo(() => groupByExecution(commands), [commands]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close command evidence"
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Command evidence for ${ruleName}`}
        className="relative z-10 flex h-full w-full max-w-[720px] flex-col border-l border-[#2A3441] bg-[#0B0F14] shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#2A3441] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
              <ShieldCheck size={17} className="text-[#5CE1E6]" />
              Command Evidence
            </div>
            <div className="mt-1 truncate text-xs text-[#9AA6B2]">{ruleName}</div>
            <div className="mt-1 text-[10px] leading-relaxed text-[#6B7785]">
              Physical commands issued by this automation. Lifecycle stages are
              recorded by Aeolus, not inferred by the UI.
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              aria-label="Refresh command evidence"
              onClick={() => void fetchHistory()}
              disabled={loading}
              className="rounded-lg border border-[#2A3441] p-2 text-[#9AA6B2] transition-colors hover:bg-[#1A2330] hover:text-[#E6EDF3] disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              aria-label="Close command evidence"
              onClick={onClose}
              className="rounded-lg border border-[#2A3441] p-2 text-[#9AA6B2] transition-colors hover:bg-[#1A2330] hover:text-[#E6EDF3]"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-b border-[#202A36] px-5 py-2.5 text-[10px] text-[#6B7785]">
          <span>
            {commands.length === 0 ? "No physical commands" : `${commands.length} recent physical command${commands.length === 1 ? "" : "s"}`}
          </span>
          {liveActivity.some((command) => command.terminalAt === undefined) && (
            <span className="flex items-center gap-1.5 text-[#F59E0B]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#F59E0B]" />
              Live command in progress
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2">
          {loading && history.length === 0 ? (
            <div className="flex h-48 items-center justify-center gap-2 text-xs text-[#6B7785]">
              <Loader2 size={15} className="animate-spin" />
              Loading command history…
            </div>
          ) : error && commands.length === 0 ? (
            <div className="mt-6 rounded-lg border border-[#EF4444]/25 bg-[#EF4444]/5 p-4 text-xs text-[#FCA5A5]">
              {error}
            </div>
          ) : groups.length === 0 ? (
            <div className="mt-10 rounded-xl border border-dashed border-[#2A3441] p-6 text-center">
              <ShieldCheck size={22} className="mx-auto text-[#4A5868]" />
              <div className="mt-2 text-sm font-medium text-[#9AA6B2]">No command evidence yet</div>
              <div className="mt-1 text-xs leading-relaxed text-[#6B7785]">
                This automation has not issued a recorded physical command. MQTT
                messages, logs and other non-physical actions do not manufacture evidence.
              </div>
            </div>
          ) : (
            groups.map((group) => {
              const label = formatWhen(group.requestedAt);
              if (group.executionId && group.commands.length > 1) {
                return (
                  <CommandExecutionCard
                    key={group.key}
                    label={label}
                    evidence={{
                      executionId: group.executionId,
                      commands: group.commands,
                    }}
                  />
                );
              }
              return (
                <CommandProofCard
                  key={group.key}
                  label={label}
                  evidence={group.commands[0]}
                />
              );
            })
          )}

          {commands.length >= HISTORY_LIMIT && (
            <div className="mt-4 text-center text-[10px] text-[#596675]">
              Showing the most recent {HISTORY_LIMIT} commands.
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
