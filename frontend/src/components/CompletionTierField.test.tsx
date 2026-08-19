// frontend/src/components/CompletionTierField.test.tsx — Acknowledgement level picker

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CompletionTierField } from "./CompletionTierField";

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

  it("keeps every level selectable, since the boundary clamps at dispatch time", () => {
    renderField();
    for (const label of ["Dispatch only", "Acknowledged", "Observed"]) {
      expect(screen.getByRole("option", { name: label })).toBeEnabled();
    }
  });

  it("explains what the selected level proves", () => {
    renderField({ value: "acknowledged" });
    expect(screen.getByText(/must reply confirming/)).toBeInTheDocument();
  });

  it("describes the automatic default when no level is chosen", () => {
    renderField({ value: "" });
    expect(screen.getByText(/strongest level the target device can actually prove/)).toBeInTheDocument();
  });

  it("appends a caller-supplied hint to the description", () => {
    renderField({ value: "dispatch", hint: "Applies to every command." });
    expect(screen.getByText(/Applies to every command\./)).toBeInTheDocument();
  });

  it("can be disabled", () => {
    const { select } = renderField({ disabled: true });
    expect(select).toBeDisabled();
  });
});
