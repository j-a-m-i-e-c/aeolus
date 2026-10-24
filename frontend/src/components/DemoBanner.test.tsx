// frontend/src/components/DemoBanner.test.tsx — public-demo banner visibility

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ publicDemo: false }));

vi.mock("../lib/env", () => ({
  get PUBLIC_DEMO() { return flags.publicDemo; },
}));

import { DemoBanner } from "./DemoBanner";

describe("DemoBanner", () => {
  beforeEach(() => {
    flags.publicDemo = false;
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
});
