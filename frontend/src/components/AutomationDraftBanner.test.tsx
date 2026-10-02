// frontend/src/components/AutomationDraftBanner.test.tsx — recovery prompt for an unsaved local draft

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AutomationDraftBanner } from "./AutomationDraftBanner";

const SAVED_AT = new Date("2026-09-30T14:05:00Z").getTime();

describe("AutomationDraftBanner", () => {
  it("offers restore and discard without acting on its own", () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    render(
      <AutomationDraftBanner savedAt={SAVED_AT} conflict={false} onRestore={onRestore} onDiscard={onDiscard} />,
    );

    // A draft is always opt-in: rendering the prompt must not restore anything.
    expect(onRestore).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Restore local draft" }));
    expect(onRestore).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Discard local draft" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("stays quiet about conflicts when the server version is unchanged", () => {
    render(
      <AutomationDraftBanner savedAt={SAVED_AT} conflict={false} onRestore={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(screen.queryByText(/server version changed/i)).not.toBeInTheDocument();
  });

  it("warns that restoring is local-only when the server version moved on", () => {
    render(
      <AutomationDraftBanner savedAt={SAVED_AT} conflict onRestore={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(screen.getByText(/server version changed since this draft began/i)).toBeInTheDocument();
    // The prompt must not imply the save will succeed.
    expect(screen.getByText(/fresh server-version check/i)).toBeInTheDocument();
  });

  it("is announced as an alert so it is not missed on reopening an editor", () => {
    render(
      <AutomationDraftBanner savedAt={SAVED_AT} conflict={false} onRestore={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
