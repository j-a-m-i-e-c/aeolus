import { useId } from "react";
import { TriggerSelector } from "./TriggerSelector";
import type { AutomationTriggerType } from "./automation-authoring";

interface Props {
  name: string;
  triggerType: AutomationTriggerType;
  mqttTopic: string;
  cronExpression: string;
  onNameChange: (value: string) => void;
  onTriggerTypeChange: (value: AutomationTriggerType) => void;
  onMqttTopicChange: (value: string) => void;
  onCronExpressionChange: (value: string) => void;
  onTriggerValidityChange: (valid: boolean) => void;
  namePlaceholder?: string;
}

/** Shared Name + Trigger authoring surface used everywhere Automations are edited. */
export function AutomationAuthoringFields({
  name,
  triggerType,
  mqttTopic,
  cronExpression,
  onNameChange,
  onTriggerTypeChange,
  onMqttTopicChange,
  onCronExpressionChange,
  onTriggerValidityChange,
  namePlaceholder = "Automation name",
}: Props) {
  // Unique per instance so the label stays correctly associated even when more
  // than one authoring surface is mounted (e.g. a page plus a pane).
  const nameId = useId();
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <label htmlFor={nameId} className="text-[10px] text-[#6B7785] uppercase tracking-wider font-medium block mb-2">Name</label>
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={namePlaceholder}
          className="w-full h-10 px-3 text-sm rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
        />
      </div>
      <TriggerSelector
        triggerType={triggerType}
        mqttTopic={mqttTopic}
        cronExpression={cronExpression}
        onTriggerTypeChange={onTriggerTypeChange}
        onMqttTopicChange={onMqttTopicChange}
        onCronExpressionChange={onCronExpressionChange}
        onValidityChange={onTriggerValidityChange}
      />
    </div>
  );
}
