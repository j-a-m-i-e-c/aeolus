// frontend/src/components/panes/hue/ColorTempSlider.test.tsx — Debounced color-temp slider

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const { mockSendAction } = vi.hoisted(() => ({ mockSendAction: vi.fn() }));

vi.mock("../../../lib/api-client", () => ({
  sendAction: mockSendAction,
}));

import { ColorTempSlider } from "./ColorTempSlider";

describe("ColorTempSlider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSendAction.mockReset();
    mockSendAction.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders the current color temperature", () => {
    render(<ColorTempSlider deviceId="d1" currentCt={300} ctMin={153} ctMax={500} />);
    expect(screen.getByText("300 mirek")).toBeInTheDocument();
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.value).toBe("300");
  });

  it("shows the local value immediately and debounces the action call", async () => {
    render(<ColorTempSlider deviceId="d1" currentCt={300} ctMin={153} ctMax={500} />);
    const slider = screen.getByRole("slider");

    fireEvent.change(slider, { target: { value: "420" } });
    expect(screen.getByText("420 mirek")).toBeInTheDocument();
    // Debounced — nothing sent yet
    expect(mockSendAction).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mockSendAction).toHaveBeenCalledWith("d1", "color-temp", { ct: 420 });
  });

  it("disables interaction when the disabled prop is set", () => {
    const { container } = render(
      <ColorTempSlider deviceId="d1" currentCt={300} ctMin={153} ctMax={500} disabled />,
    );
    expect(screen.getByRole("slider")).toBeDisabled();
    expect(container.querySelector(".pointer-events-none")).not.toBeNull();
  });
});
