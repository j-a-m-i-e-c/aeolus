// frontend/src/pages/UserManagementPage.test.tsx — Admin user CRUD: list, create, edit, delete, errors

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

interface UserRecord {
  id: string;
  username: string;
  role: "admin" | "user";
  groupId: string | null;
  createdAt: number;
}

const h = vi.hoisted(() => ({
  authFetch: vi.fn(),
  users: [] as UserRecord[],
  groups: [] as { id: string; name: string }[],
  usersOk: true,
}));

vi.mock("../lib/auth-fetch", () => ({ authFetch: h.authFetch }));

import { UserManagementPage } from "./UserManagementPage";

function jsonRes(data: unknown, ok = true) {
  return { ok, json: async () => data } as Response;
}

const sampleUsers: UserRecord[] = [
  { id: "admin-1", username: "root", role: "admin", groupId: null, createdAt: 1_700_000_000_000 },
  { id: "user-1", username: "alice", role: "user", groupId: "g1", createdAt: 1_700_100_000_000 },
];

describe("UserManagementPage", () => {
  beforeEach(() => {
    h.users = [];
    h.groups = [];
    h.usersOk = true;
    h.authFetch.mockReset();
    h.authFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (url.endsWith("/api/auth/users") && method === "GET") return jsonRes(h.users, h.usersOk);
      if (url.endsWith("/api/auth/groups") && method === "GET") return jsonRes(h.groups);
      return jsonRes({ id: "new-id" });
    });
  });

  it("renders the empty state when there are no users", async () => {
    render(<UserManagementPage />);
    expect(await screen.findByText("No users found")).toBeInTheDocument();
  });

  it("renders a row for each user with role badges", async () => {
    h.users = sampleUsers;
    h.groups = [{ id: "g1", name: "Family" }];
    render(<UserManagementPage />);
    expect(await screen.findByText("root")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    // Group name resolved from the groups list.
    expect(screen.getByText("Family")).toBeInTheDocument();
    // Admin rows expose no delete action; only the user row does.
    expect(screen.getByTitle("Delete user")).toBeInTheDocument();
  });

  it("shows an error banner when the users request fails", async () => {
    h.usersOk = false;
    render(<UserManagementPage />);
    expect(await screen.findByText("Failed to fetch users")).toBeInTheDocument();
  });

  it("validates that a username is required before creating", async () => {
    render(<UserManagementPage />);
    await screen.findByText("No users found");
    fireEvent.click(screen.getByRole("button", { name: /Add User/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Username is required")).toBeInTheDocument();
    expect(h.authFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/users"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("validates the minimum password length before creating", async () => {
    render(<UserManagementPage />);
    await screen.findByText("No users found");
    fireEvent.click(screen.getByRole("button", { name: /Add User/ }));
    fireEvent.change(screen.getByPlaceholderText("username"), { target: { value: "bob" } });
    fireEvent.change(screen.getByPlaceholderText("min 8 characters"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Password must be at least 8 characters")).toBeInTheDocument();
  });

  it("submits a create request with the entered values", async () => {
    render(<UserManagementPage />);
    await screen.findByText("No users found");
    fireEvent.click(screen.getByRole("button", { name: /Add User/ }));
    fireEvent.change(screen.getByPlaceholderText("username"), { target: { value: "bob" } });
    fireEvent.change(screen.getByPlaceholderText("min 8 characters"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(h.authFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/users"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = h.authFetch.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(postCall![1].body)).toMatchObject({ username: "bob", password: "password123" });
  });

  it("surfaces the server error message when creation fails", async () => {
    render(<UserManagementPage />);
    await screen.findByText("No users found");
    fireEvent.click(screen.getByRole("button", { name: /Add User/ }));
    // Override only POST requests to fail — the refetch of groups (GET) should still succeed.
    h.authFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "POST") return jsonRes({ error: "Username taken" }, false);
      if (url.endsWith("/api/auth/users") && method === "GET") return jsonRes(h.users, h.usersOk);
      if (url.endsWith("/api/auth/groups") && method === "GET") return jsonRes(h.groups);
      return jsonRes({ id: "new-id" });
    });
    fireEvent.change(screen.getByPlaceholderText("username"), { target: { value: "bob" } });
    fireEvent.change(screen.getByPlaceholderText("min 8 characters"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Username taken")).toBeInTheDocument();
  });

  it("deletes a non-admin user after confirming in the modal", async () => {
    h.users = sampleUsers;
    render(<UserManagementPage />);
    await screen.findByText("alice");
    fireEvent.click(screen.getByTitle("Delete user"));
    expect(screen.getByText("Delete User")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(h.authFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/users/user-1"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("edits a user's password from the edit modal", async () => {
    h.users = sampleUsers;
    render(<UserManagementPage />);
    await screen.findByText("alice");
    fireEvent.click(screen.getAllByTitle("Edit user")[1]);
    expect(screen.getByText("Edit User: alice")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Leave blank to keep current"), {
      target: { value: "newpassword123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(h.authFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/users/user-1"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });
});
