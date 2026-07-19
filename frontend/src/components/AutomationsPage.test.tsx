// frontend/src/components/AutomationsPage.test.tsx — Dual-mode automation rule editor
//
// Exercises the form/script mode toggle, the dynamic action-type fields + the
// buildActionFields branches, and the list actions (toggle/delete/edit). The
// embedded Monaco editor and framer-motion are mocked so the logic runs in jsdom.

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

const RULES = [
  { id: "r1", name: "Form Rule", topic: "a/b", hasCondition: false, source: "ui", ruleType: "form", enabled: true, actionType: "log" },
  { id: "r2", name: "Script Rule", topic: "c/d", hasCondition: true, source: "ui", ruleType: "script", enabled: false, scriptSource: "when(x)" },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** Most recent authFetch call issued with the given HTTP method. */
function lastCallWithMethod(method: string) {
  return [...mockAuthFetch.mock.calls].reverse().find(([, init]) => (init?.method ?? "GET") === method);
}

async function openForm() {
  fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
  await screen.findByText("Create Automation Rule");
}

describe("AutomationsPage", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    mockAuthFetch.mockResolvedValue(jsonResponse(RULES));
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

  it("opens the create form and defaults to Quick Rule mode", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    render(<AutomationsPage />);
    await screen.findByText("No automation rules");
    await openForm();
    expect(screen.getByPlaceholderText("e.g. Night motion alert")).toBeInTheDocument();
  });

  it("keeps Create Rule disabled until name and trigger are set, then POSTs", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    render(<AutomationsPage />);
    await screen.findByText("No automation rules");
    await openForm();

    const create = screen.getByRole("button", { name: "Create Rule" });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("e.g. Night motion alert"), { target: { value: "My Rule" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. motion/hallway or sensor/#"), { target: { value: "motion/hall" } });
    expect(create).toBeEnabled();

    fireEvent.click(create);
    await waitFor(() => expect(lastCallWithMethod("POST")).toBeTruthy());
    const [url, init] = lastCallWithMethod("POST")!;
    expect(url).toBe("http://test.local:3001/api/automations");
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ name: "My Rule", triggerTopic: "motion/hall", actionType: "log" });
  });

  it("builds publish action params from the publish fields", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    render(<AutomationsPage />);
    await screen.findByText("No automation rules");
    await openForm();

    fireEvent.change(screen.getByPlaceholderText("e.g. Night motion alert"), { target: { value: "Pub" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. motion/hallway or sensor/#"), { target: { value: "trigger/x" } });

    // action-type select is the 2nd combobox in form mode (after condition).
    const actionSelect = screen.getAllByRole("combobox")[1];
    fireEvent.change(actionSelect, { target: { value: "publish" } });

    fireEvent.change(screen.getByPlaceholderText("e.g. light/bedroom/set"), { target: { value: "light/set" } });
    fireEvent.change(screen.getByPlaceholderText('e.g. {"state":"ON"}'), { target: { value: '{"state":"ON"}' } });

    fireEvent.click(screen.getByRole("button", { name: "Create Rule" }));
    await waitFor(() => expect(lastCallWithMethod("POST")).toBeTruthy());
    const body = JSON.parse(lastCallWithMethod("POST")![1]!.body as string);
    expect(body.actionType).toBe("publish");
    expect(body.actionTarget).toBe("light/set");
    expect(body.actionParams).toEqual({ payload: '{"state":"ON"}' });
  });

  it("reveals webhook fields and a condition value input on selection", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    render(<AutomationsPage />);
    await screen.findByText("No automation rules");
    await openForm();

    const [conditionSelect, actionSelect] = screen.getAllByRole("combobox");
    fireEvent.change(conditionSelect, { target: { value: "value_above" } });
    expect(screen.getByPlaceholderText("e.g. 25 or true")).toBeInTheDocument();

    fireEvent.change(actionSelect, { target: { value: "webhook" } });
    expect(screen.getByPlaceholderText("https://example.com/webhook")).toBeInTheDocument();
  });

  it("switches to Script mode and creates a script rule", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    render(<AutomationsPage />);
    await screen.findByText("No automation rules");
    await openForm();

    fireEvent.click(screen.getByRole("button", { name: /Script/ }));
    expect(await screen.findByTestId("script-editor")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("e.g. Smart heating logic"), { target: { value: "My Script" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. sensor/+/temperature"), { target: { value: "sensor/temp" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Script" }));

    await waitFor(() => expect(lastCallWithMethod("POST")).toBeTruthy());
    const body = JSON.parse(lastCallWithMethod("POST")![1]!.body as string);
    expect(body).toMatchObject({ name: "My Script", triggerTopic: "sensor/temp", ruleType: "script" });
  });

  it("toggles a rule via PATCH", async () => {
    render(<AutomationsPage />);
    await screen.findByText("Form Rule");
    // Form Rule is enabled → its toggle button is titled "Disable".
    fireEvent.click(screen.getByTitle("Disable"));
    await waitFor(() => expect(lastCallWithMethod("PATCH")).toBeTruthy());
    expect(lastCallWithMethod("PATCH")![0]).toBe("http://test.local:3001/api/automations/r1/toggle");
  });

  it("deletes a rule via DELETE", async () => {
    render(<AutomationsPage />);
    await screen.findByText("Form Rule");
    fireEvent.click(screen.getAllByTitle("Delete")[0]);
    await waitFor(() => expect(lastCallWithMethod("DELETE")).toBeTruthy());
    expect(lastCallWithMethod("DELETE")![0]).toBe("http://test.local:3001/api/automations/r1");
  });

  it("opens a script rule for editing and updates it via PUT", async () => {
    render(<AutomationsPage />);
    await screen.findByText("Script Rule");
    fireEvent.click(screen.getByText("Script Rule"));

    expect(await screen.findByText("Edit Automation Rule")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update Script" }));

    await waitFor(() => expect(lastCallWithMethod("PUT")).toBeTruthy());
    expect(lastCallWithMethod("PUT")![0]).toBe("http://test.local:3001/api/automations/r2");
  });

  it("renders transpile errors returned by the server on save", async () => {
    render(<AutomationsPage />);
    await screen.findByText("Script Rule");
    fireEvent.click(screen.getByText("Script Rule"));
    await screen.findByText("Edit Automation Rule");

    // Next save (PUT) fails with transpile details.
    mockAuthFetch.mockResolvedValueOnce(
      jsonResponse({ details: [{ line: 3, column: 5, message: "Unexpected token" }] }, 400),
    );
    fireEvent.click(screen.getByRole("button", { name: "Update Script" }));

    expect(await screen.findByText(/Line 3:5 — Unexpected token/)).toBeInTheDocument();
  });
});
