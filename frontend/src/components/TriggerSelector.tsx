// frontend/src/components/TriggerSelector.tsx — Inline trigger type selector

import { useState, useEffect } from "react";
import { CRON_PRESETS, isValidCron, describeCron } from "../lib/cron-utils";

type TriggerType = "mqtt" | "cron" | "none";

export interface TriggerSelectorProps {
  triggerType: TriggerType;
  mqttTopic: string;
  cronExpression: string;
  onTriggerTypeChange: (type: TriggerType) => void;
  onMqttTopicChange: (topic: string) => void;
  onCronExpressionChange: (expr: string) => void;
  onValidityChange: (valid: boolean) => void;
}

const TRIGGER_OPTIONS: { value: TriggerType; label: string }[] = [
  { value: "mqtt", label: "MQTT Topic" },
  { value: "cron", label: "Schedule" },
  { value: "none", label: "None" },
];

const CUSTOM_OPTION = "custom";

export function TriggerSelector({
  triggerType,
  mqttTopic,
  cronExpression,
  onTriggerTypeChange,
  onMqttTopicChange,
  onCronExpressionChange,
  onValidityChange,
}: TriggerSelectorProps) {
  // Track which preset is selected (or "custom" for free-form)
  const [selectedPreset, setSelectedPreset] = useState<string>(() => {
    const match = CRON_PRESETS.find((p) => p.expression === cronExpression);
    return match ? match.expression : CUSTOM_OPTION;
  });

  // Sync preset selection when cronExpression changes externally (e.g. edit mode)
  useEffect(() => {
    const match = CRON_PRESETS.find((p) => p.expression === cronExpression);
    setSelectedPreset(match ? match.expression : CUSTOM_OPTION);
  }, [cronExpression]);

  // Validate cron expression and report validity
  useEffect(() => {
    if (triggerType !== "cron") {
      onValidityChange(true);
      return;
    }
    const valid = cronExpression.trim() !== "" && isValidCron(cronExpression);
    onValidityChange(valid);
  }, [triggerType, cronExpression, onValidityChange]);

  const handlePresetChange = (value: string) => {
    setSelectedPreset(value);
    if (value !== CUSTOM_OPTION) {
      onCronExpressionChange(value);
    }
  };

  const cronValid = cronExpression.trim() === "" || isValidCron(cronExpression);
  const showCronError = triggerType === "cron" && cronExpression.trim() !== "" && !isValidCron(cronExpression);

  return (
    <div className="space-y-2">
      {/* Segmented control */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0F14] border border-[#2A3441]">
        {TRIGGER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onTriggerTypeChange(opt.value)}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              triggerType === opt.value
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-[#6B7785] hover:text-[#9AA6B2] border border-transparent"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* MQTT Topic input */}
      {triggerType === "mqtt" && (
        <input
          type="text"
          value={mqttTopic}
          onChange={(e) => onMqttTopicChange(e.target.value)}
          placeholder="e.g. sensor/+/temperature"
          className="w-full px-3 py-2 text-sm rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors font-mono"
        />
      )}

      {/* Schedule (cron) configuration */}
      {triggerType === "cron" && (
        <div className="space-y-2">
          {/* Preset dropdown */}
          <select
            value={selectedPreset}
            onChange={(e) => handlePresetChange(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
          >
            {CRON_PRESETS.map((preset) => (
              <option key={preset.expression} value={preset.expression}>
                {preset.label}
              </option>
            ))}
            <option value={CUSTOM_OPTION}>Custom</option>
          </select>

          {/* Cron expression input — editable only in custom mode */}
          {selectedPreset === CUSTOM_OPTION && (
            <input
              type="text"
              value={cronExpression}
              onChange={(e) => onCronExpressionChange(e.target.value)}
              placeholder="e.g. */5 * * * *"
              className={`w-full px-3 py-2 text-sm rounded-lg bg-[#0B0F14] border text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none transition-colors font-mono ${
                showCronError
                  ? "border-[#EF4444] focus:border-[#EF4444]"
                  : "border-[#2A3441] focus:border-primary"
              }`}
            />
          )}

          {/* Inline error for invalid cron */}
          {showCronError && (
            <div className="text-[11px] text-[#EF4444]">
              Invalid cron expression. Use five-field format: minute hour day month weekday
            </div>
          )}

          {/* Human-readable description */}
          {cronExpression.trim() !== "" && cronValid && (
            <div className="text-[11px] text-[#9AA6B2]">
              {describeCron(cronExpression)}
            </div>
          )}
        </div>
      )}

      {/* None hint */}
      {triggerType === "none" && (
        <div className="text-[11px] text-[#6B7785] px-1">
          Runs only when manually triggered
        </div>
      )}
    </div>
  );
}
