// frontend/src/components/Sparkline.test.tsx — Render tests for the inline sparkline

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders nothing with fewer than two values", () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.querySelector("svg")).toBeNull();

    const { container: one } = render(<Sparkline values={[5]} />);
    expect(one.querySelector("svg")).toBeNull();
  });

  it("renders an svg polyline with one point per value", () => {
    const { container } = render(<Sparkline values={[1, 2, 3, 4]} />);
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const points = polyline!.getAttribute("points")!.trim().split(/\s+/);
    expect(points).toHaveLength(4);
  });

  it("respects width, height, and color props", () => {
    const { container } = render(
      <Sparkline values={[1, 2]} width={120} height={40} color="#ff0000" />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("120");
    expect(svg.getAttribute("height")).toBe("40");
    expect(container.querySelector("polyline")!.getAttribute("stroke")).toBe("#ff0000");
  });

  it("handles a flat series without dividing by zero", () => {
    const { container } = render(<Sparkline values={[7, 7, 7]} />);
    const points = container.querySelector("polyline")!.getAttribute("points")!;
    // No NaN coordinates when min === max (range guarded to 1)
    expect(points).not.toMatch(/NaN/);
  });
});
