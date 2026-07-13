// frontend/src/components/mqtt/CredentialCreatedDialog.test.tsx — One-time credential dialog: render, copy, dismiss

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CredentialCreatedDialog from "./CredentialCreatedDialog";
import type { MqttCredential } from "../../store/mqtt-provisioning-store";

const credential: MqttCredential = {
  id: "cred-1",
  deviceName: "Living Room Sensor",
  username: "device_living_room",
  password: "s3cr3t-pass-xyz",
};

function setClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe("CredentialCreatedDialog", () => {
  beforeEach(() => {
    setClipboard();
  });

  it("renders the credential and the one-time warning", () => {
    render(<CredentialCreatedDialog credential={credential} onClose={vi.fn()} />);
    expect(screen.getByText("Credential Created")).toBeInTheDocument();
    expect(screen.getByText("Save this password now. It won't be shown again.")).toBeInTheDocument();
    expect(screen.getByText("device_living_room")).toBeInTheDocument();
    expect(screen.getByText("s3cr3t-pass-xyz")).toBeInTheDocument();
  });

  it("copies the username to the clipboard", async () => {
    const writeText = setClipboard();
    render(<CredentialCreatedDialog credential={credential} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTitle("Copy username"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("device_living_room"));
  });

  it("copies the password to the clipboard", async () => {
    const writeText = setClipboard();
    render(<CredentialCreatedDialog credential={credential} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTitle("Copy password"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("s3cr3t-pass-xyz"));
  });

  it("calls onClose when the Done button is clicked", () => {
    const onClose = vi.fn();
    render(<CredentialCreatedDialog credential={credential} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the header close (X) button is clicked", () => {
    const onClose = vi.fn();
    render(<CredentialCreatedDialog credential={credential} onClose={onClose} />);
    // The header close button is the first button in the dialog.
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not throw when clipboard access rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    setClipboard(writeText);
    render(<CredentialCreatedDialog credential={credential} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTitle("Copy username"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    // The password remains visible; no crash occurred.
    expect(screen.getByText("s3cr3t-pass-xyz")).toBeInTheDocument();
  });
});
