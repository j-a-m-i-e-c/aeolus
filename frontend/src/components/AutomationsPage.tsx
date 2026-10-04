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

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
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
const AutomationProjectEditor = lazy(() => import("./AutomationProjectEditor").then(m => ({ default: m.AutomationProjectEditor })));
import type { AutomationProjectSource } from "./AutomationProjectEditor";
import { AutomationAuthoringFields } from "./AutomationAuthoringFields";
import {
  createDefaultAutomationProject,
  describeAutomationTrigger,
  triggerCarriesPattern,
  triggerIsConfigured,
  type AutomationTriggerType,
  type TranspileError,
} from "./automation-authoring";
import { useAutomationDraft } from "../hooks/useAutomationDraft";
import { putAutomationDraft, deleteAutomationDraft } from "../lib/automation-drafts";
import { AutomationDraftBanner } from "./AutomationDraftBanner";
import { authFetch } from "../lib/auth-fetch";
import { useAuthStore } from "../store/auth-store";
import { usePermissionsStore } from "../store/permissions-store";
import { useDashboardStore } from "../store/dashboard-store";
import { useConfigurationInvalidationStore } from "../store/configuration-invalidation-store";
import { createMutationId } from "../lib/mutation-id";

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
  ownerTabId?: string | null;
  authoredUnrestricted?: boolean;
  triggerType?: AutomationTriggerType;
  cronExpression?: string | null;
  revision: number;
}

export function AutomationsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.id) ?? "anonymous";
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
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>("mqtt");
  const [cronExpression, setCronExpression] = useState("");
  const [triggerValid, setTriggerValid] = useState(true);
  const [projectSource, setProjectSource] = useState<AutomationProjectSource>(() => createDefaultAutomationProject());
  const [newProjectSession, setNewProjectSession] = useState(0);
  const [transpileErrors, setTranspileErrors] = useState<TranspileError[]>([]);
  // Surfaced outside the authoring panel: a failed project read deliberately
  // leaves the panel closed, so an in-panel error would never be seen.
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);

  // Editing state
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const serverRevisionAtOpen = useRef<number | null>(null);
  /**
   * The newest invalidation already acted on.
   *
   * The effect below also re-runs when the open editor changes, which would
   * otherwise replay the current invalidation against the editor that just
   * opened — reporting a remote change for something the editor loaded fresh a
   * moment ago. Only a sequence newer than this one is new information.
   */
  const handledAutomationSequence = useRef(0);
  const automationSequence = useConfigurationInvalidationStore((state) => state.automationSequence);
  const reconcileSequence = useConfigurationInvalidationStore((state) => state.reconcileSequence);
  const localMutationIds = useRef(new Set<string>());
  const draftKey = `${userId}:page:${editingRuleId || "new"}`;
  const draftPayload = { name: scriptName, topic: scriptTriggerTopic, triggerType, cronExpression, project: projectSource, ownerTabId };
  const draft = useAutomationDraft({
    key: draftKey,
    enabled: showForm,
    payload: draftPayload,
    restore: (saved) => {
      setScriptName(saved.name); setScriptTriggerTopic(saved.topic);
      setTriggerType(saved.triggerType); setCronExpression(saved.cronExpression);
      setProjectSource(saved.project); setOwnerTabId(saved.ownerTabId);
    },
  });

  const fetchRules = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/automations`);
      setRules(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  useEffect(() => {
    if (!automationSequence || automationSequence <= handledAutomationSequence.current) return;
    const state = useConfigurationInvalidationStore.getState();
    const change = Object.values(state.automationById).find((candidate) => candidate.sequence === automationSequence);
    if (!change) return;
    handledAutomationSequence.current = automationSequence;

    // Consume this editor's one expected echo even if the save already closed the
    // editor. A later client cannot then reuse the same id to hide a remote change.
    if (change.mutationId && localMutationIds.current.delete(change.mutationId)) return;

    if (!editingRuleId || change.id !== editingRuleId) {
      void fetchRules();
      return;
    }
    if (change.deleted) {
      setProjectLoadError("This automation was deleted in another browser. Your local draft is retained.");
      return;
    }
    if (change.revision != null && serverRevisionAtOpen.current != null && change.revision > serverRevisionAtOpen.current) {
      setProjectLoadError("This automation changed in another browser. Your local draft is retained; reload and reconcile before saving.");
      return;
    }
    void fetchRules();
  }, [automationSequence, editingRuleId, fetchRules]);

  useEffect(() => {
    if (!reconcileSequence) return;

    // A WebSocket snapshot is a reconciliation boundary. Refresh the passive
    // list even when no editor is open so renames/deletes missed during a
    // disconnect cannot leave this page stale indefinitely.
    void fetchRules();

    if (!editingRuleId || !showForm) return;
    void (async () => {
      try {
        const response = await authFetch(`${API_URL}/api/automations/${editingRuleId}/project`);
        if (response.status === 404) {
          setProjectLoadError("This automation was deleted or is no longer available. Your local draft is retained.");
          return;
        }
        if (!response.ok) return;
        const latest = await response.json() as { revision?: number };
        if (Number.isInteger(latest.revision) && serverRevisionAtOpen.current != null && latest.revision! > serverRevisionAtOpen.current) {
          setProjectLoadError("This automation changed while this browser was disconnected. Your local draft is retained; reload and reconcile before saving.");
        }
      } catch {}
    })();
  }, [reconcileSequence, editingRuleId, showForm, fetchRules]);

  const resetAuthoring = () => {
    setScriptName("");
    setScriptTriggerTopic("");
    setTriggerType("mqtt");
    setCronExpression("");
    setTriggerValid(true);
    setProjectSource(createDefaultAutomationProject());
    setNewProjectSession((session) => session + 1);
    setTranspileErrors([]);
    setProjectLoadError(null);
    setEditingRuleId(null);
    serverRevisionAtOpen.current = null;
  };

  const saveScript = async () => {
    if (!scriptName.trim() || !triggerIsConfigured(triggerType, scriptTriggerTopic, cronExpression, triggerValid)) return;
    setTranspileErrors([]);

    const isEditing = !!editingRuleId;
    const url = isEditing
      ? `${API_URL}/api/automations/${editingRuleId}`
      : `${API_URL}/api/automations`;
    const method = isEditing ? "PUT" : "POST";

    try {
      const mutationId = createMutationId();
      localMutationIds.current.add(mutationId);
      const res = await authFetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Aeolus-Mutation-Id": mutationId,
          ...(isEditing && serverRevisionAtOpen.current != null
            ? { "If-Match": `"${serverRevisionAtOpen.current}"` }
            : {}),
        },
        body: JSON.stringify({
          name: scriptName.trim(),
          // `mqtt` and `shared-state` both carry a pattern; cron and manual do not.
          triggerTopic: triggerCarriesPattern(triggerType) ? scriptTriggerTopic.trim() : undefined,
          triggerType,
          cronExpression: triggerType === "cron" ? cronExpression : undefined,
          ruleType: "script",
          project: projectSource,
          // Owning tab only matters on create; a non-admin binds scope to a tab
          // they can write. On edit (PUT) the server ignores scope fields.
          ...(isEditing || isAdmin ? {} : { tabId: ownerTabId }),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409) {
          setProjectLoadError(data.error || "This automation changed on the server. Your browser draft is retained; reload and reconcile before saving.");
        } else if (data.details) {
          setTranspileErrors(data.details as TranspileError[]);
        }
        return;
      }

      const saved = await res.json() as { id: string; revision: number };
      const newer = draft.markSaved(draftPayload);
      if (newer) {
        // The submitted version was saved, but the editor moved on. Keep it
        // open; on a create, transfer recovery to the newly created ID.
        if (!isEditing) {
          const newKey = `${userId}:page:${saved.id}`;
          await putAutomationDraft({ key: newKey, baseline: JSON.stringify(draftPayload), payload: newer, savedAt: Date.now() });
          await deleteAutomationDraft(draftKey);
          setEditingRuleId(saved.id);
        }
        serverRevisionAtOpen.current = saved.revision;
        setProjectLoadError("The submitted version was saved, but you made newer edits during the request. They are retained locally; save again when ready.");
        fetchRules();
        return;
      }
      resetAuthoring();
      setShowForm(false);
      fetchRules();
    } catch {}
  };

  const deleteRule = async (id: string) => {
    if (!window.confirm("Delete this automation? This action cannot be undone.")) return;
    const rule = rules.find((candidate) => candidate.id === id);
    if (!rule) return;
    const mutationId = createMutationId();
    localMutationIds.current.add(mutationId);
    const res = await authFetch(`${API_URL}/api/automations/${id}`, {
      method: "DELETE",
      headers: {
        "If-Match": `"${rule.revision}"`,
        "X-Aeolus-Mutation-Id": mutationId,
      },
    });
    if (res.status === 409) {
      setProjectLoadError("This automation changed before it could be deleted. Reload the latest version and try again.");
    }
    await fetchRules();
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    await authFetch(`${API_URL}/api/automations/${id}/toggle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    fetchRules();
  };

  const openForEditing = async (rule: AutomationRule) => {
    setScriptName(rule.name);
    setScriptTriggerTopic(rule.topic || "");
    setTriggerType(rule.triggerType || "mqtt");
    setCronExpression(rule.cronExpression || "");
    setTriggerValid(true);
    setTranspileErrors([]);
    setProjectLoadError(null);
    try {
      // The project endpoint transparently projects pre-Project automations too.
      // Existing installations therefore use the same authoring surface as new
      // automations and the public demo. Saving promotes the projection into a
      // persisted Automation Project.
      const response = await authFetch(`${API_URL}/api/automations/${rule.id}/project`);
      if (!response.ok) throw new Error("Failed to load Automation Project");
      const loaded = await response.json() as AutomationProjectSource & { revision: number };
      const { revision, ...project } = loaded;
      serverRevisionAtOpen.current = revision;
      setProjectSource(project);
    } catch {
      // Fail closed rather than opening the editor with a stale/default Project:
      // saving that state could overwrite valid authored source after a transient
      // project-read failure. The panel stays closed, so report it at page level.
      setProjectLoadError("Failed to load Automation Project source");
      return;
    }
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
              New Automation
            </button>
          ) : (
            <span className="text-xs text-[#6B7785]">
              Authoring requires write access to a tab.
            </span>
          )}
        </div>
      </div>

      {/* Project read failed, so the authoring panel stayed closed on purpose.
          Report it here rather than inside the panel nobody can see. */}
      {projectLoadError && (
        <div
          role="alert"
          className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg p-3 text-xs text-[#EF4444]"
        >
          {projectLoadError}
        </div>
      )}

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
              {draft.recovery && <AutomationDraftBanner savedAt={draft.recovery.savedAt}
                conflict={draft.recovery.baseline !== draft.serverBaseline}
                onRestore={draft.recover} onDiscard={draft.discardRecovery} />}
              {draft.savedAt && !draft.recovery && <p role="status" className="text-[10px] text-[#73D99A]">Local recovery draft saved {new Date(draft.savedAt).toLocaleTimeString()}</p>}
              {draft.storageError && <p role="alert" className="text-xs text-amber-400">Local draft storage is unavailable. Save or copy your work before leaving.</p>}
              <div className="rounded-lg border border-[#2A3441] bg-background p-3">
                <AutomationAuthoringFields
                  name={scriptName}
                  triggerType={triggerType}
                  mqttTopic={scriptTriggerTopic}
                  cronExpression={cronExpression}
                  onNameChange={setScriptName}
                  onTriggerTypeChange={setTriggerType}
                  onMqttTopicChange={setScriptTriggerTopic}
                  onCronExpressionChange={setCronExpression}
                  onTriggerValidityChange={setTriggerValid}
                  namePlaceholder="e.g. Smart heating logic"
                />
              </div>

              <Suspense fallback={<div className="flex items-center justify-center h-64 text-neutral-500">Loading editor...</div>}>
                <div className="h-[420px]">
                  <AutomationProjectEditor
                    project={projectSource}
                    projectKey={editingRuleId || `new-automation-${newProjectSession}`}
                    onChange={setProjectSource}
                    onSave={saveScript}
                    errors={transpileErrors}
                  />
                </div>
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
                  onClick={saveScript}
                  disabled={!scriptName.trim() || !triggerIsConfigured(triggerType, scriptTriggerTopic, cronExpression, triggerValid)}
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
                    {describeAutomationTrigger(rule)}
                    {rule.hasCondition && " → if(...)"}
                    {rule.actionType && ` → ${rule.actionType}`}
                    {rule.ruleType === "script" && " → Logic"}
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
