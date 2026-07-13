// frontend/src/pages/LoginPage.test.tsx — Login form validation, submission, and error handling

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockLogin } = vi.hoisted(() => ({ mockLogin: vi.fn() }));

vi.mock("../store/auth-store", () => ({
  useAuthStore: (selector: (s: { login: typeof mockLogin }) => unknown) =>
    selector({ login: mockLogin }),
}));

import { LoginPage } from "./LoginPage";

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("LoginPage", () => {
  beforeEach(() => {
    mockLogin.mockReset();
  });

  it("renders the sign-in form", () => {
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("requires a username", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(screen.getByText("Username is required")).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("requires a password", () => {
    render(<LoginPage />);
    fill("Username", "admin");
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("calls login with the entered credentials on valid submit", async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    render(<LoginPage />);
    fill("Username", "admin");
    fill("Password", "supersecret");
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("admin", "supersecret"));
  });

  it("shows the error message when login rejects with an Error", async () => {
    mockLogin.mockRejectedValueOnce(new Error("Invalid credentials"));
    render(<LoginPage />);
    fill("Username", "admin");
    fill("Password", "wrongpass");
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
  });

  it("shows a generic error when login rejects with a non-Error", async () => {
    mockLogin.mockRejectedValueOnce("nope");
    render(<LoginPage />);
    fill("Username", "admin");
    fill("Password", "wrongpass");
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(await screen.findByText("Login failed")).toBeInTheDocument();
  });

  it("disables the form and shows progress while submitting", async () => {
    let resolveLogin: () => void = () => {};
    mockLogin.mockReturnValueOnce(new Promise<void>((r) => { resolveLogin = r; }));
    render(<LoginPage />);
    fill("Username", "admin");
    fill("Password", "supersecret");
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    expect(await screen.findByText("Signing in…")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeDisabled();

    // Resolve and let the component settle back to the idle state.
    resolveLogin();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument(),
    );
  });
});
