// frontend/src/components/CompletionTierField.test.tsx — Acknowledgement level picker

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CompletionTierField } from "./CompletionTierField";
import type { CompletionTierCapability } from "../lib/completion-tier";

const ackOnly: CompletionTierCapability = {
  deviceId: "dev-1",
  resolved: true,
  availableTiers: ["dispatch", "acknowledged"],
  ceiling: "acknowledged",
};

function renderField(props: Partial<React.ComponentProps<typeof CompletionTierField>> = {}) {
  const onChange = vi.fn();
  render(<CompletionTierField id="tier" value="" onChange={onChange} {...props} />);
  return { onChange, select: screen.getByLabelText("Acknowledgement level") };
}

describe("CompletionTierField", () => {
  it("offers automatic plus the three tiers and reports the chosen value", () => {
    const { onChange, select } = renderField();
    expect(select).toHaveValue("");
    expect(screen.getByText(/Highest available/)).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "observed" } });
    expect(onChange).toHaveBeenCalledWith("observed");
  });

  it("explains what the selected level proves", () => {
    renderField({ value: "acknowledged" });
    expect(screen.getByText(/must reply confirming/)).toBeInTheDocument();
  });

  it("appends a caller-supplied hint to the description", () => {
    renderField({ value: "dispatch", hint: "Applies to every command." });
    expect(screen.getByText(/Applies to every command\./)).toBeInTheDocument();
  });

  it("marks the levels a known device cannot prove without blocking them", () => {
    const { select } = renderField({ value: "dispatch", capability: ackOnly });
    // The server accepts any valid tier, so the option stays selectable.
    expect(screen.getByRole("option", { name: /Observed — not supported/ })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Acknowledged" })).toBeInTheDocument();
    expect(select).toBeEnabled();
  });

  it("warns that an over-request will be clamped at dispatch time", () => {
    renderField({ value: "observed", capability: ackOnly });
    expect(screen.getByText(/can only prove/)).toHaveTextContent("Acknowledged");
  });

  it("does not warn for a level at or below the ceiling", () => {
    renderField({ value: "acknowledged", capability: ackOnly });
    expect(screen.queryByText(/can only prove/)).not.toBeInTheDocument();
  });

  it("says so when the target is not a registered device", () => {
    renderField({
      value: "observed",
      capability: { deviceId: "nope", resolved: false, availableTiers: [], ceiling: null },
    });
    expect(screen.getByText(/not a registered device/)).toBeInTheDocument();
    // Unknown ceiling means no clamp claim can be made.
    expect(screen.queryByText(/can only prove/)).not.toBeInTheDocument();
  });

  it("keeps every level selectable when the ceiling could not be determined", () => {
    renderField({ value: "observed", capability: null });
    expect(screen.getByRole("option", { name: "Observed" })).toBeInTheDocument();
    expect(screen.queryByText(/can only prove/)).not.toBeInTheDocument();
    expect(screen.queryByText(/not a registered device/)).not.toBeInTheDocument();
  });

  it("can be disabled", () => {
    const { select } = renderField({ disabled: true });
    expect(select).toBeDisabled();
  });
});
