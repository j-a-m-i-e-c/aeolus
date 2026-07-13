// frontend/src/components/mqtt/SharedPasswordPanel.test.tsx — Shared credential display, copy, regenerate

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

type SharedCredential = { username: string; password: string } | null;

const h = vi.hoisted(() => {
  const regenerateSharedPassword = vi.fn().mockResolvedValue(undefined);
  const state: {
    sharedCredential: SharedCredential;
    loading: boolean;
    regenerateSharedPassword: typeof regenerateSharedPassword;
  } = {
    sharedCredential: { username: "shared_user", password: "shared_pw_123" },
    loading: false,
    regenerateSharedPassword,
  };
  return { state, regenerateSharedPassword };
});

vi.mock("../../store/mqtt-provisioning-store", () => ({
  useMqttProvisioningStore: () => h.state,
}));

import SharedPasswordPanel from "./SharedPasswordPanel";

function setClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe("SharedPasswordPanel", () => {
  beforeEach(() => {
    h.regenerateSharedPassword.mockReset().mockResolvedValue(undefined);
    h.state.sharedCredential = { username: "shared_user", password: "shared_pw_123" };
    h.state.loading = false;
    setClipboard();
  });

  it("renders nothing when there is no shared credential", () => {
    h.state.sharedCredential = null;
    const { container } = render(<SharedPasswordPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the shared username and password", () => {
    render(<SharedPasswordPanel />);
    expect(screen.getByText("Shared Credential")).toBeInTheDocument();
    expect(screen.getByText("shared_user")).toBeInTheDocument();
    expect(screen.getByText("shared_pw_123")).toBeInTheDocument();
  });

  it("copies a field value to the clipboard", async () => {
    const writeText = setClipboard();
    render(<SharedPasswordPanel />);
    const copyButtons = screen.getAllByLabelText("Copy to clipboard");
    fireEvent.click(copyButtons[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("shared_user"));
  });

  it("triggers a password regeneration on button click", () => {
    render(<SharedPasswordPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Regenerate Password/ }));
    expect(h.regenerateSharedPassword).toHaveBeenCalledTimes(1);
  });

  it("disables the regenerate button while loading", () => {
    h.state.loading = true;
    render(<SharedPasswordPanel />);
    expect(screen.getByRole("button", { name: /Regenerate Password/ })).toBeDisabled();
  });
});
