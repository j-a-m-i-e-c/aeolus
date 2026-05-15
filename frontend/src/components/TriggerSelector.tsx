// frontend/src/components/TriggerSelector.tsx — Inline trigger type selector

import { useState, useEffect, useCallback } from "react";
import { CRON_PRESETS, CUSTOM_PICKER_OPTION, CUSTOM_CRON_OPTION, isValidCron, describeCron } from "../lib/cron-utils";

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

type PickerMode = "interval" | "daily";
type IntervalUnit = "minutes" | "hours";

const DAYS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
];

function generatePickerCron(
  mode: PickerMode,
  intervalValue: number,
  intervalUnit: IntervalUnit,
  time: string,
  selectedDays: number[]
): string {
  if (mode === "interval") {
    if (intervalUnit === "minutes") {
      return `*/${intervalValue} * * * *`;
    }
    return `0 */${intervalValue} * * *`;
  }

  // Daily mode
  const [hours, minutes] = time.split(":").map(Number);
  const h = isNaN(hours) ? 0 : hours;
  const m = isNaN(minutes) ? 0 : minutes;

  if (selectedDays.length === 0 || selectedDays.length === 7) {
    return `${m} ${h} * * *`;
  }

  const dow = [...selectedDays].sort((a, b) => a - b).join(",");
  return `${m} ${h} * * ${dow}`;
}

/** Visual schedule builder for non-technical users */
function CronPicker({ cronExpression, onCronExpressionChange }: {
  cronExpression: string;
  onCronExpressionChange: (expr: string) => void;
}) {
  const [mode, setMode] = useState<PickerMode>("interval");
  const [intervalValue, setIntervalValue] = useState(5);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("minutes");
  const [time, setTime] = useState("09:00");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);

  // Generate and emit cron expression when picker state changes
  const emitCron = useCallback(() => {
    const expr = generatePickerCron(mode, intervalValue, intervalUnit, time, selectedDays);
    onCronExpressionChange(expr);
  }, [mode, intervalValue, intervalUnit, time, selectedDays, onCronExpressionChange]);

  useEffect(() => {
    emitCron();
  }, [emitCron]);

  const toggleDay = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const selectAllDays = () => setSelectedDays([1, 2, 3, 4, 5, 6, 0]);
  const selectWeekdays = () => setSelectedDays([1, 2, 3, 4, 5]);
  const selectWeekends = () => setSelectedDays([6, 0]);

  const cronValid = cronExpression.trim() !== "" && isValidCron(cronExpression);

  return (
    <div className="space-y-3">
      {/* Mode selector */}
      <div className="flex items-center gap-1 p-0.5 rounded-md bg-[#0B0F14] border border-[#2A3441] w-fit">
        <button
          type="button"
          onClick={() => setMode("interval")}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
            mode === "interval"
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-[#6B7785] hover:text-[#9AA6B2] border border-transparent"
          }`}
        >
          Interval
        </button>
        <button
          type="button"
          onClick={() => setMode("daily")}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
            mode === "daily"
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-[#6B7785] hover:text-[#9AA6B2] border border-transparent"
          }`}
        >
          Daily
        </button>
      </div>

      {/* Interval mode */}
      {mode === "interval" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#9AA6B2]">Run every</span>
          <input
            type="number"
            min={1}
            max={intervalUnit === "minutes" ? 59 : 23}
            value={intervalValue}
            onChange={(e) => {
              const v = Math.max(1, Math.min(
                intervalUnit === "minutes" ? 59 : 23,
                Number(e.target.value) || 1
              ));
              setIntervalValue(v);
            }}
            className="w-16 px-2 py-1 text-sm rounded-md bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors text-center"
          />
          <select
            value={intervalUnit}
            onChange={(e) => {
              const unit = e.target.value as IntervalUnit;
              setIntervalUnit(unit);
              // Clamp value to new max
              if (unit === "hours" && intervalValue > 23) {
                setIntervalValue(23);
              }
            }}
            className="px-2 py-1 text-sm rounded-md bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
          </select>
        </div>
      )}

      {/* Daily mode */}
      {mode === "daily" && (
        <div className="space-y-2">
          {/* Time input */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#9AA6B2]">At</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="px-2 py-1 text-sm rounded-md bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Day toggles */}
          <div className="flex flex-wrap gap-1">
            {DAYS.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                  selectedDays.includes(day.value)
                    ? "bg-primary/20 text-primary border-primary/30"
                    : "bg-[#1A2330] text-[#6B7785] border-[#2A3441] hover:text-[#9AA6B2]"
                }`}
              >
                {day.label}
              </button>
            ))}
          </div>

          {/* Quick-select buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAllDays}
              className="text-[11px] text-[#6B7785] hover:text-[#9AA6B2] transition-colors"
            >
              Every day
            </button>
            <button
              type="button"
              onClick={selectWeekdays}
              className="text-[11px] text-[#6B7785] hover:text-[#9AA6B2] transition-colors"
            >
              Weekdays
            </button>
            <button
              type="button"
              onClick={selectWeekends}
              className="text-[11px] text-[#6B7785] hover:text-[#9AA6B2] transition-colors"
            >
              Weekends
            </button>
          </div>
        </div>
      )}

      {/* Cron preview */}
      {cronExpression.trim() !== "" && (
        <div className="space-y-0.5 pt-1 border-t border-[#2A3441]/50">
          <div className="text-[11px] text-[#6B7785] font-mono">
            Preview: {cronExpression}
          </div>
          {cronValid && (
            <div className="text-[11px] text-[#9AA6B2]">
              {describeCron(cronExpression)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TriggerSelector({
  triggerType,
  mqttTopic,
  cronExpression,
  onTriggerTypeChange,
  onMqttTopicChange,
  onCronExpressionChange,
  onValidityChange,
}: TriggerSelectorProps) {
  // Track which preset is selected (or custom picker / custom cron)
  const [selectedPreset, setSelectedPreset] = useState<string>(() => {
    const match = CRON_PRESETS.find((p) => p.expression === cronExpression);
    return match ? match.expression : CUSTOM_CRON_OPTION;
  });

  // Sync preset selection when cronExpression changes externally (e.g. edit mode)
  useEffect(() => {
    // Don't override if user explicitly chose the picker or custom cron
    if (selectedPreset === CUSTOM_PICKER_OPTION || selectedPreset === CUSTOM_CRON_OPTION) return;

    const match = CRON_PRESETS.find((p) => p.expression === cronExpression);
    if (match) {
      setSelectedPreset(match.expression);
    }
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
    if (value !== CUSTOM_CRON_OPTION && value !== CUSTOM_PICKER_OPTION) {
      onCronExpressionChange(value);
    }
    // When switching to picker, it will emit its own cron via the CronPicker component
  };

  const cronValid = cronExpression.trim() === "" || isValidCron(cronExpression);
  const showCronError = triggerType === "cron" && cronExpression.trim() !== "" && !isValidCron(cronExpression);

  return (
    <div className="space-y-2">
      {/* Trigger type label + segmented control */}
      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider font-medium block">
        Trigger
      </label>
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
            <option value={CUSTOM_PICKER_OPTION}>Custom Picker</option>
            <option value={CUSTOM_CRON_OPTION}>Custom Cron</option>
          </select>

          {/* Custom Picker — visual schedule builder */}
          {selectedPreset === CUSTOM_PICKER_OPTION && (
            <CronPicker
              cronExpression={cronExpression}
              onCronExpressionChange={onCronExpressionChange}
            />
          )}

          {/* Custom Cron — raw text input */}
          {selectedPreset === CUSTOM_CRON_OPTION && (
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

          {/* Human-readable description (only for non-picker modes, picker shows its own) */}
          {selectedPreset !== CUSTOM_PICKER_OPTION && cronExpression.trim() !== "" && cronValid && (
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
