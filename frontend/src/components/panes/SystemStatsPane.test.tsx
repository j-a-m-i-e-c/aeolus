// frontend/src/components/panes/SystemStatsPane.test.tsx — Thin wrapper renders SystemPage

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

vi.mock("../SystemPage", () => ({
  SystemPage: () => <div data-testid="system-page">system page</div>,
}));

import { SystemStatsPane } from "./SystemStatsPane";

describe("SystemStatsPane", () => {
  it("renders the wrapped SystemPage", () => {
    render(<SystemStatsPane config={{} as PaneConfig} />);
    expect(screen.getByTestId("system-page")).toBeInTheDocument();
  });
});
