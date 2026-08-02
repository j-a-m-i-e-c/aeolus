// frontend/src/components/AutomationsPage.tsx — Dual-mode automation rule editor

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  GitBranch,
  Power,
  PowerOff,
  Code,
  FormInput,
  Pencil,
} from "lucide-react";
import type { TranspileError } from "./ScriptEditor";
const ScriptEditor = lazy(() => import("./ScriptEditor").then(m => ({ default: m.ScriptEditor })));
import { authFetch } from "../lib/auth-fetch";
import { useAuthStore } from "../store/auth-store";
import { usePermissionsStore } from "../store/permissions-store";
import { useDashboardStore } from "../store/dashboard-store";

import { API_URL } from "../lib/env";

type CreationMode = "form" | "script";

interface AutomationRule {
  id: string;
  name: string;
  topic: string;
  hasCondition: boolean;
  source: "ui";
  ruleType: "form" | "script";
  enabled: boolean;
  actionType?: string;
  actionTarget?: string;
  actionParams?: Record<string, unknown>;
  conditionType?: string | null;
  conditionValue?: string | null;
  scriptSource?: string;
  completionTier?: string | null;
  ownerTabId?: string | null;
  authoredUnrestricted?: boolean;
}

export function AutomationsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === "admin";
  const canPerform = usePermissionsStore((s) => s.canPerform);
  const dashboardTabs = useDashboardStore((s) => s.tabs);

  // Tabs the current user may author into. Admins author unrestricted (no owning
  // tab); a non-admin authors a scoped automation bound to one tab they can write.
  const writableTabs = dashboardTabs.filter((t) => canPerform(t.id, "write"));
  // A non-admin with no writable tab cannot author (the server would 403).
  const canAuthor = isAdmin || writableTabs.length > 0;

  // The owning tab a non-admin author binds the new automation to.
  const [ownerTabId, setOwnerTabId] = useState<string>("");
  useEffect(() => {
    if (!isAdmin && !ownerTabId && writableTabs.length > 0) {
      setOwnerTabId(writableTabs[0].id);
    }
  }, [isAdmin, ownerTabId, writableTabs]);

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [creationMode, setCreationMode] = useState<CreationMode>("form");

  // Form rule state
  const [form, setForm] = useState({
    name: "",
    triggerTopic: "",
    conditionType: "",
    conditionValue: "",
    actionType: "log",
    actionTarget: "",
    actionMessage: "",
    // device_action fields
    deviceActionType: "",
    deviceActionParams: "",
    // delay fields
    delayDuration: "",
    // webhook fields
    webhookUrl: "",
    webhookMethod: "POST",
    webhookBody: "",
    // publish fields
    publishTopic: "",
    publishPayload: "",
    // completion tier
    completionTier: "",
  });

  // Script rule state
  const [scriptName, setScriptName] = useState("");
  const [scriptTriggerTopic, setScriptTriggerTopic] = useState("");
  const [scriptSource, setScriptSource] = useState("");
  const [transpileErrors, setTranspileErrors] = useState<TranspileError[]>([]);

  // Editing state
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/automations`);
      setRules(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const resetForm = () => {
    setForm({
      name: "",
      triggerTopic: "",
      conditionType: "",
      conditionValue: "",
      actionType: "log",
      actionTarget: "",
      actionMessage: "",
      deviceActionType: "",
      deviceActionParams: "",
      delayDuration: "",
      webhookUrl: "",
      webhookMethod: "POST",
      webhookBody: "",
      publishTopic: "",
      publishPayload: "",
      completionTier: "",
    });
  };

  const resetScript = () => {
    setScriptName("");
    setScriptTriggerTopic("");
    setScriptSource("");
    setTranspileErrors([]);
    setEditingRuleId(null);
  };

  /** Build actionTarget and actionParams from form state based on actionType */
  const buildActionFields = () => {
    switch (form.actionType) {
      case "log":
        return {
          actionTarget: form.actionTarget || form.triggerTopic,
          actionParams: { message: form.actionMessage || "Rule fired" },
        };
      case "toggle":
        return {
          actionTarget: form.actionTarget,
          actionParams: {},
        };
      case "publish":
        return {
          actionTarget: form.publishTopic || form.triggerTopic,
          actionParams: { payload: form.publishPayload || "" },
        };
      case "device_action":
        return {
          actionTarget: form.actionTarget,
          actionParams: {
            actionType: form.deviceActionType,
            ...(form.deviceActionParams
              ? (() => {
                  try {
                    return JSON.parse(form.deviceActionParams);
                  } catch {
                    return { raw: form.deviceActionParams };
                  }
                })()
              : {}),
          },
        };
      case "delay":
        return {
          actionTarget: "",
          actionParams: {
            duration: Number(form.delayDuration) || 0,
          },
        };
      case "webhook":
        return {
          actionTarget: form.webhookUrl,
          actionParams: {
            method: form.webhookMethod,
            body: form.webhookBody || "",
          },
        };
      default:
        return { actionTarget: form.actionTarget, actionParams: {} };
    }
  };

  const createFormRule = async () => {
    if (!form.name || !form.triggerTopic) return;
    const { actionTarget, actionParams } = buildActionFields();
    try {
      await authFetch(`${API_URL}/api/automations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          triggerTopic: form.triggerTopic,
          conditionType: form.conditionType || undefined,
          conditionValue: form.conditionValue || undefined,
          actionType: form.actionType,
          actionTarget,
          actionParams,
          ...(form.completionTier ? { completionTier: form.completionTier } : {}),
          // Non-admins bind the new automation's authorization scope to a tab
          // they can write; admins author unrestricted (no owning tab).
          ...(isAdmin ? {} : { tabId: ownerTabId }),
        }),
      });
      resetForm();
      setShowForm(false);
      fetchRules();
    } catch {}
  };

  const saveScript = async (source: string) => {
    if (!scriptName || !scriptTriggerTopic) return;
    setTranspileErrors([]);

    const isEditing = !!editingRuleId;
    const url = isEditing
      ? `${API_URL}/api/automations/${editingRuleId}`
      : `${API_URL}/api/automations`;
    const method = isEditing ? "PUT" : "POST";

    try {
      const res = await authFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: scriptName,
          triggerTopic: scriptTriggerTopic,
          ruleType: "script",
          scriptSource: source,
          // Owning tab only matters on create; a non-admin binds scope to a tab
          // they can write. On edit (PUT) the server ignores scope fields.
          ...(isEditing || isAdmin ? {} : { tabId: ownerTabId }),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.details) {
          setTranspileErrors(data.details as TranspileError[]);
        }
        return;
      }

      resetScript();
      setShowForm(false);
      fetchRules();
    } catch {}
  };

  const deleteRule = async (id: string) => {
    // Require explicit confirmation before permanently deleting an automation
    // (pre-promotion-release-gates Req 6.3). This is now the only path to deletion.
    if (!window.confirm("Delete this automation? This action cannot be undone.")) {
      return;
    }
    await authFetch(`${API_URL}/api/automations/${id}`, { method: "DELETE" });
    fetchRules();
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    await authFetch(`${API_URL}/api/automations/${id}/toggle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    fetchRules();
  };

  const openScriptForEditing = (rule: AutomationRule) => {
    setCreationMode("script");
    setScriptName(rule.name);
    setScriptTriggerTopic(rule.topic);
    setScriptSource(rule.scriptSource || "");
    setTranspileErrors([]);
    setEditingRuleId(rule.id);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Automations</h1>
        <div className="flex items-center gap-3">
          {canAuthor ? (
            <button
              onClick={() => {
                if (showForm) {
                  setShowForm(false);
                  resetForm();
                  resetScript();
                } else {
                  setShowForm(true);
                }
              }}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
            >
              <Plus size={14} />
              New Rule
            </button>
          ) : (
            <span className="text-xs text-[#6B7785]">
              Authoring requires write access to a tab.
            </span>
          )}
        </div>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-surface border border-[#2A3441] rounded-xl p-5 space-y-4"
          >
            {/* Owning-tab selector — non-admin authors bind scope to a tab they
                can write. The automation may then act only on that tab's devices
                and collections. Admins author unrestricted, so no selector. */}
            {!editingRuleId && !isAdmin && (
              <div className="rounded-lg border border-[#2A3441] bg-background p-3 space-y-1.5">
                <label className="block text-[10px] text-[#6B7785] uppercase">Owning tab</label>
                <select
                  aria-label="Owning tab"
                  value={ownerTabId}
                  onChange={(e) => setOwnerTabId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface border border-[#2A3441] rounded-lg text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
                >
                  {writableTabs.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-[#6B7785]">
                  This automation can act only on the devices and collections this tab exposes.
                </p>
              </div>
            )}

            {/* Mode toggle — segmented control */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#E6EDF3]">
                {editingRuleId ? "Edit Automation Rule" : "Create Automation Rule"}
              </h2>
              {!editingRuleId && (
                <div className="flex rounded-lg border border-[#2A3441] overflow-hidden">
                  <button
                    onClick={() => setCreationMode("form")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                      creationMode === "form"
                        ? "bg-primary/20 text-primary"
                        : "bg-transparent text-[#6B7785] hover:text-[#9AA6B2]"
                    }`}
                  >
                    <FormInput size={13} />
                    Quick Rule
                  </button>
                  <button
                    onClick={() => setCreationMode("script")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                      creationMode === "script"
                        ? "bg-primary/20 text-primary"
                        : "bg-transparent text-[#6B7785] hover:text-[#9AA6B2]"
                    }`}
                  >
                    <Code size={13} />
                    Script
                  </button>
                </div>
              )}
            </div>

            {creationMode === "script" || editingRuleId ? (
              /* ── Script mode ── */
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                      Script Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Smart heating logic"
                      value={scriptName}
                      onChange={(e) => setScriptName(e.target.value)}
                      className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                      Trigger Topic
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. sensor/+/temperature"
                      value={scriptTriggerTopic}
                      onChange={(e) => setScriptTriggerTopic(e.target.value)}
                      className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <Suspense fallback={<div className="flex items-center justify-center h-64 text-neutral-500">Loading editor...</div>}>
                <ScriptEditor
                  initialValue={scriptSource || undefined}
                  onChange={(val) => setScriptSource(val)}
                  onSave={saveScript}
                  errors={transpileErrors}
                />
                </Suspense>

                {transpileErrors.length > 0 && (
                  <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg p-3 space-y-1">
                    {transpileErrors.map((err, i) => (
                      <div key={i} className="text-xs text-[#EF4444] font-mono">
                        Line {err.line}:{err.column} — {err.message}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowForm(false);
                      resetScript();
                    }}
                    className="flex-1 py-2 text-xs font-medium rounded-lg bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => saveScript(scriptSource)}
                    disabled={!scriptName || !scriptTriggerTopic}
                    className="flex-1 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-40"
                  >
                    {editingRuleId ? "Update Script" : "Create Script"}
                  </button>
                </div>
              </div>
            ) : (
              /* ── Quick Rule (form) mode ── */
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                      Rule Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Night motion alert"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                      When (Trigger Topic)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. motion/hallway or sensor/#"
                      value={form.triggerTopic}
                      onChange={(e) => setForm({ ...form, triggerTopic: e.target.value })}
                      className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                      If (Condition — optional)
                    </label>
                    <select
                      value={form.conditionType}
                      onChange={(e) => setForm({ ...form, conditionType: e.target.value })}
                      className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] focus:outline-none focus:border-primary"
                    >
                      <option value="">No condition (always fire)</option>
                      <option value="value_above">Value above threshold</option>
                      <option value="value_below">Value below threshold</option>
                      <option value="equals">Value equals</option>
                    </select>
                  </div>
                  {form.conditionType && (
                    <div>
                      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                        Condition Value
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 25 or true"
                        value={form.conditionValue}
                        onChange={(e) => setForm({ ...form, conditionValue: e.target.value })}
                        className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                  )}
                </div>

                {/* Action type selector */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                      Then (Action)
                    </label>
                    <select
                      value={form.actionType}
                      onChange={(e) => setForm({ ...form, actionType: e.target.value })}
                      className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] focus:outline-none focus:border-primary"
                    >
                      <option value="log">Log message</option>
                      <option value="toggle">Toggle device</option>
                      <option value="publish">Publish MQTT</option>
                      <option value="device_action">Device action</option>
                      <option value="delay">Delay</option>
                      <option value="webhook">Webhook</option>
                    </select>
                  </div>

                  {/* Dynamic fields based on action type */}
                  {form.actionType === "log" && (
                    <div>
                      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                        Log Message
                      </label>
                      <input
                        type="text"
                        placeholder="Motion detected!"
                        value={form.actionMessage}
                        onChange={(e) => setForm({ ...form, actionMessage: e.target.value })}
                        className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                  )}

                  {form.actionType === "toggle" && (
                    <div>
                      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                        Target Device/Topic
                      </label>
                      <input
                        type="text"
                        placeholder="light/bedroom"
                        value={form.actionTarget}
                        onChange={(e) => setForm({ ...form, actionTarget: e.target.value })}
                        className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                  )}
                </div>

                {/* Publish fields */}
                {form.actionType === "publish" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                        Target Topic
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. light/bedroom/set"
                        value={form.publishTopic}
                        onChange={(e) => setForm({ ...form, publishTopic: e.target.value })}
                        className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                        Payload
                      </label>
                      <input
                        type="text"
                        placeholder='e.g. {"state":"ON"}'
                        value={form.publishPayload}
                        onChange={(e) => setForm({ ...form, publishPayload: e.target.value })}
                        className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                )}

                {/* Device action fields */}
                {form.actionType === "device_action" && (
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                        Device ID
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. hue-light-01"
                        value={form.actionTarget}
                        onChange={(e) => setForm({ ...form, actionTarget: e.target.value })}
                        className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                        Action Type
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. setBrightness"
                        value={form.deviceActionType}
                        onChange={(e) => setForm({ ...form, deviceActionType: e.target.value })}
                        className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                        Parameters (JSON)
                      </label>
                      <input
                        type="text"
                        placeholder='e.g. {"brightness":80}'
                        value={form.deviceActionParams}
                        onChange={(e) => setForm({ ...form, deviceActionParams: e.target.value })}
                        className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                )}

                {/* Delay field */}
                {form.actionType === "delay" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                        Duration (ms)
                      </label>
                      <input
                        type="number"
                        placeholder="e.g. 5000"
                        value={form.delayDuration}
                        onChange={(e) => setForm({ ...form, delayDuration: e.target.value })}
                        className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                )}

                {/* Webhook fields */}
                {form.actionType === "webhook" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-2">
                        <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                          URL
                        </label>
                        <input
                          type="text"
                          placeholder="https://example.com/webhook"
                          value={form.webhookUrl}
                          onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
                          className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                          HTTP Method
                        </label>
                        <select
                          value={form.webhookMethod}
                          onChange={(e) => setForm({ ...form, webhookMethod: e.target.value })}
                          className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] focus:outline-none focus:border-primary"
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                          <option value="PATCH">PATCH</option>
                          <option value="DELETE">DELETE</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                        Body
                      </label>
                      <textarea
                        placeholder='e.g. {"event":"motion_detected"}'
                        value={form.webhookBody}
                        onChange={(e) => setForm({ ...form, webhookBody: e.target.value })}
                        rows={3}
                        className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary resize-none"
                      />
                    </div>
                  </div>
                )}

                {/* Advanced options — collapsed by default */}
                {(form.actionType === "device_action" || form.actionType === "toggle") &&
                  form.actionTarget.trim() && (
                    <details className="group">
                      <summary className="text-[10px] text-[#6B7785] uppercase tracking-wider cursor-pointer select-none hover:text-[#9AA6B2] transition-colors">
                        ▸ Advanced options
                      </summary>
                      <div className="mt-3 pl-3 border-l border-[#2A3441]">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                              Completion Tier
                            </label>
                            <select
                              value={form.completionTier}
                              onChange={(e) => setForm({ ...form, completionTier: e.target.value })}
                              className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] focus:outline-none focus:border-primary"
                            >
                              <option value="">Highest available (auto)</option>
                              <option value="dispatch">Dispatch only</option>
                              <option value="acknowledged">Acknowledged</option>
                              <option value="observed">Observed</option>
                            </select>
                            <p className="text-[10px] text-[#6B7785] mt-1">
                              Controls when this automation considers a command successful.
                            </p>
                          </div>
                        </div>
                      </div>
                    </details>
                  )}

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowForm(false);
                      resetForm();
                    }}
                    className="flex-1 py-2 text-xs font-medium rounded-lg bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createFormRule}
                    disabled={!form.name || !form.triggerTopic}
                    className="flex-1 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-40"
                  >
                    Create Rule
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rules list */}
      {(() => {
        const filtered = rules;
        return (
          <div className="space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-[#6B7785]">
                <p className="text-lg">No automation rules</p>
                <p className="text-sm mt-1">
                  Create your first rule to get started
                </p>
              </div>
            ) : (
              filtered.map((rule) => (
                <div
                  key={rule.id}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                    rule.enabled
                      ? "bg-surface border-[#2A3441]"
                      : "bg-surface/50 border-[#2A3441]/50 opacity-60"
                  } ${rule.ruleType === "script" ? "cursor-pointer hover:border-primary/40" : ""}`}
                  onClick={() => {
                    if (rule.ruleType === "script") {
                      openScriptForEditing(rule);
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    <GitBranch
                      size={14}
                      className={
                        rule.enabled ? "text-primary" : "text-[#6B7785]"
                      }
                    />
                    <div>
                      <div className="text-sm text-[#E6EDF3] font-medium">
                        {rule.name}
                      </div>
                      <div className="text-[10px] text-[#6B7785] font-mono">
                        when({rule.topic})
                        {rule.hasCondition && " → if(...)"}
                        {rule.actionType && ` → ${rule.actionType}`}
                        {rule.ruleType === "script" && " → script"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Type badge */}
                    {rule.ruleType === "script" ? (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent">
                        <Code size={10} />
                        script
                      </span>
                    ) : rule.ruleType === "form" ? (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                        <FormInput size={10} />
                        form
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#6B7785]/20 text-[#6B7785]">
                        file
                      </span>
                    )}

                    {rule.source === "ui" && (
                      <>
                        {rule.ruleType === "script" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openScriptForEditing(rule);
                            }}
                            className="p-1 text-[#6B7785] hover:text-primary transition-colors"
                            title="Edit script"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRule(rule.id, !rule.enabled);
                          }}
                          className={`p-1 rounded transition-colors ${
                            rule.enabled
                              ? "text-[#22C55E] hover:text-[#22C55E]/70"
                              : "text-[#6B7785] hover:text-[#9AA6B2]"
                          }`}
                          title={rule.enabled ? "Disable" : "Enable"}
                        >
                          {rule.enabled ? (
                            <Power size={14} />
                          ) : (
                            <PowerOff size={14} />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRule(rule.id);
                          }}
                          className="p-1 text-[#6B7785] hover:text-[#EF4444] transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        );
      })()}
    </div>
  );
}
