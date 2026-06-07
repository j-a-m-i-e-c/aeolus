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
  BookOpen,
} from "lucide-react";
import { authFetch } from "../../lib/auth-fetch";
import { ScriptEditor, type TranspileError } from "../ScriptEditor";
import { UiEditor } from "../UiEditor";
import { FlowDiagram } from "../FlowDiagram";
import { ActivityFeed } from "../ActivityFeed";
import { SnippetPicker } from "../SnippetPicker";
import { CustomComponentBoundary } from "../CustomComponentBoundary";
import { TriggerSelector } from "../TriggerSelector";
import { useDynamicComponent } from "../../hooks/useDynamicComponent";
import type { ExecutionEntry } from "./custom/types";
import { useDashboardStore } from "../../store/dashboard-store";
import { useDeviceStore } from "../../store/device-store";
import { useAutomationStateStore, sendStateUpdate, sendStateUpdateAndFire } from "../../store/automation-state-store";
import type { PaneConfig } from "../../types/dashboard";

const API_URL =
  import.meta.env.VITE_API_URL ||
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
  triggerType?: "mqtt" | "cron" | "none";
  cronExpression?: string | null;
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

const DEFAULT_SCRIPT = `// ─── Option 1: Free-form (use the globals however you like) ───
//
// const temp = context.state.value;
// const bedroom = devices.get("light-bedroom");
// if (temp > 30 && bedroom && !bedroom.state.on) {
//   devices.action("light-bedroom", "toggle");
//   mqtt.publish("alerts/temp", JSON.stringify({ temp, room: "kitchen" }));
//   log.warn("High temp — turned on bedroom fan");
// }
//
// Push data to your custom UI component via the state store:
// Anything you state.set() here appears as aeolus.read() in the UI tab.
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
    function check(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function act(context) {
      log.info(\`Event: \${context.topic} → \${JSON.stringify(context.state)}\`);
    },
  ],
});
`;

const DEFAULT_UI_TEMPLATE = `// Custom Automation UI Component
// ─────────────────────────────────────────────────────
// This component renders in the automation pane's status mode.
// It receives live data from the Aeolus runtime.
// Open the Docs panel to see all available methods.

import type { CustomComponentProps } from "./types";

export default function MyComponent(aeolus: CustomComponentProps) {
  const value = aeolus.read("myKey");

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm font-semibold text-[#E6EDF3]">
        {aeolus.ruleName}
      </div>
      <div className="text-xs text-[#9AA6B2]">
        {aeolus.enabled ? "✅ Enabled" : "⏸ Disabled"}
        {aeolus.lastFired && (
          <span className="ml-2">
            Last fired: {new Date(aeolus.lastFired).toLocaleTimeString()}
          </span>
        )}
      </div>
      <p className="text-xs text-[#6B7785]">Value: {String(value)}</p>
      <button
        onClick={() => aeolus.fire("clicked", {})}
        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
      >
        Click me
      </button>
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
  const [triggerType, setTriggerType] = useState<"mqtt" | "cron" | "none">("mqtt");
  const [cronExpression, setCronExpression] = useState("");
  const [triggerValid, setTriggerValid] = useState(true);
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
  const [showSnippets, setShowSnippets] = useState(true);
  const [showDocs, setShowDocs] = useState(false);
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
      const res = await authFetch(`${API_URL}/api/automations`);
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
      const res = await authFetch(
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
      const res = await authFetch(
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
      const res = await authFetch(`${API_URL}/api/automations/${ruleId}/state`);
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
        const res = await authFetch(
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
    if (!name.trim() || saving) return;
    setSaving(true);
    setErrors([]);
    try {
      const res = await authFetch(`${API_URL}/api/automations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          triggerTopic: triggerTopic.trim() || undefined,
          triggerType,
          cronExpression: triggerType === "cron" ? cronExpression : undefined,
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
      // Success — store ruleId and name, then transition
      if (paneId) {
        updatePaneConfig(paneId, { ...config, ruleId: data.id, ruleName: name.trim() });
      }
    } catch {
      // Network error — could add toast here
    } finally {
      setSaving(false);
    }
  }, [name, triggerTopic, triggerType, cronExpression, scriptSource, uiSource, saving, paneId, config, updatePaneConfig]);

  // ── Update handler (editing mode) — includes uiSource (15.4) ──
  const handleUpdate = useCallback(async () => {
    if (!name.trim() || saving || !ruleId) return;
    setSaving(true);
    setErrors([]);
    try {
      const res = await authFetch(`${API_URL}/api/automations/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          triggerTopic: triggerTopic.trim() || undefined,
          triggerType,
          cronExpression: triggerType === "cron" ? cronExpression : undefined,
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
      // Update pane header with new name
      if (paneId) {
        updatePaneConfig(paneId, { ...config, ruleName: name.trim() });
      }
    } catch {
      // Network error
    } finally {
      setSaving(false);
    }
  }, [name, triggerTopic, triggerType, cronExpression, scriptSource, uiSource, saving, ruleId, fetchRule, paneId, config, updatePaneConfig]);

  // ── Toggle handler ──
  const handleToggle = useCallback(async () => {
    if (!rule || toggling) return;
    const newEnabled = !rule.enabled;
    setToggling(true);
    // Optimistic update
    setRule({ ...rule, enabled: newEnabled });
    try {
      const res = await authFetch(`${API_URL}/api/automations/${rule.id}/toggle`, {
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
      await authFetch(`${API_URL}/api/automations/${rule.id}/fire`, {
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
    setTriggerType(rule.triggerType || "mqtt");
    setCronExpression(rule.cronExpression || "");
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
    setTriggerType("mqtt");
    setCronExpression("");
    setTriggerValid(true);
    setScriptSource(DEFAULT_SCRIPT);
    setUiSource("");
    setErrors([]);
  }, [paneId, config, updatePaneConfig]);

  const saveDisabled = !name.trim() || saving || !triggerValid;

  // Ctrl+S handler for editors
  const handleEditorSave = useCallback(
    (_value: string) => {
      if (mode === "setup") handleSave();
      else if (mode === "editing") handleUpdate();
    },
    [mode, handleSave, handleUpdate],
  );

  // control helper for custom components (was deviceAction)
  const control = useCallback(
    async (deviceId: string, actionType: string, params?: Record<string, unknown>) => {
      await authFetch(`${API_URL}/api/devices/${deviceId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: actionType, params }),
      });
    },
    [],
  );

  // publish helper for custom components (was mqttPublish)
  const publish = useCallback((topic: string, payload: string) => {
    authFetch(`${API_URL}/api/mqtt/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, payload }),
    }).catch(() => {});
  }, []);

  // Convert plain object state to Map for the read() method
  const stateMap = new Map(Object.entries(ruleState));

  // read helper — returns value for a given key from the state map
  const read = useCallback(
    (key: string) => stateMap.get(key),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ruleState],
  );

  // save helper bound to current ruleId (was stateSet)
  const save = useCallback(
    (key: string, value: unknown) => sendStateUpdate(ruleId, key, value),
    [ruleId],
  );

  // saveAndFire helper — persist state AND fire the Logic tab (was stateSetAndFire)
  const saveAndFire = useCallback(
    (key: string, value: unknown) => sendStateUpdateAndFire(ruleId, key, value),
    [ruleId],
  );

  // fire helper — fires the Logic tab script with a synthetic event (was emit)
  const fire = useCallback(
    (eventName: string, payload?: Record<string, unknown>) => {
      authFetch(`${API_URL}/api/automations/${ruleId}/fire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventName, ...(payload ?? {}) }),
      }).catch(() => {});
    },
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
            <div className="inline-block px-2 py-0.5 rounded text-[10px] font-mono text-[#9AA6B2] bg-[#0B0F14] border border-[#2A3441]">
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

        {/* Toggle + Fire Now + last fired — hidden for trigger-less automations */}
        {rule.triggerType !== "none" && (
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
        )}

        {/* Visual: Custom component, FlowDiagram, or ActivityFeed */}
        <div className="flex-1 min-h-0 overflow-auto">
          <DynamicCustomSection
            ruleId={ruleId}
            rule={rule}
            hasUiSource={hasUiSource}
            lastFired={lastFired}
            devices={devices}
            control={control}
            publish={publish}
            history={executionHistory}
            read={read}
            save={save}
            saveAndFire={saveAndFire}
            fire={fire}
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

      {/* Trigger selector */}
      <TriggerSelector
        triggerType={triggerType}
        mqttTopic={triggerTopic}
        cronExpression={cronExpression}
        onTriggerTypeChange={setTriggerType}
        onMqttTopicChange={setTriggerTopic}
        onCronExpressionChange={setCronExpression}
        onValidityChange={setTriggerValid}
      />

      {/* Tab bar — visible in BOTH setup and editing modes (15.1) */}
      <div className="flex items-center gap-1 bg-[#0B0F14] rounded-lg p-1 border border-[#2A3441]">
        <button
          onClick={() => setEditingTab("logic")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-all duration-200 ${
            editingTab === "logic"
              ? "bg-gradient-to-r from-[#3BA4FF]/20 to-[#5CE1E6]/20 text-[#5CE1E6] border border-[#5CE1E6]/30 shadow-[0_0_12px_rgba(92,225,230,0.1)]"
              : "text-[#6B7785] hover:text-[#9AA6B2] hover:bg-[#1A2330]"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
          Logic
        </button>
        <button
          onClick={() => setEditingTab("ui")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-all duration-200 ${
            editingTab === "ui"
              ? "bg-gradient-to-r from-[#3BA4FF]/20 to-[#5CE1E6]/20 text-[#5CE1E6] border border-[#5CE1E6]/30 shadow-[0_0_12px_rgba(92,225,230,0.1)]"
              : "text-[#6B7785] hover:text-[#9AA6B2] hover:bg-[#1A2330]"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
          UI
        </button>
      </div>

      {/* Editor + snippet panel — fills remaining space */}
      <div className="flex-1 min-h-0 flex gap-2">
        {/* Editor + state keys bar */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0">
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

          {/* Live state keys — shown in UI tab when there's state data */}
          {editingTab === "ui" && Object.keys(ruleState).length > 0 && (
            <div className="shrink-0 mt-1 rounded-lg bg-[#0B0F14] border border-[#2A3441] px-3 py-2 max-h-24 overflow-auto">
              <div className="text-[10px] text-[#6B7785] uppercase tracking-wider mb-1">
                aeolus.read <span className="normal-case tracking-normal">— live from logic tab</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                {Object.entries(ruleState).map(([key, value]) => (
                  <div key={key} className="text-[11px] font-mono">
                    <span className="text-[#9AA6B2]">.read(</span>
                    <span className="text-[#5CE1E6]">"{key}"</span>
                    <span className="text-[#9AA6B2]">)</span>
                    <span className="text-[#6B7785] ml-1">→</span>
                    <span className="text-[#E6EDF3] ml-1">
                      {typeof value === "string" ? `"${value}"` : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Snippet panel — collapsible, available in both tabs */}
        {showSnippets && (
          <div className="w-56 shrink-0 rounded-xl border border-[#2A3441] bg-[#121821] overflow-hidden">
            <SnippetPicker
              mode={editingTab}
              onClose={() => setShowSnippets(false)}
              onInsert={(code) => {
                const ref = editingTab === "logic" ? editorApiRef.current : uiEditorApiRef.current;
                if (ref) {
                  ref.insertText(code);
                }
              }}
            />
          </div>
        )}

        {/* Docs panel — context-aware: Logic globals vs UI props */}
        {showDocs && (
          <div className="w-72 shrink-0 rounded-xl border border-[#2A3441] bg-[#121821] overflow-hidden flex flex-col">
            {/* Header — matches SnippetPicker style */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2A3441]">
              <BookOpen size={14} className="text-primary shrink-0" />
              <span className="text-xs font-semibold text-[#E6EDF3] flex-1">
                {editingTab === "logic" ? "Logic API" : "Component Props"}
              </span>
              <button
                onClick={() => setShowDocs(false)}
                className="p-0.5 rounded text-[#6B7785] hover:text-[#9AA6B2] hover:bg-[#1A2330] transition-colors"
                title="Close docs"
              >
                <X size={14} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto px-3 py-2">
            {editingTab === "logic" ? (
              <div className="space-y-3 text-[11px] font-mono">
                {/* automation() helper */}
                <div>
                  <div className="text-primary font-semibold mb-1">automation()</div>
                  <div className="text-[#9AA6B2] pl-2 space-y-0.5">
                    <div className="text-[#E6EDF3]">{"automation({ conditions: [...], actions: [...] })"}</div>
                    <div className="text-[10px] text-[#6B7785] mt-1">Optional structured helper — enables flow diagram</div>
                  </div>
                </div>

                {/* context */}
                <div>
                  <div className="text-primary font-semibold mb-1">context</div>
                  <div className="text-[#9AA6B2] pl-2 space-y-0.5">
                    <div><span className="text-[#E6EDF3]">.topic</span> — MQTT topic that triggered</div>
                    <div><span className="text-[#E6EDF3]">.deviceId</span> — source device ID</div>
                    <div><span className="text-[#E6EDF3]">.state</span> — parsed message payload</div>
                    <div><span className="text-[#E6EDF3]">.timestamp</span> — event time (ms)</div>
                  </div>
                </div>

                {/* devices */}
                <div>
                  <div className="text-primary font-semibold mb-1">devices</div>
                  <div className="text-[#9AA6B2] pl-2 space-y-0.5">
                    <div><span className="text-[#E6EDF3]">.get(id)</span> — get device by ID</div>
                    <div><span className="text-[#E6EDF3]">.list()</span> — all devices</div>
                    <div><span className="text-[#E6EDF3]">.filter(fn)</span> — filter devices</div>
                    <div><span className="text-[#E6EDF3]">.action(id, type, params?)</span> — trigger action</div>
                  </div>
                </div>

                {/* mqtt */}
                <div>
                  <div className="text-primary font-semibold mb-1">mqtt</div>
                  <div className="text-[#9AA6B2] pl-2 space-y-0.5">
                    <div><span className="text-[#E6EDF3]">.publish(topic, payload)</span> — send message</div>
                  </div>
                </div>

                {/* log */}
                <div>
                  <div className="text-primary font-semibold mb-1">log</div>
                  <div className="text-[#9AA6B2] pl-2 space-y-0.5">
                    <div><span className="text-[#E6EDF3]">.info(msg)</span> / <span className="text-[#E6EDF3]">.warn(msg)</span> / <span className="text-[#E6EDF3]">.error(msg)</span></div>
                  </div>
                </div>

                {/* state */}
                <div>
                  <div className="text-primary font-semibold mb-1">state</div>
                  <div className="text-[#9AA6B2] pl-2 space-y-0.5">
                    <div><span className="text-[#E6EDF3]">.get(key)</span> — read value</div>
                    <div><span className="text-[#E6EDF3]">.set(key, value)</span> — write value</div>
                    <div><span className="text-[#E6EDF3]">.getAll()</span> — all key-value pairs</div>
                    <div><span className="text-[#E6EDF3]">.delete(key)</span> — remove key</div>
                  </div>
                </div>

                {/* services */}
                <div>
                  <div className="text-primary font-semibold mb-1">services</div>
                  <div className="text-[#9AA6B2] pl-2 space-y-0.5">
                    <div><span className="text-[#E6EDF3]">.get(type)</span> / <span className="text-[#E6EDF3]">.list()</span></div>
                  </div>
                </div>

                {/* http */}
                <div>
                  <div className="text-primary font-semibold mb-1">http</div>
                  <div className="text-[#9AA6B2] pl-2 space-y-0.5">
                    <div><span className="text-[#E6EDF3]">.get(url, opts?)</span> — GET request</div>
                    <div><span className="text-[#E6EDF3]">.post(url, opts?)</span> — POST request</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-[11px] font-mono">
                <div className="text-[10px] text-[#6B7785] mb-2">
                  Your component receives these as <span className="text-[#E6EDF3]">aeolus</span>
                </div>

                {/* aeolus.devices */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.devices</div>
                  <div className="text-[#9AA6B2] pl-2">All devices from the registry (live via WebSocket)</div>
                </div>

                {/* aeolus.ruleId */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.ruleId</div>
                  <div className="text-[#9AA6B2] pl-2">This automation's unique ID</div>
                </div>

                {/* aeolus.ruleName */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.ruleName</div>
                  <div className="text-[#9AA6B2] pl-2">This automation's display name</div>
                </div>

                {/* aeolus.enabled */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.enabled</div>
                  <div className="text-[#9AA6B2] pl-2">Whether this automation is enabled</div>
                </div>

                {/* aeolus.lastFired */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.lastFired</div>
                  <div className="text-[#9AA6B2] pl-2">Unix timestamp of last execution (or null)</div>
                </div>

                {/* aeolus.read */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.read(key)</div>
                  <div className="text-[#9AA6B2] pl-2">Read a value from the shared state store</div>
                </div>

                {/* aeolus.save */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.save(key, value)</div>
                  <div className="text-[#9AA6B2] pl-2">Persist value for the Logic tab to read on next trigger</div>
                </div>

                {/* aeolus.saveAndFire */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.saveAndFire(key, value)</div>
                  <div className="text-[#9AA6B2] pl-2">Persist state + fire the Logic tab</div>
                </div>

                {/* aeolus.fire */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.fire(eventName, payload?)</div>
                  <div className="text-[#9AA6B2] pl-2">Fire the Logic tab with a UI event</div>
                </div>

                {/* aeolus.control */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.control(id, type, params?)</div>
                  <div className="text-[#9AA6B2] pl-2">Control a device</div>
                </div>

                {/* aeolus.publish */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.publish(topic, payload)</div>
                  <div className="text-[#9AA6B2] pl-2">Send an MQTT message</div>
                </div>

                {/* aeolus.history */}
                <div>
                  <div className="text-primary font-semibold mb-1">aeolus.history</div>
                  <div className="text-[#9AA6B2] pl-2">Last 10 execution log entries</div>
                </div>
              </div>
            )}
            </div>
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

        <button
          onClick={() => setShowDocs((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
            showDocs
              ? "bg-primary/20 text-primary border-primary/30"
              : "text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border-[#2A3441]"
          }`}
        >
          <BookOpen size={12} />
          Docs
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
  control: (deviceId: string, actionType: string, params?: Record<string, unknown>) => Promise<void>;
  publish: (topic: string, payload: string) => void;
  history: ExecutionEntry[];
  read: (key: string) => unknown;
  save: (key: string, value: unknown) => void;
  saveAndFire: (key: string, value: unknown) => void;
  fire: (eventName: string, payload?: Record<string, unknown>) => void;
}

function DynamicCustomSection({
  ruleId,
  rule,
  hasUiSource,
  lastFired,
  devices,
  control,
  publish,
  history,
  read,
  save,
  saveAndFire,
  fire,
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
          control={control}
          publish={publish}
          history={history}
          read={read}
          save={save}
          saveAndFire={saveAndFire}
          fire={fire}
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
