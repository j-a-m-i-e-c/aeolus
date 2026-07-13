// frontend/src/components/panes/EventLogPane.test.tsx — Thin wrapper renders EventLog

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

vi.mock("../EventLog", () => ({
  EventLog: () => <div data-testid="event-log">event log</div>,
}));

import { EventLogPane } from "./EventLogPane";

describe("EventLogPane", () => {
  it("renders the wrapped EventLog", () => {
    render(<EventLogPane config={{} as PaneConfig} />);
    expect(screen.getByTestId("event-log")).toBeInTheDocument();
  });
});
