// frontend/src/components/panes/MqttInspectorPane.test.tsx — Thin wrapper renders MqttInspector

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

vi.mock("../MqttInspector", () => ({
  MqttInspector: () => <div data-testid="mqtt-inspector">mqtt inspector</div>,
}));

import { MqttInspectorPane } from "./MqttInspectorPane";

describe("MqttInspectorPane", () => {
  it("renders the wrapped MqttInspector", () => {
    render(<MqttInspectorPane config={{} as PaneConfig} />);
    expect(screen.getByTestId("mqtt-inspector")).toBeInTheDocument();
  });
});
