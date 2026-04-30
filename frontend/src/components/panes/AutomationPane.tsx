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
  Zap,
  Blocks,
} from "lucide-react";
import { ScriptEditor, type TranspileError } from "../ScriptEditor";
import { UiEditor } from "../UiEditor";
import { FlowDiagram } from "../FlowDiagram";
import { ActivityFeed } from "../ActivityFeed";
import { SnippetPicker } from "../SnippetPicker";
import { CustomComponentBoundary } from "../CustomComponentBoundary";
import { useDynamicComponent } from "../../hooks/useDynamicComponent";
import type { ExecutionEntry } from "./custom/types";
import { useDashboardStore } from "../../store/dashboard-store";
import { useDeviceStore } from "../../store/device-store";
import { useAutomationStateStore, sendStateUpdate } from "../../store/automation-state-store";
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
  uiSource?: string;
  structured?: {
    trigger: string;
    conditions: string[];
    actions: string[];
  } | null;
}

interface Props {
  config: PaneConfig;
  paneId?: string;
}

const DEFAULT_SCRIPT = `// Aeolus Automation Script
// ─────────────────────────────────────────────────────
// This script runs in a secure sandbox every time the trigger topic fires.
// Write any logic you want using the globals below — no imports needed.
//
// Available globals:
//   context   — the event that triggered this script
//                context.topic     — MQTT topic (e.g. "sensor/kitchen/temp")
//                context.deviceId  — device ID (e.g. "sensor-kitchen-temp")
//                context.state     — device state (e.g. { value: 22.5 })
//                context.timestamp — when the event fired (unix ms)
//
//   devices   — query and control devices
//                devices.get("light-bedroom")           — get one device
//                devices.list()                          — all devices
//                devices.filter(d => d.type === "light") — filter by type
//                devices.action("light-1", "toggle")     — send an action
//                devices.action("light-1", "brightness", { brightness: 120 })
//
//   mqtt      — publish MQTT messages
//                mqtt.publish("valve/zone-1/command", '{"action":"open"}')
//
//   state     — per-rule key-value store (syncs to the UI tab via WebSocket)
//                state.set("avgTemp", 22.5)  — write (shows in UI tab instantly)
//                state.get("avgTemp")        — read
//                state.getAll()              — all key-value pairs
//                state.delete("avgTemp")     — remove
//
//   log       — structured logging
//                log.info("message")  log.warn("message")  log.error("message")
//
//   http      — external API calls (10s timeout, use HTTPS for non-local URLs)
//                const res = await http.get("https://api.example.com/data")
//                const res = await http.post(url, { headers: {...}, body: "..." })
//                // res = { status: 200, body: "..." }
//
//   services  — read-only access to running services
//                services.get("cron")  — service state or undefined
//                services.list()       — [{ type, displayName, running }]
//
// ─── Option 1: Free-form (use the globals however you like) ───
//
// const temp = context.state.value;
// const bedroom = devices.get("light-bedroom");
// if (temp > 30 && bedroom && !bedroom.state.on) {
//   devices.action("light-bedroom", "toggle");
//   mqtt.publish("alerts/temp", JSON.stringify({ temp, room: "kitchen" }));
//   log.warn("High temp — turned on bedroom fan");
// }
// state.set("lastTemp", temp);
// state.set("lastCheck", Date.now());
//
// ─── Option 2: Structured helper (generates a flow diagram) ───
//
// The automation() helper is optional. If you use it with named functions,
// the pane will render a visual flow diagram of your conditions and actions.
// All conditions must pass (AND logic) for the actions to run.

automation({
  conditions: [
    function hasValue(ctx) {
      return ctx.state.value !== undefined;
    },
  ],
  actions: [
    function logEvent(ctx) {
      log.info("Triggered on " + ctx.topic + ": " + JSON.stringify(ctx.state));
    },
  ],
});
`;

const DEFAULT_UI_TEMPLATE = `// Custom Automation UI Component
// ─────────────────────────────────────────────────────
// This component renders in the automation pane's status mode.
// It receives live data from the Aeolus runtime as props.
//
// Available props:
//   props.devices        — All devices from the registry (live via WebSocket)
//   props.ruleId         — This automation's unique ID
//   props.ruleName       — This automation's display name
//   props.lastFired      — Unix timestamp of last execution (or null)
//   props.enabled        — Whether this automation is enabled
//   props.deviceAction   — Trigger a device action: (deviceId, actionType, params?) => Promise
//   props.mqttPublish    — Publish MQTT message: (topic, payload) => void
//   props.executionHistory — Last 10 execution log entries
//   props.state          — Live key-value state from the automation script
//   props.stateSet       — Write state back: (key, value) => void

import type { CustomComponentProps } from "./types";

export default function AutomationUI(props: CustomComponentProps) {
  return (
    <div className="p-4 space-y-3">
      <div className="text-sm font-semibold text-[#E6EDF3]">
        {props.ruleName}
      </div>
      <div className="text-xs text-[#9AA6B2]">
        {props.enabled ? "✅ Enabled" : "⏸ Disabled"}
        {props.lastFired && (
          <span className="ml-2">
            Last fired: {new Date(props.lastFired).toLocaleTimeString()}
          </span>
        )}
      </div>
      <div className="text-xs text-[#6B7785]">
        {props.devices.length} devices registered
      </div>
    </div>
  );
}
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
  const [uiSource, setUiSource] = useState("");
  const [errors, setErrors] = useState<TranspileError[]>([]);
  const [saving, setSaving] = useState(false);

  // Status mode state
  const [rule, setRule] = useState<AutomationRule | null>(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [lastFired, setLastFired] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [firing, setFiring] = useState(false);
  const [executionHistory, setExecutionHistory] = useState<ExecutionEntry[]>([]);

  // Track ruleId changes to switch modes
  useEffect(() => {
    if (ruleId) {
      setMode("status");
    } else {
      setMode("setup");
    }
  }, [ruleId]);

  // Editing tab state (Logic vs UI)
  const [editingTab, setEditingTab] = useState<"logic" | "ui">("logic");

  // Snippet panel state
  const [showSnippets, setShowSnippets] = useState(false);
  const editorApiRef = useRef<{ insertText: (text: string) => void } | null>(null);
  const uiEditorApiRef = useRef<{ insertText: (text: string) => void } | null>(null);

  // Device store for custom component props
  const devices = useDeviceStore((s) => s.devices);
  const ruleState = useAutomationStateStore((s) => s.stateByRule[ruleId]) ?? {};

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

  // Fetch execution history for custom component
  const fetchExecutionHistory = useCallback(async () => {
    if (!ruleId) return;
    try {
      const res = await fetch(
        `${API_URL}/api/automations/history?ruleId=${ruleId}&limit=10`,
      );
      if (!res.ok) return;
      const entries: ExecutionEntry[] = await res.json();
      setExecutionHistory(entries);
    } catch {
      // Non-critical
    }
  }, [ruleId]);

  // Fetch initial state snapshot for status mode (15.6)
  const fetchInitialState = useCallback(async () => {
    if (!ruleId) return;
    try {
      const res = await fetch(`${API_URL}/api/automations/${ruleId}/state`);
      if (!res.ok) return;
      const state: Record<string, unknown> = await res.json();
      useAutomationStateStore.getState().initRuleState(ruleId, state);
    } catch {
      // Non-critical
    }
  }, [ruleId]);

  useEffect(() => {
    if (mode === "status" && ruleId) {
      fetchRule();
      fetchLastFired();
      fetchExecutionHistory();
      fetchInitialState();
    }
  }, [mode, ruleId, fetchRule, fetchLastFired, fetchExecutionHistory, fetchInitialState]);

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

  // ── Save handler (setup mode) — includes uiSource (15.4) ──
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
          uiSource: uiSource || undefined,
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
  }, [name, triggerTopic, scriptSource, uiSource, saving, paneId, config, updatePaneConfig]);

  // ── Update handler (editing mode) — includes uiSource (15.4) ──
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
          uiSource: uiSource || undefined,
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
  }, [name, triggerTopic, scriptSource, uiSource, saving, ruleId, fetchRule]);

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

  // ── Fire Now handler ──
  const handleFireNow = useCallback(async () => {
    if (!rule || firing) return;
    setFiring(true);
    try {
      await fetch(`${API_URL}/api/automations/${rule.id}/fire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setLastFired(Date.now());
    } catch {
      // Fire-and-forget
    }
    setTimeout(() => setFiring(false), 600);
  }, [rule, firing]);

  // ── Enter editing mode — populate uiSource from rule (15.4) ──
  const handleEdit = useCallback(() => {
    if (!rule) return;
    setName(rule.name);
    setTriggerTopic(rule.topic);
    setScriptSource(rule.scriptSource || DEFAULT_SCRIPT);
    setUiSource(rule.uiSource || "");
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
    setUiSource("");
    setErrors([]);
  }, [paneId, config, updatePaneConfig]);

  const saveDisabled = !name.trim() || !triggerTopic.trim() || saving;

  // Ctrl+S handler for editors
  const handleEditorSave = useCallback(
    (_value: string) => {
      if (mode === "setup") handleSave();
      else if (mode === "editing") handleUpdate();
    },
    [mode, handleSave, handleUpdate],
  );

  // Device action helper for custom components
  const deviceAction = useCallback(
    async (deviceId: string, actionType: string, params?: Record<string, unknown>) => {
      await fetch(`${API_URL}/api/devices/${deviceId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: actionType, params }),
      });
    },
    [],
  );

  // MQTT publish helper for custom components
  const mqttPublish = useCallback((topic: string, payload: string) => {
    fetch(`${API_URL}/api/mqtt/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, payload }),
    }).catch(() => {});
  }, []);

  // Convert plain object state to Map for custom component props
  const stateMap = new Map(Object.entries(ruleState));

  // stateSet helper bound to current ruleId
  const stateSet = useCallback(
    (key: string, value: unknown) => sendStateUpdate(ruleId, key, value),
    [ruleId],
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

    // Dynamic component loading — replaces static CUSTOM_COMPONENTS registry
    const hasUiSource = !!rule.uiSource;

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

        {/* Toggle + Fire Now + last fired */}
        <div className="flex items-center gap-2">
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

          <button
            onClick={handleFireNow}
            disabled={firing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-50"
          >
            <Zap size={12} />
            {firing ? "Fired!" : "Fire Now"}
          </button>

          <div className="text-[10px] text-[#6B7785]">
            Last fired:{" "}
            {lastFired
              ? new Date(lastFired).toLocaleTimeString()
              : "—"}
          </div>
        </div>

        {/* Visual: Custom component, FlowDiagram, or ActivityFeed */}
        <div className="flex-1 min-h-0 overflow-auto">
          <DynamicCustomSection
            ruleId={ruleId}
            rule={rule}
            hasUiSource={hasUiSource}
            lastFired={lastFired}
            devices={devices}
            deviceAction={deviceAction}
            mqttPublish={mqttPublish}
            executionHistory={executionHistory}
            stateMap={stateMap}
            stateSet={stateSet}
          />
        </div>
      </div>
    );
  }

  // ── Setup Mode / Editing Mode ──
  const isEditing = mode === "editing";

  // Populate default UI template if uiSource is empty
  const effectiveUiSource = uiSource || DEFAULT_UI_TEMPLATE;

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

      {/* Tab bar — visible in BOTH setup and editing modes (15.1) */}
      <div className="flex items-center gap-1 border-b border-[#2A3441]">
        <button
          onClick={() => setEditingTab("logic")}
          className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
            editingTab === "logic"
              ? "text-[#E6EDF3] border-b-2 border-primary"
              : "text-[#6B7785] hover:text-[#9AA6B2]"
          }`}
        >
          Logic
        </button>
        <button
          onClick={() => setEditingTab("ui")}
          className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
            editingTab === "ui"
              ? "text-[#E6EDF3] border-b-2 border-primary"
              : "text-[#6B7785] hover:text-[#9AA6B2]"
          }`}
        >
          UI
        </button>
      </div>

      {/* Editor + snippet panel — fills remaining space */}
      <div className="flex-1 min-h-0 flex gap-2">
        {/* Editor */}
        <div className="flex-1 min-w-0">
          {editingTab === "logic" ? (
            <ScriptEditor
              initialValue={scriptSource}
              onChange={setScriptSource}
              onSave={handleEditorSave}
              errors={errors}
              onEditorReady={(api) => { editorApiRef.current = api; }}
            />
          ) : (
            <UiEditor
              initialValue={effectiveUiSource}
              onChange={(val) => setUiSource(val)}
              onSave={handleEditorSave}
              onEditorReady={(api) => { uiEditorApiRef.current = api; }}
            />
          )}
        </div>

        {/* Snippet panel — collapsible, available in both tabs */}
        {showSnippets && (
          <div className="w-56 shrink-0 rounded-xl border border-[#2A3441] bg-[#121821] overflow-hidden">
            <SnippetPicker
              onInsert={(code) => {
                const ref = editingTab === "logic" ? editorApiRef.current : uiEditorApiRef.current;
                if (ref) {
                  ref.insertText(code);
                }
              }}
            />
          </div>
        )}
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

        <button
          onClick={() => setShowSnippets((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
            showSnippets
              ? "bg-primary/20 text-primary border-primary/30"
              : "text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border-[#2A3441]"
          }`}
        >
          <Blocks size={12} />
          Snippets
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

// ── Helper component for dynamic custom UI loading ──
// Extracted as a separate component so the useDynamicComponent hook
// can be called unconditionally (hooks can't be called conditionally).

import type { Device } from "../../store/device-store";

interface DynamicCustomSectionProps {
  ruleId: string;
  rule: AutomationRule;
  hasUiSource: boolean;
  lastFired: number | null;
  devices: Record<string, Device>;
  deviceAction: (deviceId: string, actionType: string, params?: Record<string, unknown>) => Promise<void>;
  mqttPublish: (topic: string, payload: string) => void;
  executionHistory: ExecutionEntry[];
  stateMap: Map<string, unknown>;
  stateSet: (key: string, value: unknown) => void;
}

function DynamicCustomSection({
  ruleId,
  rule,
  hasUiSource,
  lastFired,
  devices,
  deviceAction,
  mqttPublish,
  executionHistory,
  stateMap,
  stateSet,
}: DynamicCustomSectionProps) {
  const { Component, loading: dynamicLoading, error: dynamicError } = useDynamicComponent(ruleId, hasUiSource);
  const [customFallback, setCustomFallback] = useState(false);

  if (hasUiSource && dynamicLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={18} className="animate-spin text-[#6B7785]" />
      </div>
    );
  }

  if (hasUiSource && dynamicError) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30">
        <AlertTriangle size={14} className="text-[#EF4444] shrink-0" />
        <span className="text-xs text-[#EF4444]">{dynamicError}</span>
      </div>
    );
  }

  if (hasUiSource && Component && !customFallback) {
    return (
      <CustomComponentBoundary onFallback={() => setCustomFallback(true)}>
        <Component
          devices={Object.values(devices)}
          ruleId={ruleId}
          ruleName={rule.name}
          lastFired={lastFired}
          enabled={rule.enabled}
          deviceAction={deviceAction}
          mqttPublish={mqttPublish}
          executionHistory={executionHistory}
          state={stateMap}
          stateSet={stateSet}
        />
      </CustomComponentBoundary>
    );
  }

  if (rule.structured) {
    return (
      <FlowDiagram
        trigger={rule.structured.trigger}
        conditions={rule.structured.conditions}
        actions={rule.structured.actions}
      />
    );
  }

  return <ActivityFeed ruleId={rule.id} />;
}
