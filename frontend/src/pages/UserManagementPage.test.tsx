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
  demoState: { readOnly: false },
}));

vi.mock("../lib/auth-fetch", () => ({ authFetch: h.authFetch }));
vi.mock("../hooks/useReadOnlyDemo", () => ({ useReadOnlyDemo: () => h.demoState.readOnly }));

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
    h.demoState.readOnly = false;
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
    // Every row (admin and user) now exposes a delete action; the last-admin
    // safeguard is enforced server-side (409), not by hiding the control.
    expect(screen.getAllByTitle("Delete user")).toHaveLength(2);
  });

  it("lets demo visitors inspect user creation and editing without writes", async () => {
    h.demoState.readOnly = true;
    h.users = sampleUsers;
    render(<UserManagementPage />);
    await screen.findByText("alice");

    fireEvent.click(screen.getByRole("button", { name: /Add User/ }));
    fireEvent.change(screen.getByPlaceholderText("username"), { target: { value: "visitor" } });
    expect(screen.getAllByRole("button", { name: /Demo preview · not saved/i })[0]).toBeDisabled();

    fireEvent.click(screen.getAllByTitle("Edit user")[1]);
    expect(screen.getByText("Edit User: alice")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Demo preview · not saved/i }).at(-1)).toBeDisabled();
    expect(screen.queryByTitle("Delete user")).not.toBeInTheDocument();
    expect(h.authFetch.mock.calls.some((c) => ["POST", "PUT", "DELETE"].includes(c[1]?.method))).toBe(false);
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
    // Rows are [root (admin), alice (user)]; delete the second (alice).
    fireEvent.click(screen.getAllByTitle("Delete user")[1]);
    expect(screen.getByText("Delete User")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(h.authFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/users/user-1"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("submits the selected role when creating a user", async () => {
    render(<UserManagementPage />);
    await screen.findByText("No users found");
    fireEvent.click(screen.getByRole("button", { name: /Add User/ }));
    fireEvent.change(screen.getByPlaceholderText("username"), { target: { value: "bob" } });
    fireEvent.change(screen.getByPlaceholderText("min 8 characters"), {
      target: { value: "password123" },
    });
    // Choose the admin role.
    fireEvent.change(screen.getByRole("combobox", { name: /Role/i }), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(h.authFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/users"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = h.authFetch.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(postCall![1].body)).toMatchObject({
      username: "bob",
      password: "password123",
      role: "admin",
    });
  });

  it("sends a role change from the edit modal", async () => {
    h.users = sampleUsers;
    render(<UserManagementPage />);
    await screen.findByText("alice");
    // Edit alice (row index 1) and promote to admin.
    fireEvent.click(screen.getAllByTitle("Edit user")[1]);
    expect(screen.getByText("Edit User: alice")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: /Role/i }), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(h.authFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/users/user-1"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    const putCall = h.authFetch.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(JSON.parse(putCall![1].body)).toMatchObject({ role: "admin" });
  });

  it("surfaces a 409 when deleting the last admin and keeps the row", async () => {
    h.users = sampleUsers;
    render(<UserManagementPage />);
    await screen.findByText("root");
    h.authFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "DELETE") return jsonRes({ error: "Cannot remove the last admin user" }, false);
      if (url.endsWith("/api/auth/users") && method === "GET") return jsonRes(h.users, h.usersOk);
      if (url.endsWith("/api/auth/groups") && method === "GET") return jsonRes(h.groups);
      return jsonRes({ id: "new-id" });
    });
    // Delete the admin row (index 0).
    fireEvent.click(screen.getAllByTitle("Delete user")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Cannot remove the last admin user")).toBeInTheDocument();
    // Row is still present (also appears in the still-open confirm modal).
    expect(screen.getAllByText("root").length).toBeGreaterThan(0);
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
