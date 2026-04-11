// frontend/src/components/AutomationsPage.tsx — Automation rule editor

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Zap, GitBranch, Power, PowerOff } from "lucide-react";

const API_URL = (import.meta as any).env?.VITE_API_URL || `http://${window.location.hostname}:3001`;

interface AutomationRule {
  id: string;
  name: string;
  topic: string;
  hasCondition: boolean;
  source: "file" | "ui";
  enabled: boolean;
  actionType?: string;
  actionTarget?: string;
  actionParams?: Record<string, unknown>;
  conditionType?: string | null;
  conditionValue?: string | null;
}

export function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showFileRules, setShowFileRules] = useState(true);
  const [form, setForm] = useState({
    name: "", triggerTopic: "", conditionType: "", conditionValue: "",
    actionType: "log", actionTarget: "", actionMessage: "",
  });

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/automations`);
      setRules(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const createRule = async () => {
    if (!form.name || !form.triggerTopic) return;
    try {
      await fetch(`${API_URL}/api/automations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          triggerTopic: form.triggerTopic,
          conditionType: form.conditionType || undefined,
          conditionValue: form.conditionValue || undefined,
          actionType: form.actionType,
          actionTarget: form.actionTarget || form.triggerTopic,
          actionParams: form.actionType === "log" ? { message: form.actionMessage || "Rule fired" } : {},
        }),
      });
      setForm({ name: "", triggerTopic: "", conditionType: "", conditionValue: "", actionType: "log", actionTarget: "", actionMessage: "" });
      setShowForm(false);
      fetchRules();
    } catch {}
  };

  const deleteRule = async (id: string) => {
    await fetch(`${API_URL}/api/automations/${id}`, { method: "DELETE" });
    fetchRules();
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    await fetch(`${API_URL}/api/automations/${id}/toggle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    fetchRules();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Automations</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[#6B7785] cursor-pointer">
            <input
              type="checkbox"
              checked={showFileRules}
              onChange={(e) => setShowFileRules(e.target.checked)}
              className="accent-primary"
            />
            Show code rules
          </label>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
          >
            <Plus size={14} />
            New Rule
          </button>
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
            <h2 className="text-sm font-semibold text-[#E6EDF3]">Create Automation Rule</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">Rule Name</label>
                <input
                  type="text" placeholder="e.g. Night motion alert"
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">When (Trigger Topic)</label>
                <input
                  type="text" placeholder="e.g. motion/hallway or sensor/#"
                  value={form.triggerTopic} onChange={(e) => setForm({ ...form, triggerTopic: e.target.value })}
                  className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">If (Condition — optional)</label>
                <select
                  value={form.conditionType} onChange={(e) => setForm({ ...form, conditionType: e.target.value })}
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
                  <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">Condition Value</label>
                  <input
                    type="text" placeholder="e.g. 25 or true"
                    value={form.conditionValue} onChange={(e) => setForm({ ...form, conditionValue: e.target.value })}
                    className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">Then (Action)</label>
                <select
                  value={form.actionType} onChange={(e) => setForm({ ...form, actionType: e.target.value })}
                  className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] focus:outline-none focus:border-primary"
                >
                  <option value="log">Log message</option>
                  <option value="toggle">Toggle device</option>
                  <option value="publish">Publish MQTT</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
                  {form.actionType === "log" ? "Log Message" : "Target Device/Topic"}
                </label>
                <input
                  type="text"
                  placeholder={form.actionType === "log" ? "Motion detected!" : "light/bedroom"}
                  value={form.actionType === "log" ? form.actionMessage : form.actionTarget}
                  onChange={(e) => form.actionType === "log"
                    ? setForm({ ...form, actionMessage: e.target.value })
                    : setForm({ ...form, actionTarget: e.target.value })
                  }
                  className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Preview */}
            <div className="bg-background rounded-lg p-3 font-mono text-xs text-[#9AA6B2]">
              <span className="text-primary">when</span>(<span className="text-accent">"{form.triggerTopic || '...'}"</span>)
              {form.conditionType && (
                <><br />  .<span className="text-primary">if</span>(value {form.conditionType === "value_above" ? ">" : form.conditionType === "value_below" ? "<" : "==="} <span className="text-accent">{form.conditionValue || "..."}</span>)</>
              )}
              <br />  .<span className="text-primary">then</span>(<span className="text-accent">{form.actionType}</span>)
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-2 text-xs font-medium rounded-lg bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createRule}
                disabled={!form.name || !form.triggerTopic}
                className="flex-1 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-40"
              >
                Create Rule
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rules list */}
      {(() => {
        const filtered = showFileRules ? rules : rules.filter((r) => r.source === "ui");
        return (
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-[#6B7785]">
            <p className="text-lg">No automation rules</p>
            <p className="text-sm mt-1">Create your first rule to get started</p>
          </div>
        ) : (
          filtered.map((rule) => (
            <div
              key={rule.id}
              className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                rule.enabled
                  ? "bg-surface border-[#2A3441]"
                  : "bg-surface/50 border-[#2A3441]/50 opacity-60"
              }`}
            >
              <div className="flex items-center gap-3">
                <GitBranch size={14} className={rule.enabled ? "text-primary" : "text-[#6B7785]"} />
                <div>
                  <div className="text-sm text-[#E6EDF3] font-medium">{rule.name}</div>
                  <div className="text-[10px] text-[#6B7785] font-mono">
                    when({rule.topic})
                    {rule.hasCondition && " → if(...)"}
                    {rule.actionType && ` → ${rule.actionType}`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  rule.source === "file" ? "bg-[#6B7785]/20 text-[#6B7785]" : "bg-primary/20 text-primary"
                }`}>
                  {rule.source}
                </span>
                {rule.source === "ui" && (
                  <>
                    <button
                      onClick={() => toggleRule(rule.id, !rule.enabled)}
                      className={`p-1 rounded transition-colors ${rule.enabled ? "text-[#22C55E] hover:text-[#22C55E]/70" : "text-[#6B7785] hover:text-[#9AA6B2]"}`}
                      title={rule.enabled ? "Disable" : "Enable"}
                    >
                      {rule.enabled ? <Power size={14} /> : <PowerOff size={14} />}
                    </button>
                    <button
                      onClick={() => deleteRule(rule.id)}
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