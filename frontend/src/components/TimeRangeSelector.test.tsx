// frontend/src/components/TimeRangeSelector.test.tsx — Pill-button time range toggle

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimeRangeSelector } from "./TimeRangeSelector";

describe("TimeRangeSelector", () => {
  it("renders all 5 range options", () => {
    render(<TimeRangeSelector value="1h" onChange={() => {}} />);
    expect(screen.getByText("1h")).toBeInTheDocument();
    expect(screen.getByText("6h")).toBeInTheDocument();
    expect(screen.getByText("24h")).toBeInTheDocument();
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
  });

  it("calls onChange with the selected range when a button is clicked", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="1h" onChange={onChange} />);
    fireEvent.click(screen.getByText("7d"));
    expect(onChange).toHaveBeenCalledWith("7d");
  });

  it("visually highlights the active range", () => {
    render(<TimeRangeSelector value="24h" onChange={() => {}} />);
    const active = screen.getByText("24h");
    // Active button gets the primary blue color
    expect(active.style.backgroundColor).toBe("rgb(59, 164, 255)");
    const inactive = screen.getByText("1h");
    expect(inactive.style.backgroundColor).toBe("transparent");
  });
});
