// frontend/src/pages/UsersPage.test.tsx — Admin-only gate + composition of group/user management

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type AuthUser = { role: "admin" | "user" } | null;

const h = vi.hoisted(() => ({ state: { user: null as AuthUser } }));

vi.mock("../store/auth-store", () => ({
  useAuthStore: (selector: (s: { user: AuthUser }) => unknown) => selector(h.state),
}));

vi.mock("./GroupManagementPage", () => ({
  GroupManagementPage: () => <div data-testid="group-management" />,
}));

vi.mock("./UserManagementPage", () => ({
  UserManagementPage: () => <div data-testid="user-management" />,
}));

import { UsersPage } from "./UsersPage";

describe("UsersPage", () => {
  beforeEach(() => {
    h.state.user = null;
  });

  it("denies access to non-admin users", () => {
    h.state.user = { role: "user" };
    render(<UsersPage />);
    expect(screen.getByText("Access denied — admin only")).toBeInTheDocument();
    expect(screen.queryByTestId("group-management")).not.toBeInTheDocument();
  });

  it("denies access when there is no authenticated user", () => {
    h.state.user = null;
    render(<UsersPage />);
    expect(screen.getByText("Access denied — admin only")).toBeInTheDocument();
  });

  it("renders group and user management for admins", () => {
    h.state.user = { role: "admin" };
    render(<UsersPage />);
    expect(screen.getByText("Users & Groups")).toBeInTheDocument();
    expect(screen.getByTestId("group-management")).toBeInTheDocument();
    expect(screen.getByTestId("user-management")).toBeInTheDocument();
  });
});
