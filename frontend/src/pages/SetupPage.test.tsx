// frontend/src/pages/SetupPage.test.tsx — First-run admin setup: validation, submission, errors

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockSetup } = vi.hoisted(() => ({ mockSetup: vi.fn() }));

vi.mock("../store/auth-store", () => ({
  useAuthStore: (selector: (s: { setup: typeof mockSetup }) => unknown) =>
    selector({ setup: mockSetup }),
}));

import { SetupPage } from "./SetupPage";

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

describe("SetupPage", () => {
  beforeEach(() => {
    mockSetup.mockReset();
  });

  it("renders the create-admin form", () => {
    render(<SetupPage />);
    expect(screen.getByText("Create Admin Account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
  });

  it("requires a username", () => {
    render(<SetupPage />);
    submit();
    expect(screen.getByText("Username is required")).toBeInTheDocument();
    expect(mockSetup).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters", () => {
    render(<SetupPage />);
    fill("Username", "admin");
    fill("Password", "short");
    fill("Confirm Password", "short");
    submit();
    expect(screen.getByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(mockSetup).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords", () => {
    render(<SetupPage />);
    fill("Username", "admin");
    fill("Password", "supersecret");
    fill("Confirm Password", "different123");
    submit();
    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    expect(mockSetup).not.toHaveBeenCalled();
  });

  it("calls setup with the entered credentials on valid submit", async () => {
    mockSetup.mockResolvedValueOnce(undefined);
    render(<SetupPage />);
    fill("Username", "admin");
    fill("Password", "supersecret");
    fill("Confirm Password", "supersecret");
    submit();
    await waitFor(() => expect(mockSetup).toHaveBeenCalledWith("admin", "supersecret"));
  });

  it("shows the error message when setup rejects with an Error", async () => {
    mockSetup.mockRejectedValueOnce(new Error("Username already taken"));
    render(<SetupPage />);
    fill("Username", "admin");
    fill("Password", "supersecret");
    fill("Confirm Password", "supersecret");
    submit();
    expect(await screen.findByText("Username already taken")).toBeInTheDocument();
  });

  it("shows a generic error when setup rejects with a non-Error", async () => {
    mockSetup.mockRejectedValueOnce("nope");
    render(<SetupPage />);
    fill("Username", "admin");
    fill("Password", "supersecret");
    fill("Confirm Password", "supersecret");
    submit();
    expect(await screen.findByText("Setup failed")).toBeInTheDocument();
  });

  it("disables the form and shows progress while submitting", async () => {
    let resolveSetup: () => void = () => {};
    mockSetup.mockReturnValueOnce(new Promise<void>((r) => { resolveSetup = r; }));
    render(<SetupPage />);
    fill("Username", "admin");
    fill("Password", "supersecret");
    fill("Confirm Password", "supersecret");
    submit();

    expect(await screen.findByText("Creating account…")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeDisabled();

    // Resolve and let the component settle back to the idle state.
    resolveSetup();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument(),
    );
  });
});
