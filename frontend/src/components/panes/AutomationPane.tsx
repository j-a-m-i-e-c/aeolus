// frontend/src/components/panes/AutomationPane.tsx — Self-contained automation pane (setup / status / editing)

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import {
  Power,
  PowerOff,
  Pencil,
  Save,
  X,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Blocks,
  BookOpen,
} from "lucide-react";
import { authFetch } from "../../lib/auth-fetch";
import type { TranspileError } from "../ScriptEditor";
const ScriptEditor = lazy(() => import("../ScriptEditor").then(m => ({ default: m.ScriptEditor })));
const UiEditor = lazy(() => import("../UiEditor").then(m => ({ default: m.UiEditor })));
const AutomationProjectEditor = lazy(() => import("../AutomationProjectEditor").then(m => ({ default: m.AutomationProjectEditor })));
import type { AutomationProjectSource } from "../AutomationProjectEditor";
import { FlowDiagram } from "../FlowDiagram";
import { ActivityFeed } from "../ActivityFeed";
import { SnippetPicker } from "../SnippetPicker";
import { TriggerSelector } from "../TriggerSelector";
import { SandboxHost } from "../../sandbox/SandboxHost";
import type { PropsPayload } from "../../sandbox/rpc-types";
import type { ExecutionEntry } from "./custom/types";
import { useDashboardStore } from "../../store/dashboard-store";
import { useAuthStore } from "../../store/auth-store";
import { usePermissionsStore } from "../../store/permissions-store";
import { useDeviceStore } from "../../store/device-store";
import { useAutomationStateStore } from "../../store/automation-state-store";
import type { PaneConfig } from "../../types/dashboard";

import { API_URL, PUBLIC_DEMO } from "../../lib/env";

type PaneMode = "setup" | "status" | "editing";

// Stable empty-state reference so `ruleState ?? EMPTY_STATE` doesn't allocate a
// new object each render (keeps the stateMap useMemo dependency stable).
const EMPTY_STATE: Record<string, unknown> = {};

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
  projectMode?: "project" | "legacy";
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

const DEFAULT_SCRIPT = `// Legacy single-file automation. New automations use Automation Projects.
log.info("Event: " + context.topic);
`;

const DEFAULT_UI_TEMPLATE = `// Custom Automation UI Component
// ─────────────────────────────────────────────────────
// This component renders in the automation pane's status mode.
// It receives live data from the Aeolus runtime.
// Open the Docs panel to see all available methods.

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


function createDefaultProject(): AutomationProjectSource {
  return {
    logicEntry: "logic/index.ts",
    uiEntry: null,
    files: [
      {
        path: "logic/index.ts",
        content: `export default async function run(context: EventContext) {
  log.info(\`Event: \${context.topic}\`);
  state.set("lastEvent", { topic: context.topic, at: Date.now() });
}
`,
      },
    ],
  };
}

export function AutomationPane({ config, paneId }: Props) {
  const ruleId = (config.ruleId as string) || "";
  const updatePaneConfig = useDashboardStore((s) => s.updatePaneConfig);
  const panes = useDashboardStore((s) => s.panes);
  const activeTabId = useDashboardStore((s) => s.activeTabId);
  const isAdmin = useAuthStore((s) => s.user?.role) === "admin";
  const isPublicVisitor = PUBLIC_DEMO && !isAdmin;
  const isDemoDraft = isPublicVisitor && !ruleId && config.demoDraft === true;

  // Custom-UI interactivity is gated by the tab's RBAC level: a visitor holding
  // only `read` on the pane's tab (e.g. a look-only public-demo tab) gets a
  // view-only sandbox — the broker neutralises its mutating ops, matching the
  // server (fire/state require `interact`). Admins always interact.
  const paneTabId = panes.find((p) => p.id === paneId)?.tabId ?? activeTabId ?? null;
  const canInteract = usePermissionsStore((s) => (paneTabId ? s.canPerform(paneTabId, "interact") : false));
  const customUiReadOnly = !(isAdmin || canInteract);

  // Mode state
  const [mode, setMode] = useState<PaneMode>(ruleId ? "status" : "setup");

  // Setup / editing fields
  const [name, setName] = useState(() => isDemoDraft ? String(config.ruleName || "Demo Draft") : "");
  const [triggerTopic, setTriggerTopic] = useState(() => isDemoDraft ? String(config.draftTriggerTopic || "") : "");
  const [triggerType, setTriggerType] = useState<"mqtt" | "cron" | "none">(() =>
    isDemoDraft && (config.draftTriggerType === "mqtt" || config.draftTriggerType === "cron" || config.draftTriggerType === "none")
      ? config.draftTriggerType
      : "mqtt",
  );
  const [cronExpression, setCronExpression] = useState(() => isDemoDraft ? String(config.draftCronExpression || "") : "");
  const [triggerValid, setTriggerValid] = useState(true);
  const [scriptSource, setScriptSource] = useState(DEFAULT_SCRIPT);
  const [uiSource, setUiSource] = useState("");
  const [projectSource, setProjectSource] = useState<AutomationProjectSource>(() => {
    const draft = config.draftProject as AutomationProjectSource | undefined;
    return isDemoDraft && draft?.files?.length ? draft : createDefaultProject();
  });
  const [errors, setErrors] = useState<TranspileError[]>([]);
  const [saving, setSaving] = useState(false);

  // Status mode state
  const [rule, setRule] = useState<AutomationRule | null>(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [lastFired, setLastFired] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [executionHistory, setExecutionHistory] = useState<ExecutionEntry[]>([]);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);

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
  const ruleState = useAutomationStateStore((s) => s.stateByRule[ruleId]) ?? EMPTY_STATE;

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
    } catch (_err) {
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
    if (isDemoDraft) {
      if (paneId) {
        updatePaneConfig(paneId, {
          ...config,
          demoDraft: true,
          ruleName: name.trim(),
          draftTriggerTopic: triggerTopic,
          draftTriggerType: triggerType,
          draftCronExpression: cronExpression,
          draftProject: projectSource,
        });
      }
      setDraftSavedAt(Date.now());
      return;
    }
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
          project: projectSource,
          // A non-admin author binds the automation's scope to the tab this pane
          // lives on (the pane's owning tab, falling back to the active tab).
          // Admins author unrestricted, so no owning tab is sent.
          ...(isAdmin
            ? {}
            : { tabId: panes.find((p) => p.id === paneId)?.tabId ?? activeTabId ?? undefined }),
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
  }, [name, triggerTopic, triggerType, cronExpression, projectSource, saving, paneId, config, updatePaneConfig, panes, activeTabId, isAdmin, isDemoDraft]);

  // ── Update handler (editing mode) — includes uiSource (15.4) ──
  const handleUpdate = useCallback(async () => {
    if (!name.trim() || saving || !ruleId) return;
    if (isPublicVisitor) {
      setErrors([]);
      setMode("status");
      return;
    }
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
          ...(rule?.projectMode === "project"
            ? { project: projectSource }
            : { scriptSource, uiSource: uiSource || undefined }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 400 && data.details) {
          setErrors(data.details);
        } else if (data.error) {
          setErrors([{ line: 0, column: 0, message: data.error }]);
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
  }, [name, triggerTopic, triggerType, cronExpression, scriptSource, uiSource, projectSource, rule, saving, ruleId, fetchRule, paneId, config, updatePaneConfig, isPublicVisitor]);

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


  // ── Enter editing mode — populate uiSource from rule (15.4) ──
  const handleEdit = useCallback(async () => {
    if (!rule) return;
    setName(rule.name);
    setTriggerTopic(rule.topic);
    setTriggerType(rule.triggerType || "mqtt");
    setCronExpression(rule.cronExpression || "");
    setErrors([]);

    if (rule.projectMode === "project") {
      try {
        const response = await authFetch(`${API_URL}/api/automations/${rule.id}/project`);
        if (!response.ok) throw new Error("Failed to load Automation Project");
        const project = await response.json() as AutomationProjectSource;
        setProjectSource(project);
      } catch {
        setErrors([{ line: 0, column: 0, message: "Failed to load Automation Project source" }]);
        return;
      }
    } else {
      setScriptSource(rule.scriptSource || DEFAULT_SCRIPT);
      setUiSource(rule.uiSource || "");
    }
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
    setProjectSource(createDefaultProject());
    setErrors([]);
  }, [paneId, config, updatePaneConfig]);

  const saveDisabled = !name.trim() || saving || !triggerValid;

  // Ctrl+S handler for editors
  const handleEditorSave = useCallback(
    (_value: string) => {
      if (mode === "setup") handleSave();
      else if (mode === "editing" && !isPublicVisitor) handleUpdate();
    },
    [mode, handleSave, handleUpdate, isPublicVisitor],
  );

  // NOTE: The custom-component privileged callbacks (control / publish / read /
  // save / saveAndFire / fire) formerly defined here are now handled by the shared
  // host SdkBroker (frontend/src/sandbox/sandbox-host.ts). Custom UI runs inside an
  // opaque-origin sandbox iframe and reaches Aeolus only via the capability-scoped
  // Aeolus UI SDK over the RPC channel — no privileged functions are passed in.

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

        {/* Runtime status. Deliberate interactions belong in the project UI, not a generic bypass button. */}
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
            history={executionHistory}
            state={ruleState}
            readOnly={customUiReadOnly}
          />
        </div>
      </div>
    );
  }

  // ── Setup Mode / Editing Mode ──
  const isEditing = mode === "editing";
  const usesProjectEditor = mode === "setup" || rule?.projectMode === "project";

  if (usesProjectEditor) {
    return (
      <div className="h-full flex flex-col p-3 sm:p-4 gap-3 overflow-hidden">
        {isPublicVisitor && (
          <div className="shrink-0 rounded-lg border border-[#3BA4FF]/25 bg-[#3BA4FF]/8 px-3 py-2 text-[10px] text-[#9AA6B2]">
            <span className="font-semibold text-[#5CE1E6]">{isDemoDraft ? "Demo draft" : "Shared demo"}</span>
            {isDemoDraft
              ? " · This automation exists only in your browser and never changes the shared demo."
              : " · You are viewing the real automation. Shared demo source is read-only."}
            {draftSavedAt && isDemoDraft && <span className="ml-2 text-[#73D99A]">Draft kept locally.</span>}
          </div>
        )}
        {isPublicVisitor && !isDemoDraft ? (
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#2A3441] bg-[#0B0F14] px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#E6EDF3] truncate">{name}</div>
              <div className="text-[10px] text-[#6B7785] mt-0.5">
                {triggerType === "cron"
                  ? `Schedule · ${cronExpression || "custom cron"}`
                  : triggerType === "none"
                    ? "No automatic trigger"
                    : `MQTT · ${triggerTopic || "topic not set"}`}
              </div>
            </div>
            <span className="rounded-full border border-[#2A3441] px-2 py-1 text-[9px] uppercase tracking-wider text-[#7E8A98]">Read only</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(220px,0.72fr)_minmax(360px,1.28fr)] items-start gap-3 shrink-0">
            <div className="min-w-0">
              <label className="text-[10px] text-[#6B7785] uppercase tracking-wider font-medium block mb-2">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Automation name"
                className="w-full h-10 px-3 text-sm rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
              />
            </div>
            <div className="min-w-0 self-start">
              <TriggerSelector
                triggerType={triggerType}
                mqttTopic={triggerTopic}
                cronExpression={cronExpression}
                onTriggerTypeChange={setTriggerType}
                onMqttTopicChange={setTriggerTopic}
                onCronExpressionChange={setCronExpression}
                onValidityChange={setTriggerValid}
              />
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0">
          <Suspense fallback={<div className="h-full flex items-center justify-center text-xs text-[#6B7785]">Loading project editor…</div>}>
            <AutomationProjectEditor
              project={projectSource}
              projectKey={rule?.id || ruleId || paneId || "new-automation"}
              onChange={setProjectSource}
              onSave={isPublicVisitor && !isDemoDraft ? undefined : mode === "setup" ? handleSave : handleUpdate}
              errors={errors}
              readOnly={isPublicVisitor && !isDemoDraft}
              liveState={ruleState}
            />
          </Suspense>
        </div>

        <div className="flex items-center justify-end gap-2 shrink-0">
          {isPublicVisitor && isEditing && !isDemoDraft ? (
            <button
              onClick={() => setMode("status")}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-[#2A3441] transition-colors"
            >
              <X size={12} /> Close
            </button>
          ) : (
            <>
              <button
                onClick={mode === "setup" ? handleSave : handleUpdate}
                disabled={saveDisabled}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {isDemoDraft ? "Keep Draft" : "Save Automation"}
              </button>
              {isEditing && (
                <button onClick={() => setMode("status")} className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-[#2A3441] transition-colors">
                  <X size={12} /> Cancel
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // Populate default UI template if uiSource is empty (legacy single-file editor)
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
            <Suspense fallback={<div className="flex items-center justify-center h-64 text-neutral-500">Loading editor...</div>}>
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
            </Suspense>
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
                  <div className="text-[#9AA6B2] font-semibold mb-1">automation() legacy helper</div>
                  <div className="text-[#9AA6B2] pl-2 space-y-0.5">
                    <div className="text-[#E6EDF3]">{"automation({ conditions: [...], actions: [...] })"}</div>
                    <div className="text-[10px] text-[#6B7785] mt-1">Backwards-compatible simple-rule helper; Automation Projects do not require it</div>
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

// ── Helper component for custom UI rendering ──
// Chooses between the sandboxed custom UI (SandboxHost), the structured flow
// diagram, and the activity feed based on the rule's shape.

import type { Device } from "../../store/device-store";

interface DynamicCustomSectionProps {
  ruleId: string;
  rule: AutomationRule;
  hasUiSource: boolean;
  lastFired: number | null;
  devices: Record<string, Device>;
  history: ExecutionEntry[];
  /** Initial per-rule state snapshot passed to the sandbox at init. */
  state: Record<string, unknown>;
  /** When true, neutralise the frame's mutating SDK ops (view-only tab). */
  readOnly: boolean;
}

function DynamicCustomSection({
  ruleId,
  rule,
  hasUiSource,
  lastFired,
  devices,
  history,
  state,
  readOnly,
}: DynamicCustomSectionProps) {
  // Custom UI runs inside an opaque-origin sandbox iframe. All privileged calls
  // (control/publish/save/saveAndFire/fire/read) are handled by the shared host
  // SdkBroker over the RPC channel — never by code passed into the frame.
  if (hasUiSource) {
    const propsPayload: PropsPayload = {
      entityType: "automation",
      ruleId,
      ruleName: rule.name,
      lastFired,
      enabled: rule.enabled,
      devices: Object.values(devices),
      history,
      state,
    };
    return (
      <SandboxHost
        entityType="automation"
        entityId={ruleId}
        hasUiSource={hasUiSource}
        props={propsPayload}
        readOnly={readOnly}
        className="h-full w-full"
      />
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
