// frontend/src/components/panes/AutomationPane.tsx — Self-contained automation pane (setup / status / editing)

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
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
import { authFetch } from "../../lib/auth-fetch";
const AutomationProjectEditor = lazy(() => import("../AutomationProjectEditor").then(m => ({ default: m.AutomationProjectEditor })));
import type { AutomationProjectSource } from "../AutomationProjectEditor";
import { FlowDiagram } from "../FlowDiagram";
import { ActivityFeed } from "../ActivityFeed";
import { AutomationAuthoringFields } from "../AutomationAuthoringFields";
import { createDefaultAutomationProject, describeAutomationTrigger, triggerIsConfigured, type TranspileError } from "../automation-authoring";
import { SandboxHost } from "../../sandbox/SandboxHost";
import type { PropsPayload } from "../../sandbox/rpc-types";
import type { ExecutionEntry } from "./custom/types";
import { useDashboardStore } from "../../store/dashboard-store";
import { useAuthStore } from "../../store/auth-store";
import { usePermissionsStore } from "../../store/permissions-store";
import { useDeviceStore, type Device } from "../../store/device-store";
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
  hasUi?: boolean;
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
  const [projectSource, setProjectSource] = useState<AutomationProjectSource>(() => {
    const draft = config.draftProject as AutomationProjectSource | undefined;
    return isDemoDraft && draft?.files?.length ? draft : createDefaultAutomationProject();
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

  // ── Save handler (setup mode) ──
  const handleSave = useCallback(async () => {
    if (!name.trim() || saving || !triggerIsConfigured(triggerType, triggerTopic, cronExpression, triggerValid)) return;
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
          triggerTopic: triggerType === "mqtt" ? triggerTopic.trim() : undefined,
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
  }, [name, triggerTopic, triggerType, cronExpression, triggerValid, projectSource, saving, paneId, config, updatePaneConfig, panes, activeTabId, isAdmin, isDemoDraft]);

  // ── Update handler (editing mode) ──
  const handleUpdate = useCallback(async () => {
    if (!name.trim() || saving || !ruleId || !triggerIsConfigured(triggerType, triggerTopic, cronExpression, triggerValid)) return;
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
          triggerTopic: triggerType === "mqtt" ? triggerTopic.trim() : undefined,
          triggerType,
          cronExpression: triggerType === "cron" ? cronExpression : undefined,
          ...(rule?.ruleType === "script" ? { project: projectSource } : {}),
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
  }, [name, triggerTopic, triggerType, cronExpression, triggerValid, projectSource, rule, saving, ruleId, fetchRule, paneId, config, updatePaneConfig, isPublicVisitor]);

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


  // ── Enter editing mode ──
  const handleEdit = useCallback(async () => {
    if (!rule) return;
    setName(rule.name);
    setTriggerTopic(rule.topic);
    setTriggerType(rule.triggerType || "mqtt");
    setCronExpression(rule.cronExpression || "");
    setErrors([]);

    if (rule.ruleType === "script") {
      try {
        // The project endpoint projects legacy single-file automations into the
        // same source-tree shape, so upgraded installations and the demo share
        // one editor. Saving persists the projected tree as a real project.
        const response = await authFetch(`${API_URL}/api/automations/${rule.id}/project`);
        if (!response.ok) throw new Error("Failed to load Automation Project");
        const project = await response.json() as AutomationProjectSource;
        setProjectSource(project);
      } catch {
        setErrors([{ line: 0, column: 0, message: "Failed to load Automation Project source" }]);
        return;
      }
    } else {
      // Historical form rules still run, toggle and render, but are no longer a
      // second authoring product. They can be recreated as an Automation Project.
      return;
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
    setProjectSource(createDefaultAutomationProject());
    setErrors([]);
  }, [paneId, config, updatePaneConfig]);

  const saveDisabled = !name.trim() || saving || !triggerIsConfigured(triggerType, triggerTopic, cronExpression, triggerValid);

  // NOTE: The former Ctrl+S `handleEditorSave` bridge is gone — the Project
  // editor receives `onSave` (handleSave / handleUpdate) directly below.

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
    const hasUiSource = rule.hasUi === true;

    return (
      <div className="h-full flex flex-col p-4 gap-3 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="inline-block px-2 py-0.5 rounded text-[10px] font-mono text-[#9AA6B2] bg-[#0B0F14] border border-[#2A3441]">
              {describeAutomationTrigger(rule)}
            </div>
          </div>
          {rule.ruleType === "script" && (
            <button
              onClick={handleEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-[#2A3441] transition-colors shrink-0"
            >
              <Pencil size={12} />
              Edit
            </button>
          )}
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
  if (mode === "setup" || rule?.ruleType === "script") {
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
                {describeAutomationTrigger({ triggerType, topic: triggerTopic, cronExpression })}
              </div>
            </div>
            <span className="rounded-full border border-[#2A3441] px-2 py-1 text-[9px] uppercase tracking-wider text-[#7E8A98]">Read only</span>
          </div>
        ) : (
          <div className="shrink-0">
            <AutomationAuthoringFields
              name={name}
              triggerType={triggerType}
              mqttTopic={triggerTopic}
              cronExpression={cronExpression}
              onNameChange={setName}
              onTriggerTypeChange={setTriggerType}
              onMqttTopicChange={setTriggerTopic}
              onCronExpressionChange={setCronExpression}
              onTriggerValidityChange={setTriggerValid}
            />
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

  return null;
}

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
