// frontend/src/components/panes/AutomationRulesPane.test.tsx — Thin wrapper renders AutomationsPage

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

vi.mock("../AutomationsPage", () => ({
  AutomationsPage: () => <div data-testid="automations-page">automations page</div>,
}));

import { AutomationRulesPane } from "./AutomationRulesPane";

describe("AutomationRulesPane", () => {
  it("renders the wrapped AutomationsPage", () => {
    render(<AutomationRulesPane config={{} as PaneConfig} />);
    expect(screen.getByTestId("automations-page")).toBeInTheDocument();
  });
});
