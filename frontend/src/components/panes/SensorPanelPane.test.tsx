// frontend/src/components/panes/SensorPanelPane.test.tsx — Thin wrapper renders SensorPanel

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

vi.mock("../SensorPanel", () => ({
  SensorPanel: () => <div data-testid="sensor-panel">sensor panel</div>,
}));

import { SensorPanelPane } from "./SensorPanelPane";

describe("SensorPanelPane", () => {
  it("renders the wrapped SensorPanel", () => {
    render(<SensorPanelPane config={{} as PaneConfig} />);
    expect(screen.getByTestId("sensor-panel")).toBeInTheDocument();
  });
});
