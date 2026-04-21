// frontend/src/components/panes/AutomationPane.tsx — Self-contained automation pane (setup / status / editing)

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Power,
  PowerOff,
  Pencil,
  Save,
  X,
  Loader2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { ScriptEditor, type TranspileError } from "../ScriptEditor";
import { FlowDiagram } from "../FlowDiagram";
import { ActivityFeed } from "../ActivityFeed";
import { useDashboardStore } from "../../store/dashboard-store";
import type { PaneConfig } from "../../types/dashboard";

const API_URL =
  (import.meta as any).env?.VITE_API_URL ||
  `http://${window.location.hostname}:3001`;

type PaneMode = "setup" | "status" | "editing";

interface AutomationRule {
  id: string;
  name: string;
  topic: string;
  ruleType: string;
  enabled: boolean;
  scriptSource?: string;
  structured?: {
    trigger: string;
    conditionText: string | null;
    actionsText: string;
  } | null;
}

interface Props {
  config: PaneConfig;
  paneId?: string;
}

const DEFAULT_SCRIPT = `automation({
  condition: (ctx) => {
    return ctx.state.value !== undefined;
  },
  actions: (ctx) => {
    log.info(\`Triggered on \${ctx.topic}\`);
  },
});
`;

export function AutomationPane({ config, paneId }: Props) {
  const ruleId = (config.ruleId as string) || "";
  const updatePaneConfig = useDashboardStore((s) => s.updatePaneConfig);

  // Mode state
  const [mode, setMode] = useState<PaneMode>(ruleId ? "status" : "setup");

  // Setup / editing fields
  const [name, setName] = useState("");
  const [triggerTopic, setTriggerTopic] = useState("");
  const [scriptSource, setScriptSource] = useState(DEFAULT_SCRIPT);
  const [errors, setErrors] = useState<TranspileError[]>([]);
  const [saving, setSaving] = useState(false);

  // Status mode state
  const [rule, setRule] = useState<AutomationRule | null>(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [lastFired, setLastFired] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Track ruleId changes to switch modes
  useEffect(() => {
    if (ruleId) {
      setMode("status");
    } else {
      setMode("setup");
    }
  }, [ruleId]);

  // ── Fetch rule data for status mode ──
  const fetchRule = useCallback(async () => {
    if (!ruleId) return;
    setLoading(true);
    setFetchError(null);
    setNotFound(false);
    try {
      const res = await fetch(`${API_URL}/api/automations`);
      if (!res.ok) throw new Error("Failed to load automations");
      const rules: AutomationRule[] = await res.json();
      const found = rules.find((r) => r.id === ruleId);
      if (found) {
        setRule(found);
      } else {
        setNotFound(true);
      }
    } catch (err) {
      setFetchError("Failed to load automation");
    } finally {
      setLoading(false);
    }
  }, [ruleId]);

  // Fetch initial last fired timestamp
  const fetchLastFired = useCallback(async () => {
    if (!ruleId) return;
    try {
      const res = await fetch(
        `${API_URL}/api/automations/history?ruleId=${ruleId}&limit=1`,
      );
      if (!res.ok) return;
      const entries = await res.json();
      if (entries.length > 0) {
        setLastFired(entries[0].timestamp);
      }
    } catch {
      // Non-critical — last fired just shows "—"
    }
  }, [ruleId]);

  useEffect(() => {
    if (mode === "status" && ruleId) {
      fetchRule();
      fetchLastFired();
    }
  }, [mode, ruleId, fetchRule, fetchLastFired]);

  // Poll for last fired updates every 10s in status mode
  useEffect(() => {
    if (mode !== "status" || !ruleId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/automations/history?ruleId=${ruleId}&limit=1`,
        );
        if (!res.ok) return;
        const entries = await res.json();
        if (entries.length > 0) {
          setLastFired(entries[0].timestamp);
        }
      } catch {
        // Silently degrade
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [mode, ruleId]);

  // ── Save handler (setup mode) ──
  const handleSave = useCallback(async () => {
    if (!name.trim() || !triggerTopic.trim() || saving) return;
    setSaving(true);
    setErrors([]);
    try {
      const res = await fetch(`${API_URL}/api/automations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          triggerTopic: triggerTopic.trim(),
          ruleType: "script",
          scriptSource,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 400 && data.details) {
          setErrors(data.details);
        }
        return;
      }
      // Success — store ruleId and transition
      if (paneId) {
        updatePaneConfig(paneId, { ...config, ruleId: data.id });
      }
    } catch {
      // Network error — could add toast here
    } finally {
      setSaving(false);
    }
  }, [name, triggerTopic, scriptSource, saving, paneId, config, updatePaneConfig]);

  // ── Update handler (editing mode) ──
  const handleUpdate = useCallback(async () => {
    if (!name.trim() || !triggerTopic.trim() || saving || !ruleId) return;
    setSaving(true);
    setErrors([]);
    try {
      const res = await fetch(`${API_URL}/api/automations/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          triggerTopic: triggerTopic.trim(),
          scriptSource,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 400 && data.details) {
          setErrors(data.details);
        }
        return;
      }
      // Success — refresh and go back to status
      setMode("status");
      fetchRule();
    } catch {
      // Network error
    } finally {
      setSaving(false);
    }
  }, [name, triggerTopic, scriptSource, saving, ruleId, fetchRule]);

  // ── Toggle handler ──
  const handleToggle = useCallback(async () => {
    if (!rule || toggling) return;
    const newEnabled = !rule.enabled;
    setToggling(true);
    // Optimistic update
    setRule({ ...rule, enabled: newEnabled });
    try {
      const res = await fetch(`${API_URL}/api/automations/${rule.id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      if (!res.ok) {
        // Revert
        setRule({ ...rule, enabled: !newEnabled });
      }
    } catch {
      setRule({ ...rule, enabled: !newEnabled });
    } finally {
      setToggling(false);
    }
  }, [rule, toggling]);

  // ── Enter editing mode ──
  const handleEdit = useCallback(() => {
    if (!rule) return;
    setName(rule.name);
    setTriggerTopic(rule.topic);
    setScriptSource(rule.scriptSource || DEFAULT_SCRIPT);
    setErrors([]);
    setMode("editing");
  }, [rule]);

  // ── Reset pane (rule not found) ──
  const handleReset = useCallback(() => {
    if (paneId) {
      updatePaneConfig(paneId, { ...config, ruleId: "" });
    }
    setRule(null);
    setNotFound(false);
    setName("");
    setTriggerTopic("");
    setScriptSource(DEFAULT_SCRIPT);
    setErrors([]);
  }, [paneId, config, updatePaneConfig]);

  const saveDisabled = !name.trim() || !triggerTopic.trim() || saving;

  // Ctrl+S handler for ScriptEditor
  const handleEditorSave = useCallback(
    (_value: string) => {
      if (mode === "setup") handleSave();
      else if (mode === "editing") handleUpdate();
    },
    [mode, handleSave, handleUpdate],
  );

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════

  // ── Status Mode ──
  if (mode === "status") {
    if (loading) {
      return (
        <div className="h-full flex items-center justify-center">
          <Loader2 size={18} className="animate-spin text-[#6B7785]" />
        </div>
      );
    }

    if (notFound) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
          <AlertTriangle size={24} className="text-[#F59E0B]" />
          <div className="text-sm text-[#E6EDF3]">Rule not found</div>
          <div className="text-xs text-[#6B7785]">
            The linked automation may have been deleted externally.
          </div>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
          >
            <RotateCcw size={12} />
            Reset Pane
          </button>
        </div>
      );
    }

    if (fetchError) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
          <AlertTriangle size={24} className="text-[#EF4444]" />
          <div className="text-sm text-[#E6EDF3]">{fetchError}</div>
          <button
            onClick={fetchRule}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
          >
            <RotateCcw size={12} />
            Retry
          </button>
        </div>
      );
    }

    if (!rule) return null;

    return (
      <div className="h-full flex flex-col p-4 gap-3 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[#E6EDF3] truncate">
              {rule.name}
            </div>
            <div className="mt-1 inline-block px-2 py-0.5 rounded text-[10px] font-mono text-[#9AA6B2] bg-[#0B0F14] border border-[#2A3441]">
              {rule.topic}
            </div>
          </div>
          <button
            onClick={handleEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-[#2A3441] transition-colors shrink-0"
          >
            <Pencil size={12} />
            Edit
          </button>
        </div>

        {/* Toggle + last fired */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              rule.enabled
                ? "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30 hover:bg-[#22C55E]/25"
                : "bg-elevated text-[#6B7785] border-[#2A3441] hover:text-[#9AA6B2]"
            } disabled:opacity-50`}
          >
            {rule.enabled ? <Power size={12} /> : <PowerOff size={12} />}
            {rule.enabled ? "Enabled" : "Disabled"}
          </button>

          <div className="text-[10px] text-[#6B7785]">
            Last fired:{" "}
            {lastFired
              ? new Date(lastFired).toLocaleTimeString()
              : "—"}
          </div>
        </div>

        {/* Visual: FlowDiagram or ActivityFeed */}
        <div className="flex-1 min-h-0 overflow-auto">
          {rule.structured ? (
            <FlowDiagram
              trigger={rule.structured.trigger}
              conditionText={rule.structured.conditionText ?? undefined}
              actionsText={rule.structured.actionsText}
            />
          ) : (
            <ActivityFeed ruleId={rule.id} />
          )}
        </div>
      </div>
    );
  }

  // ── Setup Mode / Editing Mode ──
  const isEditing = mode === "editing";

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* Name input */}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Automation name"
        className="w-full px-3 py-2 text-sm rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
      />

      {/* Trigger topic input */}
      <input
        type="text"
        value={triggerTopic}
        onChange={(e) => setTriggerTopic(e.target.value)}
        placeholder="e.g. sensor/+/temperature"
        className="w-full px-3 py-2 text-sm rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors font-mono"
      />

      {/* Script editor — fills remaining space */}
      <div className="flex-1 min-h-0">
        <ScriptEditor
          initialValue={scriptSource}
          onChange={setScriptSource}
          onSave={handleEditorSave}
          errors={errors}
        />
      </div>

      {/* Error summary panel */}
      {errors.length > 0 && (
        <div className="rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 p-3 max-h-32 overflow-auto">
          <div className="text-xs font-medium text-[#EF4444] mb-1">
            Transpilation errors
          </div>
          {errors.map((err, i) => (
            <div key={i} className="text-[10px] text-[#E6EDF3] font-mono">
              Line {err.line}:{err.column} — {err.message}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={isEditing ? handleUpdate : handleSave}
          disabled={saveDisabled}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Save size={12} />
          )}
          Save
        </button>

        {isEditing && (
          <button
            onClick={() => {
              setErrors([]);
              setMode("status");
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-[#2A3441] transition-colors"
          >
            <X size={12} />
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
