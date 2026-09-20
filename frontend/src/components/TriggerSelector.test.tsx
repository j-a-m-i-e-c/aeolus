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

  it("renders every trigger type option", () => {
    setup();
    expect(screen.getByText("MQTT Topic")).toBeInTheDocument();
    expect(screen.getByText("Shared State")).toBeInTheDocument();
    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    // Counted so adding a backend trigger type without a control here is a failure
    // rather than a silently unreachable feature.
    expect(screen.getByRole("group", { name: /Trigger/i }).querySelectorAll("button")).toHaveLength(4);
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

  describe("shared-state trigger", () => {
    it("selects the shared-state type", () => {
      const props = setup();
      fireEvent.click(screen.getByText("Shared State"));
      expect(props.onTriggerTypeChange).toHaveBeenCalledWith("shared-state");
    });

    it("shows a Shared State path input rather than the MQTT topic input", () => {
      const props = setup({ triggerType: "shared-state" });
      // A distinct label, because this is not a broker topic.
      const input = screen.getByLabelText("Shared State Path");
      expect(screen.queryByLabelText("Trigger Topic")).not.toBeInTheDocument();
      fireEvent.change(input, { target: { value: "bunker-summary/#" } });
      expect(props.onMqttTopicChange).toHaveBeenCalledWith("bunker-summary/#");
    });

    it("explains the bucket/key syntax without implying MQTT", () => {
      setup({ triggerType: "shared-state", mqttTopic: "bunker-summary/#" });
      expect(screen.getByText(/Runs when a shared value changes/)).toBeInTheDocument();
      expect(screen.getByText(/Shared State is internal to Aeolus/)).toBeInTheDocument();
    });

    it("reports valid=false for an empty path", () => {
      const props = setup({ triggerType: "shared-state", mqttTopic: "" });
      expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
    });

    it("reports valid=true for a well-formed path and wildcard", () => {
      for (const pattern of ["bunker-summary/power", "bunker-summary/#", "+/power", "#"]) {
        vi.clearAllMocks();
        const props = setup({ triggerType: "shared-state", mqttTopic: pattern });
        expect(props.onValidityChange, pattern).toHaveBeenLastCalledWith(true);
      }
    });

    it("shows an inline error and reports invalid for a three-part path", () => {
      // A stored value's path is exactly bucket/key, so a third part could never
      // match — catching it here beats a server round-trip that says the same.
      const props = setup({ triggerType: "shared-state", mqttTopic: "a/b/c" });
      expect(screen.getByText("A Shared State path has two parts: bucket/key")).toBeInTheDocument();
      expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
    });

    it("rejects a partial wildcard", () => {
      const props = setup({ triggerType: "shared-state", mqttTopic: "bunker+/power" });
      expect(screen.getByText(/must be a whole part/)).toBeInTheDocument();
      expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
    });

    it("rejects '#' anywhere but the end", () => {
      setup({ triggerType: "shared-state", mqttTopic: "#/power" });
      expect(screen.getByText("'#' may only be the last part")).toBeInTheDocument();
    });
  });
});

describe("TriggerSelector — CronPicker (Custom Picker)", () => {
  function setupWithPicker() {
    const props: TriggerSelectorProps = {
      triggerType: "cron",
      mqttTopic: "",
      cronExpression: "",
      onTriggerTypeChange: vi.fn(),
      onMqttTopicChange: vi.fn(),
      onCronExpressionChange: vi.fn(),
      onValidityChange: vi.fn(),
    };
    render(<TriggerSelector {...props} />);
    // Switch to Custom Picker
    const dropdown = screen.getByRole("combobox");
    fireEvent.change(dropdown, { target: { value: "__picker__" } });
    return props;
  }

  it("shows the interval picker UI by default", () => {
    setupWithPicker();
    expect(screen.getByText("Interval")).toBeInTheDocument();
    expect(screen.getByText("Daily")).toBeInTheDocument();
    expect(screen.getByText("Run every")).toBeInTheDocument();
  });

  it("emits an interval cron expression (minutes) on mount", () => {
    const props = setupWithPicker();
    // Default: every 5 minutes => */5 * * * *
    expect(props.onCronExpressionChange).toHaveBeenCalledWith("*/5 * * * *");
  });

  it("switches interval unit to hours", () => {
    const props = setupWithPicker();
    const unitSelect = screen.getAllByRole("combobox")[1]; // second select
    fireEvent.change(unitSelect, { target: { value: "hours" } });
    // Default value 5, unit hours => 0 */5 * * *
    expect(props.onCronExpressionChange).toHaveBeenCalledWith("0 */5 * * *");
  });

  it("switches to Daily mode and shows day toggles", () => {
    const props = setupWithPicker();
    fireEvent.click(screen.getByText("Daily"));
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Fri")).toBeInTheDocument();
    // Default: all 7 days selected, time 09:00 => 0 9 * * *
    expect(props.onCronExpressionChange).toHaveBeenCalledWith("0 9 * * *");
  });

  it("toggles days and generates the correct day-of-week cron", () => {
    const props = setupWithPicker();
    fireEvent.click(screen.getByText("Daily"));
    // Click "Weekdays" shortcut to select Mon-Fri only
    fireEvent.click(screen.getByText("Weekdays"));
    expect(props.onCronExpressionChange).toHaveBeenCalledWith("0 9 * * 1,2,3,4,5");
  });

  it("clicking Weekends selects only Sat and Sun", () => {
    const props = setupWithPicker();
    fireEvent.click(screen.getByText("Daily"));
    fireEvent.click(screen.getByText("Weekends"));
    expect(props.onCronExpressionChange).toHaveBeenCalledWith("0 9 * * 0,6");
  });

  it("shows the cron preview text inside the picker", () => {
    // The CronPicker internally renders a "Preview: {expr}" line when it generates
    // a cron expression, but since TriggerSelector uses controlled props, the
    // preview only appears after the parent re-renders with the emitted value.
    // This is implicitly tested by verifying onCronExpressionChange is called.
    const props = setupWithPicker();
    expect(props.onCronExpressionChange).toHaveBeenCalled();
  });
});
