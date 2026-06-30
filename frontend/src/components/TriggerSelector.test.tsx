// frontend/src/components/TriggerSelector.test.tsx — Behaviour tests for the trigger selector

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TriggerSelector, type TriggerSelectorProps } from "./TriggerSelector";

function setup(overrides: Partial<TriggerSelectorProps> = {}) {
  const props: TriggerSelectorProps = {
    triggerType: "mqtt",
    mqttTopic: "",
    cronExpression: "",
    onTriggerTypeChange: vi.fn(),
    onMqttTopicChange: vi.fn(),
    onCronExpressionChange: vi.fn(),
    onValidityChange: vi.fn(),
    ...overrides,
  };
  render(<TriggerSelector {...props} />);
  return props;
}

describe("TriggerSelector", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the three trigger type options", () => {
    setup();
    expect(screen.getByText("MQTT Topic")).toBeInTheDocument();
    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("emits a trigger type change when an option is clicked", () => {
    const props = setup();
    fireEvent.click(screen.getByText("Schedule"));
    expect(props.onTriggerTypeChange).toHaveBeenCalledWith("cron");
  });

  it("shows the MQTT topic input and reports edits in mqtt mode", () => {
    const props = setup({ triggerType: "mqtt" });
    const input = screen.getByPlaceholderText("e.g. sensor/+/temperature");
    fireEvent.change(input, { target: { value: "sensor/+/temp" } });
    expect(props.onMqttTopicChange).toHaveBeenCalledWith("sensor/+/temp");
  });

  it("reports valid=true for non-cron triggers", () => {
    const props = setup({ triggerType: "none" });
    expect(props.onValidityChange).toHaveBeenCalledWith(true);
  });

  it("reports valid=false for an empty/invalid cron expression", () => {
    const props = setup({ triggerType: "cron", cronExpression: "not a cron" });
    expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("reports valid=true for a well-formed cron expression", () => {
    const props = setup({ triggerType: "cron", cronExpression: "*/5 * * * *" });
    expect(props.onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("emits a preset expression when a schedule preset is chosen", () => {
    const props = setup({ triggerType: "cron", cronExpression: "* * * * *" });
    const dropdown = screen.getByRole("combobox");
    fireEvent.change(dropdown, { target: { value: "0 0 * * *" } });
    expect(props.onCronExpressionChange).toHaveBeenCalledWith("0 0 * * *");
  });

  it("shows an inline error for an invalid custom cron expression", () => {
    setup({ triggerType: "cron", cronExpression: "99 99 99 99 99" });
    expect(screen.getByText(/Invalid cron expression/)).toBeInTheDocument();
  });

  it("shows the manual-only hint for the none trigger", () => {
    setup({ triggerType: "none" });
    expect(screen.getByText("Runs only when manually triggered")).toBeInTheDocument();
  });
});
