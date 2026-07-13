// frontend/src/pages/GroupManagementPage.test.tsx — Admin group CRUD: list, create, edit, delete, errors

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

interface GroupRecord {
  id: string;
  name: string;
  tabAssignments: { tabId: string; permission: "read" | "interact" | "write" }[];
  createdAt: number;
}

interface UserRecord {
  id: string;
  username: string;
  role: "admin" | "user";
  groupId: string | null;
}

const h = vi.hoisted(() => ({
  authFetch: vi.fn(),
  groups: [] as GroupRecord[],
  users: [] as UserRecord[],
  groupsOk: true,
  tabs: [
    { id: "t1", name: "Overview", pinned: false },
    { id: "t2", name: "Devices", pinned: true },
  ],
}));

vi.mock("../lib/auth-fetch", () => ({ authFetch: h.authFetch }));

vi.mock("../store/dashboard-store", () => ({
  useDashboardStore: (selector: (s: { tabs: typeof h.tabs }) => unknown) =>
    selector({ tabs: h.tabs }),
}));

import { GroupManagementPage } from "./GroupManagementPage";

function jsonRes(data: unknown, ok = true) {
  return { ok, json: async () => data } as Response;
}

const sampleGroups: GroupRecord[] = [
  {
    id: "g1",
    name: "Family",
    tabAssignments: [{ tabId: "t1", permission: "write" }],
    createdAt: 1_700_000_000_000,
  },
];

describe("GroupManagementPage", () => {
  beforeEach(() => {
    h.groups = [];
    h.users = [];
    h.groupsOk = true;
    h.authFetch.mockReset();
    h.authFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (url.endsWith("/api/auth/groups") && method === "GET") return jsonRes(h.groups, h.groupsOk);
      if (url.endsWith("/api/auth/users") && method === "GET") return jsonRes(h.users);
      return jsonRes({ id: "new-id" });
    });
  });

  it("renders the empty state when there are no groups", async () => {
    render(<GroupManagementPage />);
    expect(await screen.findByText(/No groups created yet/)).toBeInTheDocument();
  });

  it("renders a card for each group with member counts", async () => {
    h.groups = sampleGroups;
    h.users = [{ id: "u1", username: "alice", role: "user", groupId: "g1" }];
    render(<GroupManagementPage />);
    expect(await screen.findByText("Family")).toBeInTheDocument();
    expect(screen.getByText("1 user")).toBeInTheDocument();
    expect(screen.getByText(/Members: alice/)).toBeInTheDocument();
    // Assigned tab name resolved from the dashboard store.
    expect(screen.getByText("Overview")).toBeInTheDocument();
  });

  it("shows an error banner when the groups request fails", async () => {
    h.groupsOk = false;
    render(<GroupManagementPage />);
    expect(await screen.findByText("Failed to fetch groups")).toBeInTheDocument();
  });

  it("validates that a group name is required before creating", async () => {
    render(<GroupManagementPage />);
    await screen.findByText(/No groups created yet/);
    fireEvent.click(screen.getByRole("button", { name: /Add Group/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Group name is required")).toBeInTheDocument();
  });

  it("submits a create request with the entered name", async () => {
    render(<GroupManagementPage />);
    await screen.findByText(/No groups created yet/);
    fireEvent.click(screen.getByRole("button", { name: /Add Group/ }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Family, Guests"), {
      target: { value: "Guests" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(h.authFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/groups"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = h.authFetch.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(postCall![1].body)).toMatchObject({ name: "Guests" });
  });

  it("deletes a group after confirming in the modal", async () => {
    h.groups = sampleGroups;
    render(<GroupManagementPage />);
    await screen.findByText("Family");
    fireEvent.click(screen.getByTitle("Delete group"));
    expect(screen.getByText("Delete Group")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(h.authFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/groups/g1"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("edits a group's name from the edit modal", async () => {
    h.groups = sampleGroups;
    render(<GroupManagementPage />);
    await screen.findByText("Family");
    fireEvent.click(screen.getByTitle("Edit group"));
    expect(screen.getByText("Edit Group: Family")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Family"), { target: { value: "Household" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(h.authFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/groups/g1"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });
});
