// frontend/src/components/panes/ConnectorsPane.test.tsx — Thin wrapper renders ConnectorsPage

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

vi.mock("../ConnectorsPage", () => ({
  ConnectorsPage: () => <div data-testid="connectors-page">connectors page</div>,
}));

import { ConnectorsPane } from "./ConnectorsPane";

describe("ConnectorsPane", () => {
  it("renders the wrapped ConnectorsPage", () => {
    render(<ConnectorsPane config={{} as PaneConfig} />);
    expect(screen.getByTestId("connectors-page")).toBeInTheDocument();
  });
});
