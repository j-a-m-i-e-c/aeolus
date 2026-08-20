// frontend/src/components/AutomationsPage.tsx — Automation authoring and rule list
//
// Authoring is code-only. The former form-based "Quick Rule" mode was retired: every
// automation Aeolus ships or seeds is a script rule, and a second authoring surface
// meant shared settings had to be built and placed twice. The form RUNTIME is
// untouched — existing `rule_type = 'form'` rows still load, run, toggle and delete;
// they simply cannot be authored here any more.
//
// There is deliberately no acknowledgement-level control here. One automation may
// command many devices with different acknowledgement capabilities, so a single
// rule-wide level could only ever be an aspiration the command boundary clamped per
// device. A tier is chosen per call in Logic via `devices.action(..., { tier })`, or
// omitted so each device resolves to the strongest level it can actually prove.

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

  // Authoring state
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

  const resetAuthoring = () => {
    setScriptName("");
    setScriptTriggerTopic("");
    setScriptSource("");
    setTranspileErrors([]);
    setEditingRuleId(null);
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

      resetAuthoring();
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

  const openForEditing = (rule: AutomationRule) => {
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
                  resetAuthoring();
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

      {/* Authoring panel — create and edit share one surface, so a setting is
          defined in exactly one place for both. */}
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

            <h2 className="text-sm font-semibold text-[#E6EDF3]">
              {editingRuleId ? "Edit Automation" : "Create Automation"}
            </h2>

            <div className="space-y-4">
              {/* Trigger setup */}
              <div className="rounded-lg border border-[#2A3441] bg-background p-3 space-y-3">
                <p className="text-[10px] text-[#6B7785] uppercase tracking-wider">Trigger</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="automation-name"
                      className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1"
                    >
                      Name
                    </label>
                    <input
                      id="automation-name"
                      type="text"
                      placeholder="e.g. Smart heating logic"
                      value={scriptName}
                      onChange={(e) => setScriptName(e.target.value)}
                      className="w-full text-xs bg-surface border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="automation-trigger-topic"
                      className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1"
                    >
                      Trigger Topic
                    </label>
                    <input
                      id="automation-trigger-topic"
                      type="text"
                      placeholder="e.g. sensor/+/temperature"
                      value={scriptTriggerTopic}
                      onChange={(e) => setScriptTriggerTopic(e.target.value)}
                      className="w-full text-xs bg-surface border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                    />
                  </div>
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
                    resetAuthoring();
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
                  {editingRuleId ? "Update Automation" : "Create Automation"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rules list */}
      <div className="space-y-2">
        {rules.length === 0 ? (
          <div className="text-center py-12 text-[#6B7785]">
            <p className="text-lg">No automation rules</p>
            <p className="text-sm mt-1">
              Create your first rule to get started
            </p>
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                rule.enabled
                  ? "bg-surface border-[#2A3441]"
                  : "bg-surface/50 border-[#2A3441]/50 opacity-60"
              } ${rule.ruleType === "script" ? "cursor-pointer hover:border-primary/40" : ""}`}
              onClick={() => {
                if (rule.ruleType === "script") {
                  openForEditing(rule);
                }
              }}
            >
              <div className="flex items-center gap-3">
                <GitBranch
                  size={14}
                  className={rule.enabled ? "text-primary" : "text-[#6B7785]"}
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
                          openForEditing(rule);
                        }}
                        className="p-1 text-[#6B7785] hover:text-primary transition-colors"
                        title="Edit automation"
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
                      {rule.enabled ? <Power size={14} /> : <PowerOff size={14} />}
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
    </div>
  );
}
