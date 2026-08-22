// frontend/src/components/ConnectorsPage.test.tsx — connector management dashboard
//
// Covers the main page (loading, available/active lists, enable/disable/retry,
// refresh), the dynamic ConfigForm field types, and the SetupWizard (multi-step
// advance, completion, cancel, and the button-press auto-poll path). The
// api-client is mocked; framer-motion is stubbed with stable (cached) component
// types so the animated panels don't remount and detach nodes mid-assertion.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const demoState = vi.hoisted(() => ({ readOnly: false }));
vi.mock("../hooks/useReadOnlyDemo", () => ({
  useReadOnlyDemo: () => demoState.readOnly,
}));

const api = vi.hoisted(() => ({
  fetchAvailableConnectors: vi.fn(),
  fetchEnabledConnectors: vi.fn(),
  enableConnector: vi.fn(),
  disableConnector: vi.fn(),
  retryConnector: vi.fn(),
  executeConnectorSetupStep: vi.fn(),
  fetchSetupSteps: vi.fn(),
  patchConnectorConfig: vi.fn(),
}));
vi.mock("../lib/api-client", () => api);

vi.mock("framer-motion", () => {
  const cache = new Map<string, React.FC<Record<string, unknown> & { children?: React.ReactNode }>>();
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (!cache.has(key)) {
            cache.set(key, ({ children, ...rest }) => {
              const { initial: _i, animate: _a, exit: _e, transition: _tr, ...dom } = rest;
              return <div {...(dom as Record<string, unknown>)}>{children}</div>;
            });
          }
          return cache.get(key);
        },
      },
    ),
  };
});

import { ConnectorsPage } from "./ConnectorsPage";

const AVAILABLE = [
  {
    metadata: { id: "mqtt", displayName: "MQTT", icon: "radio", description: "MQTT broker", supportedDeviceTypes: ["sensor"], requiresSetup: false },
    configSchema: [
      { id: "host", label: "Host", type: "text", required: true, placeholder: "1.2.3.4" },
      { id: "port", label: "Port", type: "number", required: false, default: 1883 },
      { id: "pass", label: "Password", type: "password", required: false },
      { id: "tls", label: "TLS", type: "boolean", required: false, helpText: "use TLS" },
      { id: "mode", label: "Mode", type: "select", required: false, options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] },
    ],
  },
  {
    metadata: { id: "hue", displayName: "Hue", icon: "lightbulb", description: "Philips Hue", supportedDeviceTypes: ["light"], requiresSetup: true },
    configSchema: [],
  },
];

const ENABLED = [
  { id: "c-kasa", connectorType: "kasa", displayName: "Kasa", icon: "plug", config: { host: "1.2.3.4" }, health: { status: "connected", lastSeen: 1_000_000 }, deviceCount: 2, enabled: true },
  { id: "c-dead", connectorType: "zwave", displayName: "ZWave", icon: "radio", config: { port: "/dev/x" }, health: { status: "disconnected", lastSeen: 0, errorMessage: "boom" }, deviceCount: 0, enabled: true },
];

const STEP_DESC = "**Prerequisites:**\n\n• Have your account ready\n• Be on the same network\n\nEnter your credentials below.";

beforeEach(() => {
  vi.clearAllMocks();
  demoState.readOnly = false;
  api.fetchAvailableConnectors.mockResolvedValue(AVAILABLE);
  api.fetchEnabledConnectors.mockResolvedValue(ENABLED);
  api.enableConnector.mockResolvedValue({ success: true, id: "new-1" });
  api.disableConnector.mockResolvedValue({ success: true });
  api.retryConnector.mockResolvedValue({ success: true });
  api.patchConnectorConfig.mockResolvedValue({ success: true });
  api.fetchSetupSteps.mockResolvedValue([]);
  api.executeConnectorSetupStep.mockResolvedValue({ success: true, complete: true, message: "ok", data: {} });
});

describe("ConnectorsPage — main", () => {
  it("shows a loading state, then the connector lists", async () => {
    render(<ConnectorsPage />);
    expect(screen.getByText("Loading connectors...")).toBeInTheDocument();
    expect(await screen.findByText("Connectors")).toBeInTheDocument();
    expect(screen.getByText("MQTT")).toBeInTheDocument();
    expect(screen.getByText("Hue")).toBeInTheDocument();
    // Active connectors section + a disconnected one showing its error.
    expect(screen.getByText("Kasa")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("labels the hosted public demo as read-only", async () => {
    demoState.readOnly = true;
    render(<ConnectorsPage />);
    await screen.findByText("Connectors");
    expect(screen.getByText(/Public demo · read only/i)).toBeInTheDocument();
    expect(screen.getByText(/real hardware, networks or credentials/i)).toBeInTheDocument();
  });

  it("refreshes on demand", async () => {
    render(<ConnectorsPage />);
    await screen.findByText("Connectors");
    expect(api.fetchAvailableConnectors).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(api.fetchAvailableConnectors).toHaveBeenCalledTimes(2));
  });

  it("disables an active connector", async () => {
    render(<ConnectorsPage />);
    await screen.findByText("Connectors");
    fireEvent.click(screen.getAllByRole("button", { name: "Disable" })[0]);
    await waitFor(() => expect(api.disableConnector).toHaveBeenCalledWith("c-kasa"));
  });

  it("retries a disconnected connector", async () => {
    render(<ConnectorsPage />);
    await screen.findByText("Connectors");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(api.retryConnector).toHaveBeenCalledWith("c-dead"));
  });

  it("shows the empty state when no connector types are discovered", async () => {
    api.fetchAvailableConnectors.mockResolvedValue([]);
    api.fetchEnabledConnectors.mockResolvedValue([]);
    render(<ConnectorsPage />);
    expect(await screen.findByText("No connector types discovered")).toBeInTheDocument();
  });
});

describe("ConnectorsPage — enable flow + ConfigForm", () => {
  it("opens the config form, edits every field type, and enables the connector", async () => {
    render(<ConnectorsPage />);
    await screen.findByText("Connectors");

    // mqtt is the first available card → its Enable button is index 0.
    fireEvent.click(screen.getAllByRole("button", { name: "Enable" })[0]);

    // ConfigForm renders all field types.
    fireEvent.change(screen.getByPlaceholderText("1.2.3.4"), { target: { value: "broker.local" } });
    fireEvent.click(screen.getByRole("button", { name: "Disabled" })); // boolean toggle → Enabled
    expect(screen.getByRole("button", { name: "Enabled" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } }); // select

    fireEvent.click(screen.getByRole("button", { name: "Enable Connector" }));
    await waitFor(() => expect(api.enableConnector).toHaveBeenCalled());
    const [type, cfg] = api.enableConnector.mock.calls[0];
    expect(type).toBe("mqtt");
    expect(cfg).toMatchObject({ host: "broker.local", port: 1883, tls: true, mode: "b" });
  });

  it("launches the setup wizard for a connector that requires setup", async () => {
    api.fetchSetupSteps.mockResolvedValue([{ id: "credentials", title: "Credentials", description: STEP_DESC, fields: [{ id: "user", label: "User", type: "text", required: true }] }]);
    render(<ConnectorsPage />);
    await screen.findByText("Connectors");

    // hue requires setup → clicking Enable enables immediately then opens the wizard.
    fireEvent.click(screen.getAllByRole("button", { name: "Enable" })[1]);

    await waitFor(() => expect(api.enableConnector).toHaveBeenCalledWith("hue", {}));
    expect(await screen.findByText("Setup Required")).toBeInTheDocument();
    // Rich description rendering: bold heading + bullet list + paragraph.
    expect(screen.getByText("Prerequisites:")).toBeInTheDocument();
    expect(screen.getByText("Have your account ready")).toBeInTheDocument();
    expect(screen.getByText("Enter your credentials below.")).toBeInTheDocument();
  });
});

describe("ConnectorsPage — SetupWizard", () => {
  async function openWizard(steps: unknown[]) {
    api.fetchSetupSteps.mockResolvedValue(steps);
    render(<ConnectorsPage />);
    await screen.findByText("Connectors");
    fireEvent.click(screen.getAllByRole("button", { name: "Enable" })[1]); // hue
    await screen.findByText("Setup Required");
  }

  it("advances a multi-step wizard and completes on the final step", async () => {
    api.executeConnectorSetupStep
      .mockResolvedValueOnce({ success: true, complete: false, message: "step 1 ok", data: { token: "t" } })
      .mockResolvedValueOnce({ success: true, complete: true, message: "done", data: { token: "t" } });

    await openWizard([
      { id: "credentials", title: "Credentials", description: "Enter creds", fields: [{ id: "user", label: "User", type: "text", required: true }] },
      { id: "confirm", title: "Confirm", description: "Confirm it" },
    ]);

    // Step 1 → Continue advances to step 2.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Confirm it")).toBeInTheDocument());

    // Step 2 → Continue completes: patch config + auto-connect.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(api.patchConnectorConfig).toHaveBeenCalledWith("new-1", expect.objectContaining({ token: "t" })));
    expect(api.retryConnector).toHaveBeenCalledWith("new-1");
  });

  it("surfaces an error message when a step fails", async () => {
    api.executeConnectorSetupStep.mockRejectedValueOnce(new Error("bad creds"));
    await openWizard([{ id: "credentials", title: "Credentials", description: "Enter creds", fields: [] }]);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("bad creds")).toBeInTheDocument();
  });

  it("disables the connector when setup is cancelled", async () => {
    await openWizard([{ id: "credentials", title: "Credentials", description: "Enter creds", fields: [] }]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.disableConnector).toHaveBeenCalledWith("new-1"));
  });

  it("auto-polls a button-press step and completes when the button is detected", async () => {
    api.executeConnectorSetupStep.mockResolvedValue({ complete: true, data: { username: "u" } });
    await openWizard([{ id: "press-button", title: "Press", description: "Press the bridge button" }]);

    // The effect fires an immediate poll; a completing result finishes the wizard.
    await waitFor(() => expect(api.patchConnectorConfig).toHaveBeenCalledWith("new-1", expect.objectContaining({ username: "u" })));
    expect(api.retryConnector).toHaveBeenCalledWith("new-1");
  });
});
