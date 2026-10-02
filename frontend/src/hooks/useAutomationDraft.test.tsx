import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const storage = vi.hoisted(() => ({
  read: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../lib/automation-drafts", () => ({
  readAutomationDraft: (...args: unknown[]) => storage.read(...args),
  putAutomationDraft: (...args: unknown[]) => storage.put(...args),
  deleteAutomationDraft: (...args: unknown[]) => storage.remove(...args),
}));
import { useAutomationDraft } from "./useAutomationDraft";

interface Payload { name: string; project: { files: Array<{ path: string; content: string }> } }
const server: Payload = { name: "Pump", project: { files: [{ path: "logic/index.ts", content: "// server" }] } };
const edited: Payload = { name: "Pump", project: { files: [{ path: "logic/index.ts", content: "// local" }] } };

beforeEach(() => {
  storage.read.mockReset().mockResolvedValue(undefined);
  storage.put.mockReset().mockResolvedValue(undefined);
  storage.remove.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

function useDraftHarness(payload: Payload, restore = vi.fn()) {
  return useAutomationDraft({ key: "user-a:page:rule-1", enabled: true, payload, restore });
}

describe("automation draft recovery", () => {
  it("does not persist the unchanged server snapshot", async () => {
    renderHook(() => useDraftHarness(server));
    await waitFor(() => expect(storage.read).toHaveBeenCalled());
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("offers an old draft instead of silently applying it", async () => {
    const restore = vi.fn();
    storage.read.mockResolvedValue({
      key: "user-a:page:rule-1", baseline: JSON.stringify(server), payload: edited, savedAt: 100,
    });
    const { result } = renderHook(() => useDraftHarness(server, restore));
    await waitFor(() => expect(result.current.recovery?.savedAt).toBe(100));
    expect(restore).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    act(() => result.current.recover());
    expect(restore).toHaveBeenCalledWith(edited);
  });

  it("does not overwrite the recoverable snapshot while the prompt is unanswered", async () => {
    storage.read.mockResolvedValue({
      key: "user-a:page:rule-1", baseline: JSON.stringify(server), payload: edited, savedAt: 100,
    });
    const { result, rerender } = renderHook(({ payload }) => useDraftHarness(payload), { initialProps: { payload: server } });
    await waitFor(() => expect(result.current.recovery).not.toBeNull());

    // Typing before choosing Restore/Discard must not autosave over the draft
    // the prompt is offering, or the recoverable work is lost to the prompt.
    vi.useFakeTimers();
    rerender({ payload: { ...server, name: "Pump B" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    vi.useRealTimers();
    expect(storage.put).not.toHaveBeenCalled();
    expect(result.current.recovery?.payload).toEqual(edited);
  });

  it("discards explicitly rejected local recovery", async () => {
    storage.read.mockResolvedValue({
      key: "user-a:page:rule-1", baseline: JSON.stringify(server), payload: edited, savedAt: 100,
    });
    const { result } = renderHook(() => useDraftHarness(server));
    await waitFor(() => expect(result.current.recovery).not.toBeNull());
    act(() => result.current.discardRecovery());
    expect(storage.remove).toHaveBeenCalledWith("user-a:page:rule-1");
  });

  it("debounces changed projects and clears only a successfully saved version", async () => {
    const { result, rerender } = renderHook(({ payload }) => useDraftHarness(payload), { initialProps: { payload: server } });
    await waitFor(() => expect(storage.read).toHaveBeenCalled());
    vi.useFakeTimers();
    rerender({ payload: edited });
    await act(async () => { await vi.advanceTimersByTimeAsync(550); });
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ payload: edited }));
    act(() => result.current.markSaved(edited));
    expect(storage.remove).toHaveBeenCalledWith("user-a:page:rule-1");
  });

  it("preserves newer edits made while an earlier snapshot was being saved", async () => {
    const { result, rerender } = renderHook(({ payload }) => useDraftHarness(payload), { initialProps: { payload: server } });
    await waitFor(() => expect(storage.read).toHaveBeenCalled());
    rerender({ payload: edited });
    let newer: Payload | null = null;
    act(() => { newer = result.current.markSaved(server); });
    expect(newer).toEqual(edited);
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({
      baseline: JSON.stringify(server), payload: edited,
    }));
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("surfaces unavailable browser draft storage", async () => {
    storage.read.mockRejectedValue(new Error("quota/storage unavailable"));
    const { result } = renderHook(() => useDraftHarness(server));
    await waitFor(() => expect(result.current.storageError).toBe(true));
  });

  // ADR-0025 requires a failed local write to be visible: silently losing the
  // recovery snapshot would leave an author believing their work is protected.
  it("reports a debounced autosave that the browser refuses to store", async () => {
    const { result, rerender } = renderHook(({ payload }) => useDraftHarness(payload), { initialProps: { payload: server } });
    await waitFor(() => expect(storage.read).toHaveBeenCalled());
    storage.put.mockRejectedValue(new Error("QuotaExceededError"));
    vi.useFakeTimers();
    rerender({ payload: edited });
    await act(async () => { await vi.advanceTimersByTimeAsync(550); });
    vi.useRealTimers();
    await waitFor(() => expect(result.current.storageError).toBe(true));
  });

  it("reports a failed write when retaining edits made during a save", async () => {
    const { result, rerender } = renderHook(({ payload }) => useDraftHarness(payload), { initialProps: { payload: server } });
    await waitFor(() => expect(storage.read).toHaveBeenCalled());
    storage.put.mockRejectedValue(new Error("QuotaExceededError"));
    rerender({ payload: edited });
    act(() => { result.current.markSaved(server); });
    await waitFor(() => expect(result.current.storageError).toBe(true));
  });
});
