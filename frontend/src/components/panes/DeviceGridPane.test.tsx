// frontend/src/components/panes/DeviceGridPane.test.tsx — Thin wrapper renders DeviceGrid

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

vi.mock("../DeviceGrid", () => ({
  DeviceGrid: () => <div data-testid="device-grid">device grid</div>,
}));

import { DeviceGridPane } from "./DeviceGridPane";

describe("DeviceGridPane", () => {
  it("renders the wrapped DeviceGrid", () => {
    render(<DeviceGridPane config={{} as PaneConfig} />);
    expect(screen.getByTestId("device-grid")).toBeInTheDocument();
  });
});
