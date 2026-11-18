import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
const h = vi.hoisted(() => ({ authFetch: vi.fn(), demoState: { readOnly: false } }));
vi.mock("../../lib/auth-fetch", () => ({ authFetch: h.authFetch }));
vi.mock("../../hooks/useReadOnlyDemo", () => ({ useReadOnlyDemo: () => h.demoState.readOnly }));
import { HistoryRetentionCard } from "./HistoryRetentionCard";
function json(data: unknown, ok = true, status = 200) { return Promise.resolve({ ok, status, json: async () => data }); }
function serve(days: number | null, putResponse?: () => Promise<unknown>) {
  let current = { executionHistoryDays: days };
  h.authFetch.mockImplementation((_url: string, options?: RequestInit) => {
    if (options?.method === "PUT") {
      if (putResponse) return putResponse();
      current = { ...current, ...JSON.parse(String(options.body)) };
    }
    return json(current);
  });
}
const input = () => screen.findByLabelText("Execution history");
const save = () => screen.getByRole("button", { name: /^Save$/ });
const sent = () => h.authFetch.mock.calls.filter(([,opts]) => opts?.method === "PUT").map(([,opts]) => JSON.parse(String(opts.body)));
describe("HistoryRetentionCard", () => {
  beforeEach(() => { h.authFetch.mockReset(); h.demoState.readOnly = false; });
  it("only configures execution logs and says command evidence is kept", async () => {
    serve(7); render(<HistoryRetentionCard />);
    expect(await input()).toHaveValue(7);
    expect(screen.queryByLabelText("Command history")).not.toBeInTheDocument();
    expect(screen.getByText(/command evidence is preserved indefinitely/i)).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });
  it("saves an extended period without confirmation", async () => {
    serve(7); render(<HistoryRetentionCard />);
    fireEvent.change(await input(), { target: { value: "30" } }); fireEvent.click(save());
    expect(await screen.findByText("Saved and applied")).toBeInTheDocument();
    expect(sent()).toEqual([{ executionHistoryDays: 30 }]);
  });
  it("warns before shortening execution retention without offering command deletion", async () => {
    serve(30); render(<HistoryRetentionCard />);
    fireEvent.change(await input(), { target: { value: "1" } }); fireEvent.click(save());
    expect(screen.getByText(/Command evidence is not deleted/)).toBeInTheDocument();
    expect(sent()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Delete older logs and save" }));
    expect(await screen.findByText("Saved and applied")).toBeInTheDocument();
    expect(sent()).toEqual([{ executionHistoryDays: 1 }]);
  });
  it("allows keeping logs indefinitely", async () => {
    serve(7); render(<HistoryRetentionCard />);
    await input(); fireEvent.click(screen.getByRole("checkbox", { name: "Keep forever" })); fireEvent.click(save());
    expect(await screen.findByText("Saved and applied")).toBeInTheDocument();
    expect(sent()).toEqual([{ executionHistoryDays: null }]);
  });
  it("rejects invalid entries", async () => {
    serve(7); render(<HistoryRetentionCard />);
    fireEvent.change(await input(), { target: { value: "3651" } });
    expect(save()).toBeDisabled();
    expect(screen.getByText(/Enter a whole number/)).toBeInTheDocument();
  });
  it("does not save in public demo", async () => {
    h.demoState.readOnly = true; serve(7); render(<HistoryRetentionCard />);
    fireEvent.change(await input(), { target: { value: "30" } });
    expect(screen.getByRole("button", { name: "Demo preview · not saved" })).toBeDisabled();
    expect(sent()).toEqual([]);
  });
  it("reports GET errors", async () => {
    h.authFetch.mockImplementation(() => json({}, false, 503));
    render(<HistoryRetentionCard />);
    expect(await screen.findByText("History retention settings could not be loaded.")).toBeInTheDocument();
  });
  it("reports PUT errors and retains edits", async () => {
    serve(7, () => json({ error: "Rejected" }, false, 400)); render(<HistoryRetentionCard />);
    fireEvent.change(await input(), { target: { value: "30" } }); fireEvent.click(save());
    expect(await screen.findByText("Rejected")).toBeInTheDocument();
    expect(await input()).toHaveValue(30);
  });
  it("falls back to the status code when a PUT error has no body", async () => {
    serve(7, () => Promise.resolve({ ok: false, status: 503, json: async () => { throw new Error("not json"); } }));
    render(<HistoryRetentionCard />);
    fireEvent.change(await input(), { target: { value: "30" } }); fireEvent.click(save());
    expect(await screen.findByText("Failed: 503")).toBeInTheDocument();
  });
  it("reports a network failure while saving", async () => {
    serve(7, () => Promise.reject("offline")); render(<HistoryRetentionCard />);
    fireEvent.change(await input(), { target: { value: "30" } }); fireEvent.click(save());
    expect(await screen.findByText("Failed to save")).toBeInTheDocument();
  });
  it("cancels deletion warning", async () => {
    serve(30); render(<HistoryRetentionCard />);
    fireEvent.change(await input(), { target: { value: "7" } }); fireEvent.click(save());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(sent()).toEqual([]);
  });
});
