// frontend/src/components/panes/TriggerButtonPane.test.tsx — Configurable trigger button

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));

vi.mock("../../lib/auth-fetch", () => ({
  authFetch: mockAuthFetch,
}));

import { TriggerButtonPane } from "./TriggerButtonPane";

describe("TriggerButtonPane", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the default trigger name when none is configured", () => {
    render(<TriggerButtonPane config={{} as PaneConfig} />);
    expect(screen.getByText("my-trigger")).toBeInTheDocument();
    expect(screen.getByText("service/trigger/my-trigger")).toBeInTheDocument();
  });

  it("renders the configured label and trigger path", () => {
    const config: PaneConfig = { triggerName: "lights-on", label: "Lights On" };
    render(<TriggerButtonPane config={config} />);
    expect(screen.getByRole("button", { name: /Lights On/ })).toBeInTheDocument();
    expect(screen.getByText("service/trigger/lights-on")).toBeInTheDocument();
  });

  it("fires the trigger with the configured payload on click", async () => {
    const config: PaneConfig = { triggerName: "night-mode", payload: { level: 10 } };
    render(<TriggerButtonPane config={config} />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toContain("/api/automations/trigger/night-mode");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ level: 10 }));

    // The "last fired" timestamp appears after the request resolves
    expect(await screen.findByText(/Last fired/)).toBeInTheDocument();
  });

  it("sends an empty payload object when none is configured", async () => {
    render(<TriggerButtonPane config={{ triggerName: "ping" } as PaneConfig} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    const [, init] = mockAuthFetch.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({}));
  });
});
