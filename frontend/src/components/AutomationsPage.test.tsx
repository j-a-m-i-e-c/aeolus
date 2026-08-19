// frontend/src/components/AutomationsPage.test.tsx — Automation authoring and rule list
//
// Authoring is code-only, so these cover the single authoring panel (create + edit,
// including the acknowledgement level that sits with the trigger setup) and the list
// actions (toggle/delete/edit). Legacy form rules still appear in the list and are
// asserted as read-only there. The embedded Monaco editor and framer-motion are
// mocked so the logic runs in jsdom.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock("../lib/auth-fetch", () => ({ authFetch: mockAuthFetch }));
vi.mock("../lib/env", () => ({ API_URL: "http://test.local:3001" }));

// Monaco editor stub — exposes onSave via a button so the save path is reachable.
vi.mock("./ScriptEditor", () => ({
  ScriptEditor: ({ onSave }: { onSave: (s: string) => void }) => (
    <div data-testid="script-editor">
      <button onClick={() => onSave("when(x) => log('hi')")}>editor-save</button>
    </div>
  ),
}));

// framer-motion: render children synchronously, strip animation-only props.
// The component type per key MUST be stable (cached) — returning a fresh
// function each access would remount the subtree on every render.
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
              const {
                initial: _i, animate: _a, exit: _e, transition: _t2,
                whileHover: _wh, whileTap: _wt, ...dom
              } = rest;
              return <div {...(dom as Record<string, unknown>)}>{children}</div>;
            });
          }
          return cache.get(key);
        },
      },
    ),
  };
});

import { AutomationsPage } from "./AutomationsPage";
import { useAuthStore } from "../store/auth-store";
import { usePermissionsStore } from "../store/permissions-store";
import { useDashboardStore } from "../store/dashboard-store";

const RULES = [
  // Legacy form rule with a non-device action: no acknowledgement level applies.
  { id: "r1", name: "Form Rule", topic: "a/b", hasCondition: false, source: "ui", ruleType: "form", enabled: true, actionType: "log" },
  { id: "r2", name: "Script Rule", topic: "c/d", hasCondition: true, source: "ui", ruleType: "script", enabled: false, scriptSource: "when(x)", completionTier: "dispatch" },
  // Legacy device-directed form rule: level applies and is shown, but not editable
  // here — form rules have no authoring surface any more.
  { id: "r3", name: "Toggle Rule", topic: "e/f", hasCondition: false, source: "ui", ruleType: "form", enabled: false, actionType: "toggle", actionTarget: "light/x", completionTier: "acknowledged" },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** Most recent authFetch call issued with the given HTTP method. */
function lastCallWithMethod(method: string) {
  return [...mockAuthFetch.mock.calls].reverse().find(([, init]) => (init?.method ?? "GET") === method);
}

/** Open the authoring panel. Waits on the heading by role — the submit button
 *  legitimately carries the same words, so a text-only query is ambiguous. */
async function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
  await screen.findByRole("heading", { name: "Create Automation" });
}

describe("AutomationsPage", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    mockAuthFetch.mockResolvedValue(jsonResponse(RULES));
    // Author as an admin by default so authoring controls are available (admins
    // create unrestricted automations and need no owning-tab selection). Scoped
    // non-admin authoring is covered by its own test below.
    useAuthStore.setState({
      user: { id: "admin", username: "admin", role: "admin", groupId: null },
    });
    usePermissionsStore.setState({ accessibleTabs: [], loaded: true });
    useDashboardStore.setState({ tabs: [] });
  });

  it("fetches and renders existing rules on mount", async () => {
    render(<AutomationsPage />);
    expect(await screen.findByText("Form Rule")).toBeInTheDocument();
    expect(screen.getByText("Script Rule")).toBeInTheDocument();
    expect(mockAuthFetch).toHaveBeenCalledWith("http://test.local:3001/api/automations");
  });

  it("shows the empty state when there are no rules", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    render(<AutomationsPage />);
    expect(await screen.findByText("No automation rules")).toBeInTheDocument();
  });

  it("opens a single code-only authoring panel with no mode toggle", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    render(<AutomationsPage />);
    await screen.findByText("No automation rules");
    await openPanel();

    // Lazy-loaded behind Suspense, so this resolves rather than being immediate.
    expect(await screen.findByTestId("script-editor")).toBeInTheDocument();
    // The retired form-based "Quick Rule" mode must not come back.
    expect(screen.queryByRole("button", { name: /Quick Rule/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("e.g. Night motion alert")).not.toBeInTheDocument();
  });

  it("keeps save disabled until name and trigger are set, then POSTs", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    render(<AutomationsPage />);
    await screen.findByText("No automation rules");
    await openPanel();

    const create = screen.getByRole("button", { name: "Create Automation" });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My Automation" } });
    fireEvent.change(screen.getByLabelText("Trigger Topic"), { target: { value: "sensor/temp" } });
    expect(create).toBeEnabled();

    fireEvent.click(create);
    await waitFor(() => expect(lastCallWithMethod("POST")).toBeTruthy());
    const [url, init] = lastCallWithMethod("POST")!;
    expect(url).toBe("http://test.local:3001/api/automations");
    expect(JSON.parse(init!.body as string)).toMatchObject({
      name: "My Automation",
      triggerTopic: "sensor/temp",
      ruleType: "script",
    });
  });

  it("toggles a rule via PATCH", async () => {
    render(<AutomationsPage />);
    await screen.findByText("Form Rule");
    // Form Rule is enabled → its toggle button is titled "Disable".
    fireEvent.click(screen.getByTitle("Disable"));
    await waitFor(() => expect(lastCallWithMethod("PATCH")).toBeTruthy());
    expect(lastCallWithMethod("PATCH")![0]).toBe("http://test.local:3001/api/automations/r1/toggle");
  });

  it("deletes a rule via DELETE after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AutomationsPage />);
    await screen.findByText("Form Rule");
    fireEvent.click(screen.getAllByTitle("Delete")[0]);
    await waitFor(() => expect(lastCallWithMethod("DELETE")).toBeTruthy());
    expect(lastCallWithMethod("DELETE")![0]).toBe("http://test.local:3001/api/automations/r1");
    vi.mocked(window.confirm).mockRestore();
  });

  it("opens a script rule for editing and updates it via PUT", async () => {
    render(<AutomationsPage />);
    await screen.findByText("Script Rule");
    fireEvent.click(screen.getByText("Script Rule"));

    expect(await screen.findByRole("heading", { name: "Edit Automation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update Automation" }));

    await waitFor(() => expect(lastCallWithMethod("PUT")).toBeTruthy());
    expect(lastCallWithMethod("PUT")![0]).toBe("http://test.local:3001/api/automations/r2");
  });

  it("does not offer an editor for a legacy form rule", async () => {
    render(<AutomationsPage />);
    await screen.findByText("Toggle Rule");
    // Only the script rule carries a pencil; form rules are runtime-only now.
    expect(screen.getAllByTitle("Edit automation")).toHaveLength(1);
  });

  it("renders transpile errors returned by the server on save", async () => {
    render(<AutomationsPage />);
    await screen.findByText("Script Rule");
    fireEvent.click(screen.getByText("Script Rule"));
    await screen.findByText("Edit Automation");

    // Next save (PUT) fails with transpile details.
    mockAuthFetch.mockResolvedValueOnce(
      jsonResponse({ details: [{ line: 3, column: 5, message: "Unexpected token" }] }, 400),
    );
    fireEvent.click(screen.getByRole("button", { name: "Update Automation" }));

    expect(await screen.findByText(/Line 3:5 — Unexpected token/)).toBeInTheDocument();
  });

  describe("acknowledgement level", () => {
    it("is authored alongside the trigger and sent on create", async () => {
      mockAuthFetch.mockResolvedValue(jsonResponse([]));
      render(<AutomationsPage />);
      await screen.findByText("No automation rules");
      await openPanel();

      // Present as soon as the panel opens — not gated behind an action choice.
      const tier = screen.getByLabelText("Acknowledgement level");
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ack" } });
      fireEvent.change(screen.getByLabelText("Trigger Topic"), { target: { value: "sensor/x" } });
      fireEvent.change(tier, { target: { value: "acknowledged" } });

      fireEvent.click(screen.getByRole("button", { name: "Create Automation" }));
      await waitFor(() => expect(lastCallWithMethod("POST")).toBeTruthy());
      expect(JSON.parse(lastCallWithMethod("POST")![1]!.body as string).completionTier).toBe("acknowledged");
    });

    it("prefills from the stored value when editing and saves the change", async () => {
      render(<AutomationsPage />);
      await screen.findByText("Script Rule");
      fireEvent.click(screen.getByText("Script Rule"));
      await screen.findByText("Edit Automation");

      const tier = screen.getByLabelText("Acknowledgement level");
      expect(tier).toHaveValue("dispatch");

      fireEvent.change(tier, { target: { value: "observed" } });
      fireEvent.click(screen.getByRole("button", { name: "Update Automation" }));

      await waitFor(() => expect(lastCallWithMethod("PUT")).toBeTruthy());
      expect(JSON.parse(lastCallWithMethod("PUT")![1]!.body as string).completionTier).toBe("observed");
    });

    it("clears back to automatic with an explicit null", async () => {
      render(<AutomationsPage />);
      await screen.findByText("Script Rule");
      fireEvent.click(screen.getByText("Script Rule"));
      await screen.findByText("Edit Automation");

      fireEvent.change(screen.getByLabelText("Acknowledgement level"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Update Automation" }));

      await waitFor(() => expect(lastCallWithMethod("PUT")).toBeTruthy());
      // Explicit null, not an omitted field: omitting it would preserve the old level.
      expect(JSON.parse(lastCallWithMethod("PUT")![1]!.body as string).completionTier).toBeNull();
    });

    it("summarises the level in the list without offering a second way to change it", async () => {
      render(<AutomationsPage />);
      await screen.findByText("Toggle Rule");

      expect(screen.getByText("ack: acknowledged")).toBeInTheDocument();
      expect(screen.getByText("ack: dispatch only")).toBeInTheDocument();
      // Read-only: no control in the row.
      expect(screen.queryByLabelText(/Acknowledgement level for/)).not.toBeInTheDocument();
      // A log action dispatches no device command, so it carries no badge at all.
      expect(screen.queryByText("ack: automatic")).not.toBeInTheDocument();
    });
  });

  it("a non-admin author binds the automation to a writable owning tab", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    useAuthStore.setState({
      user: { id: "u1", username: "alice", role: "user", groupId: "g1" },
    });
    usePermissionsStore.setState({
      accessibleTabs: [{ tabId: "tab-x", permission: "write" }],
      loaded: true,
    });
    useDashboardStore.setState({
      tabs: [{ id: "tab-x", name: "Tab X", icon: "layout", order: 0, pinned: false, createdAt: 1 }],
    });

    render(<AutomationsPage />);
    await screen.findByText("No automation rules");
    await openPanel();

    // Owning-tab selector is present and lists the writable tab.
    expect(screen.getByLabelText("Owning tab")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Scoped" } });
    fireEvent.change(screen.getByLabelText("Trigger Topic"), { target: { value: "motion/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Automation" }));

    await waitFor(() => expect(lastCallWithMethod("POST")).toBeTruthy());
    expect(JSON.parse(lastCallWithMethod("POST")![1]!.body as string).tabId).toBe("tab-x");
  });

  it("hides authoring for a non-admin with no writable tab", async () => {
    useAuthStore.setState({
      user: { id: "u2", username: "bob", role: "user", groupId: "g2" },
    });
    usePermissionsStore.setState({ accessibleTabs: [], loaded: true });
    useDashboardStore.setState({ tabs: [] });

    render(<AutomationsPage />);
    await screen.findByText("Form Rule");
    expect(screen.queryByRole("button", { name: "New Rule" })).not.toBeInTheDocument();
    expect(screen.getByText("Authoring requires write access to a tab.")).toBeInTheDocument();
  });
});
