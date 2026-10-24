// frontend/src/components/DemoBanner.test.tsx — public-demo banner visibility

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ publicDemo: false, captureMode: false }));

vi.mock("../lib/env", () => ({
  get PUBLIC_DEMO() { return flags.publicDemo; },
}));
vi.mock("../lib/capture-mode", () => ({
  get CAPTURE_MODE() { return flags.captureMode; },
}));

import { DemoBanner } from "./DemoBanner";

describe("DemoBanner", () => {
  beforeEach(() => {
    flags.publicDemo = false;
    flags.captureMode = false;
  });

  it("renders nothing outside the public demo", () => {
    const { container } = render(<DemoBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces the public demo and always offers the source link", () => {
    flags.publicDemo = true;
    render(<DemoBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Public demo");
    expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      "https://github.com/j-a-m-i-e-c/aeolus",
    );
  });

  it("is hidden in media capture mode even on the public demo", () => {
    flags.publicDemo = true;
    flags.captureMode = true;
    const { container } = render(<DemoBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
