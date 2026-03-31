// frontend/src/components/AutomationsPanel.tsx — Active automation rules display

import { useEffect, useState } from "react";
import { fetchAutomations, type AutomationRule } from "../lib/api-client";
import { Zap, GitBranch } from "lucide-react";

export function AutomationsPanel() {
  const [rules, setRules] = useState<AutomationRule[]>([]);

  useEffect(() => {
    fetchAutomations()
      .then(setRules)
      .catch(() => {});
  }, []);

  if (rules.length === 0) return null;

  return (
    <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
      <h2 className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider mb-3 flex items-center gap-2">
        <Zap size={14} className="text-accent" />
        Automations
      </h2>
      <div className="space-y-2">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center justify-between py-2 px-3 rounded-lg bg-elevated/50 border border-[#2A3441]"
          >
            <div className="flex items-center gap-2">
              <GitBranch size={14} className="text-primary" />
              <div>
                <span className="text-sm text-[#E6EDF3]">
                  {rule.name || "Unnamed Rule"}
                </span>
                <span className="text-xs text-[#6B7785] ml-2 font-mono">
                  {rule.topic}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {rule.hasCondition && (
                <span className="text-[10px] bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                  conditional
                </span>
              )}
              <span className="text-[10px] bg-success/20 text-success px-1.5 py-0.5 rounded">
                active
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
