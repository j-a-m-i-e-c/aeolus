// frontend/src/components/system/HistoryRetentionCard.test.tsx — editing history retention.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  authFetch: vi.fn(),
  demoState: { readOnly: false },
}));

vi.mock("../../lib/auth-fetch", () => ({ authFetch: h.authFetch }));
vi.mock("../../hooks/useReadOnlyDemo", () => ({ useReadOnlyDemo: () => h.demoState.readOnly }));

import { HistoryRetentionCard } from "./HistoryRetentionCard";

type Retention = { executionHistoryDays: number | null; commandHistoryDays: number | null };

function json(data: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => data });
}

/** Serve GET from `current`; PUT merges the body into it unless `putResponse` overrides. */
function serve(initial: Retention, putResponse?: () => Promise<unknown>) {
  let current = { ...initial };
  h.authFetch.mockImplementation((_url: string, options?: RequestInit) => {
    if (options?.method === "PUT") {
      if (putResponse) return putResponse();
      current = { ...current, ...JSON.parse(String(options.body)) };
      return json(current);
    }
    return json(current);
  });
}

const putBodies = () =>
  h.authFetch.mock.calls.filter(([, o]) => (o as RequestInit | undefined)?.method === "PUT").map(([, o]) => JSON.parse(String((o as RequestInit).body)));

const executionInput = () => screen.findByLabelText("Execution history");
const commandInput = () => screen.findByLabelText("Command history");
const foreverBoxes = () => screen.getAllByRole("checkbox", { name: "Keep forever" });
const saveButton = () => screen.getByRole("button", { name: /^Save$/ });

describe("HistoryRetentionCard", () => {
  beforeEach(() => {
    h.authFetch.mockReset();
    h.demoState.readOnly = false;
  });

  it("shows the current periods, with Save disabled until something changes", async () => {
    serve({ executionHistoryDays: 7, commandHistoryDays: 30 });
    render(<HistoryRetentionCard />);
    expect(await executionInput()).toHaveValue(7);
    expect(await commandInput()).toHaveValue(30);
    expect(saveButton()).toBeDisabled();
  });

  it("shows keep forever as a ticked box and a disabled day field", async () => {
    serve({ executionHistoryDays: 7, commandHistoryDays: null });
    render(<HistoryRetentionCard />);
    expect(await commandInput()).toBeDisabled();
    expect(foreverBoxes()[1]).toBeChecked();
    expect(screen.getByText("Kept forever, this history grows without limit.")).toBeInTheDocument();
  });

  it("saves a longer period straight away, sending only what changed", async () => {
    serve({ executionHistoryDays: 7, commandHistoryDays: 7 });
    render(<HistoryRetentionCard />);
    fireEvent.change(await commandInput(), { target: { value: "365" } });
    fireEvent.click(saveButton());

    expect(await screen.findByText("Saved and applied")).toBeInTheDocument();
    expect(putBodies()).toEqual([{ commandHistoryDays: 365 }]);
    expect(saveButton()).toBeDisabled();
  });

  it("saves keep forever without asking, since nothing is deleted", async () => {
    serve({ executionHistoryDays: 7, commandHistoryDays: 7 });
    render(<HistoryRetentionCard />);
    await executionInput();
    fireEvent.click(foreverBoxes()[0]);
    fireEvent.click(saveButton());

    expect(await screen.findByText("Saved and applied")).toBeInTheDocument();
    expect(putBodies()).toEqual([{ executionHistoryDays: null }]);
  });

  it("asks before a shorter period deletes history, and saves only once confirmed", async () => {
    serve({ executionHistoryDays: 30, commandHistoryDays: null });
    render(<HistoryRetentionCard />);
    fireEvent.change(await executionInput(), { target: { value: "1" } });
    fireEvent.click(foreverBoxes()[1]); // forever -> a period also shortens it
    fireEvent.click(saveButton());

    expect(
      screen.getByText(/Saving deletes execution history older than 1 day and command history older than 7 days/),
    ).toBeInTheDocument();
    expect(putBodies()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Delete older history and save" }));
    expect(await screen.findByText("Saved and applied")).toBeInTheDocument();
    expect(putBodies()).toEqual([{ executionHistoryDays: 1, commandHistoryDays: 7 }]);
  });

  it("drops the confirmation on cancel without saving", async () => {
    serve({ executionHistoryDays: 30, commandHistoryDays: 30 });
    render(<HistoryRetentionCard />);
    fireEvent.change(await executionInput(), { target: { value: "7" } });
    fireEvent.click(saveButton());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/Saving deletes/)).not.toBeInTheDocument();
    expect(putBodies()).toEqual([]);
  });

  it.each(["0", "3651", "2.5", ""])("rejects %j as a period", async (value) => {
    serve({ executionHistoryDays: 7, commandHistoryDays: 7 });
    render(<HistoryRetentionCard />);
    fireEvent.change(await executionInput(), { target: { value } });

    expect(screen.getByText("Enter a whole number of days from 1 to 3650.")).toBeInTheDocument();
    expect(await executionInput()).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toBeDisabled();
  });

  it("restores a period when keep forever is unticked", async () => {
    serve({ executionHistoryDays: null, commandHistoryDays: 7 });
    render(<HistoryRetentionCard />);
    await executionInput();
    fireEvent.click(foreverBoxes()[0]);
    expect(await executionInput()).toHaveValue(7);
    expect(await executionInput()).toBeEnabled();
  });

  it("shows the server's error and keeps the edit", async () => {
    serve({ executionHistoryDays: 7, commandHistoryDays: 7 }, () => json({ error: "Validation failed" }, false, 400));
    render(<HistoryRetentionCard />);
    fireEvent.change(await commandInput(), { target: { value: "90" } });
    fireEvent.click(saveButton());

    expect(await screen.findByText("Validation failed")).toBeInTheDocument();
    expect(await commandInput()).toHaveValue(90);
  });

  it("falls back to the status code when the error has no body", async () => {
    serve({ executionHistoryDays: 7, commandHistoryDays: 7 }, () =>
      Promise.resolve({ ok: false, status: 503, json: async () => { throw new Error("not json"); } }),
    );
    render(<HistoryRetentionCard />);
    fireEvent.change(await commandInput(), { target: { value: "90" } });
    fireEvent.click(saveButton());
    expect(await screen.findByText("Failed: 503")).toBeInTheDocument();
  });

  it("reports a network failure while saving", async () => {
    serve({ executionHistoryDays: 7, commandHistoryDays: 7 }, () => Promise.reject("offline"));
    render(<HistoryRetentionCard />);
    fireEvent.change(await commandInput(), { target: { value: "90" } });
    fireEvent.click(saveButton());
    expect(await screen.findByText("Failed to save")).toBeInTheDocument();
  });

  it("says so when the settings cannot be loaded", async () => {
    h.authFetch.mockImplementation(() => json({}, false, 500));
    render(<HistoryRetentionCard />);
    expect(await screen.findByText("History retention settings could not be loaded.")).toBeInTheDocument();
  });

  it("lets a public-demo visitor explore the fields but never saves", async () => {
    h.demoState.readOnly = true;
    serve({ executionHistoryDays: 7, commandHistoryDays: 7 });
    render(<HistoryRetentionCard />);
    fireEvent.change(await commandInput(), { target: { value: "90" } });

    const button = screen.getByRole("button", { name: "Demo preview · not saved" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(putBodies()).toEqual([]));
    expect(screen.getByText(/Nothing here can be saved/)).toBeInTheDocument();
  });
});
