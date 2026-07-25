// frontend/src/pages/SecurityPage.test.tsx — Admin gate + section tab switching

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

type AuthUser = { role: "admin" | "user" } | null;

const h = vi.hoisted(() => ({ state: { user: null as AuthUser } }));

vi.mock("../store/auth-store", () => ({
  useAuthStore: (selector: (s: { user: AuthUser }) => unknown) => selector(h.state),
}));

vi.mock("./MqttSecurityPage", () => ({
  default: () => <div data-testid="mqtt-security" />,
}));

vi.mock("./GroupManagementPage", () => ({
  GroupManagementPage: () => <div data-testid="group-management" />,
}));

vi.mock("./UserManagementPage", () => ({
  UserManagementPage: () => <div data-testid="user-management" />,
}));

import SecurityPage from "./SecurityPage";

describe("SecurityPage", () => {
  beforeEach(() => {
    h.state.user = null;
  });

  it("denies access to non-admin users", () => {
    h.state.user = { role: "user" };
    render(<SecurityPage />);
    expect(screen.getByText("Access denied — admin only")).toBeInTheDocument();
    expect(screen.queryByTestId("mqtt-security")).not.toBeInTheDocument();
  });

  it("shows the Users & Groups section by default for admins", () => {
    h.state.user = { role: "admin" };
    render(<SecurityPage />);
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByTestId("group-management")).toBeInTheDocument();
    expect(screen.getByTestId("user-management")).toBeInTheDocument();
    expect(screen.queryByTestId("mqtt-security")).not.toBeInTheDocument();
  });

  it("switches to the MQTT section when its tab is clicked", () => {
    h.state.user = { role: "admin" };
    render(<SecurityPage />);
    fireEvent.click(screen.getByRole("button", { name: /MQTT/ }));
    expect(screen.getByTestId("mqtt-security")).toBeInTheDocument();
    expect(screen.queryByTestId("user-management")).not.toBeInTheDocument();
  });

  it("switches back to the Users & Groups section", () => {
    h.state.user = { role: "admin" };
    render(<SecurityPage />);
    fireEvent.click(screen.getByRole("button", { name: /MQTT/ }));
    fireEvent.click(screen.getByRole("button", { name: /Users & Groups/ }));
    expect(screen.getByTestId("group-management")).toBeInTheDocument();
    expect(screen.getByTestId("user-management")).toBeInTheDocument();
  });
});
