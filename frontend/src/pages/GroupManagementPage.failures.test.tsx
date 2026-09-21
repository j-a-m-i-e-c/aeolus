// frontend/src/pages/GroupManagementPage.failures.test.tsx
//
// GroupManagementPage.test.tsx covers the page working: groups render, a create
// request goes out, a delete confirms. This file covers what the operator sees when
// the server says no, plus the tab-assignment picker that decides what a group can
// actually reach.
//
// These matter more than a typical form: a group's tab assignments ARE the
// permission model, so an edit that silently fails — or an error the page swallows —
// leaves an administrator believing they granted or revoked access that they did not.

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
  tabs: [] as Array<{ id: string; name: string; pinned: boolean }>,
  /** How a write should fail: a JSON error body, an unreadable body, or a throw. */
  writeOutcome: { kind: "ok" } as
    | { kind: "ok" }
    | { kind: "error-body"; message: string }
    | { kind: "unreadable-body" }
    | { kind: "throws"; value: unknown },
}));

vi.mock("../lib/auth-fetch", () => ({ authFetch: h.authFetch }));
vi.mock("../hooks/useReadOnlyDemo", () => ({ useReadOnlyDemo: () => false }));
vi.mock("../store/dashboard-store", () => ({
  useDashboardStore: (selector: (s: { tabs: typeof h.tabs }) => unknown) => selector({ tabs: h.tabs }),
}));

import { GroupManagementPage } from "./GroupManagementPage";

const sampleGroup: GroupRecord = {
  id: "g1",
  name: "Family",
  tabAssignments: [{ tabId: "t1", permission: "write" }],
  createdAt: 1_700_000_000_000,
};

describe("GroupManagementPage — refusals and assignments", () => {
  beforeEach(() => {
    h.groups = [];
    h.users = [];
    h.tabs = [
      { id: "t1", name: "Overview", pinned: false },
      { id: "t2", name: "Devices", pinned: true },
    ];
    h.writeOutcome = { kind: "ok" };
    h.authFetch.mockReset();
    h.authFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") {
        if (url.endsWith("/api/auth/groups")) return { ok: true, json: async () => h.groups };
        return { ok: true, json: async () => h.users };
      }

      // Read once into a local so the discriminated union narrows; the value is
      // still whatever the test set before the request was made.
      const outcome = h.writeOutcome;
      switch (outcome.kind) {
        case "error-body":
          return { ok: false, json: async () => ({ error: outcome.message }) };
        case "unreadable-body":
          return { ok: false, json: async () => { throw new Error("not json"); } };
        case "throws":
          throw outcome.value;
        default:
          return { ok: true, json: async () => ({ id: "new-id" }) };
      }
    });
  });

  /** Render, wait for the first load, and open the create form. */
  async function openCreateForm() {
    render(<GroupManagementPage />);
    await screen.findByText(/No groups created yet/);
    fireEvent.click(screen.getByRole("button", { name: /Add Group/ }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Family, Guests"), {
      target: { value: "Guests" },
    });
  }

  /** Render with one group and open its edit modal. */
  async function openEditModal() {
    h.groups = [sampleGroup];
    render(<GroupManagementPage />);
    await screen.findByText("Family");
    fireEvent.click(screen.getByTitle("Edit group"));
    await screen.findByText("Edit Group: Family");
  }

  describe("creating a group", () => {
    it("shows the reason the server gave", async () => {
      h.writeOutcome = { kind: "error-body", message: "A group named Guests already exists" };
      await openCreateForm();
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(await screen.findByText("A group named Guests already exists")).toBeInTheDocument();
    });

    it("falls back to a generic message when the refusal body cannot be read", async () => {
      h.writeOutcome = { kind: "unreadable-body" };
      await openCreateForm();
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(await screen.findByText("Failed to create group")).toBeInTheDocument();
    });

    it("reports a request that never reached the server", async () => {
      h.writeOutcome = { kind: "throws", value: new Error("network down") };
      await openCreateForm();
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(await screen.findByText("network down")).toBeInTheDocument();
    });

    it("falls back to a generic message when the failure is not an Error", async () => {
      h.writeOutcome = { kind: "throws", value: "something odd" };
      await openCreateForm();
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(await screen.findByText("Failed to create group")).toBeInTheDocument();
    });

    it("keeps the form open after a failure so the entry is not lost", async () => {
      h.writeOutcome = { kind: "error-body", message: "Name already taken" };
      await openCreateForm();
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      await screen.findByText("Name already taken");
      expect(screen.getByPlaceholderText("e.g. Family, Guests")).toHaveValue("Guests");
    });
  });

  describe("editing a group", () => {
    it("requires a name before saving", async () => {
      await openEditModal();
      fireEvent.change(screen.getByDisplayValue("Family"), { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

      expect(await screen.findByText("Group name is required")).toBeInTheDocument();
      expect(h.authFetch.mock.calls.some((c) => c[1]?.method === "PUT")).toBe(false);
    });

    it("shows the reason the server gave", async () => {
      h.writeOutcome = { kind: "error-body", message: "Cannot rename the admin group" };
      await openEditModal();
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

      expect(await screen.findByText("Cannot rename the admin group")).toBeInTheDocument();
      // The modal stays open, so the attempted change is still on screen.
      expect(screen.getByText("Edit Group: Family")).toBeInTheDocument();
    });

    it("falls back to a generic message when the refusal body cannot be read", async () => {
      h.writeOutcome = { kind: "unreadable-body" };
      await openEditModal();
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

      expect(await screen.findByText("Failed to update group")).toBeInTheDocument();
    });

    it("reports a failure that is not an Error", async () => {
      h.writeOutcome = { kind: "throws", value: 500 };
      await openEditModal();
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

      expect(await screen.findByText("Failed to update group")).toBeInTheDocument();
    });

    it("sends the trimmed name and the current assignments", async () => {
      await openEditModal();
      fireEvent.change(screen.getByDisplayValue("Family"), { target: { value: "  Household  " } });
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() =>
        expect(h.authFetch.mock.calls.some((c) => c[1]?.method === "PUT")).toBe(true),
      );
      const put = h.authFetch.mock.calls.find((c) => c[1]?.method === "PUT")!;
      expect(JSON.parse(put[1].body)).toEqual({
        name: "Household",
        tabAssignments: [{ tabId: "t1", permission: "write" }],
      });
    });
  });

  describe("deleting a group", () => {
    async function openDeleteModal() {
      h.groups = [sampleGroup];
      render(<GroupManagementPage />);
      await screen.findByText("Family");
      fireEvent.click(screen.getByTitle("Delete group"));
      await screen.findByText("Delete Group");
    }

    it("shows the reason the server gave", async () => {
      h.writeOutcome = { kind: "error-body", message: "Group still has members" };
      await openDeleteModal();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      expect(await screen.findByText("Group still has members")).toBeInTheDocument();
    });

    it("falls back to a generic message when the refusal body cannot be read", async () => {
      h.writeOutcome = { kind: "unreadable-body" };
      await openDeleteModal();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      expect(await screen.findByText("Failed to delete group")).toBeInTheDocument();
    });

    it("reports a failure that is not an Error", async () => {
      h.writeOutcome = { kind: "throws", value: { code: "EPERM" } };
      await openDeleteModal();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      expect(await screen.findByText("Failed to delete group")).toBeInTheDocument();
    });

    it("warns how many members would lose their access, in the plural", async () => {
      h.users = [
        { id: "u1", username: "alice", role: "user", groupId: "g1" },
        { id: "u2", username: "bob", role: "user", groupId: "g1" },
      ];
      await openDeleteModal();
      // The count is interpolated, so the sentence spans several text nodes.
      expect(document.body.textContent).toContain("This group has 2 users assigned");
      expect(document.body.textContent).toContain("lose all tab access");
    });

    it("warns about a single member in the singular", async () => {
      h.users = [{ id: "u1", username: "alice", role: "user", groupId: "g1" }];
      await openDeleteModal();
      expect(document.body.textContent).toContain("This group has 1 user assigned");
    });

    it("does not warn about members when the group is empty", async () => {
      await openDeleteModal();
      expect(document.body.textContent).not.toContain("This group has");
    });
  });

  describe("tab assignments", () => {
    it("says so when there are no tabs to assign", async () => {
      h.tabs = [];
      await openCreateForm();
      expect(screen.getByText("No tabs available")).toBeInTheDocument();
    });

    it("grants read when a tab is first selected, as the least it can mean", async () => {
      await openCreateForm();
      fireEvent.click(screen.getAllByRole("checkbox")[0]!);
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() =>
        expect(h.authFetch.mock.calls.some((c) => c[1]?.method === "POST")).toBe(true),
      );
      const post = h.authFetch.mock.calls.find((c) => c[1]?.method === "POST")!;
      expect(JSON.parse(post[1].body).tabAssignments).toEqual([{ tabId: "t1", permission: "read" }]);
    });

    it("raises the permission on the chosen tab and leaves the others alone", async () => {
      await openCreateForm();
      const [first, second] = screen.getAllByRole("checkbox");
      fireEvent.click(first!);
      fireEvent.click(second!);
      // Promote only the second tab.
      fireEvent.click(screen.getAllByTitle("Write")[1]!);
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() =>
        expect(h.authFetch.mock.calls.some((c) => c[1]?.method === "POST")).toBe(true),
      );
      const post = h.authFetch.mock.calls.find((c) => c[1]?.method === "POST")!;
      expect(JSON.parse(post[1].body).tabAssignments).toEqual([
        { tabId: "t1", permission: "read" },
        { tabId: "t2", permission: "write" },
      ]);
    });

    it("removes the assignment entirely when a tab is deselected", async () => {
      await openCreateForm();
      const checkbox = screen.getAllByRole("checkbox")[0]!;
      fireEvent.click(checkbox);
      fireEvent.click(checkbox);
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() =>
        expect(h.authFetch.mock.calls.some((c) => c[1]?.method === "POST")).toBe(true),
      );
      const post = h.authFetch.mock.calls.find((c) => c[1]?.method === "POST")!;
      expect(JSON.parse(post[1].body).tabAssignments).toEqual([]);
    });

    it("marks a system tab as such so an admin knows what they are granting", async () => {
      await openCreateForm();
      expect(screen.getByText("(system)")).toBeInTheDocument();
    });
  });

  describe("reading a group's assignments back", () => {
    it("names an assignment whose tab no longer exists rather than rendering a bare id", async () => {
      h.groups = [
        { ...sampleGroup, tabAssignments: [{ tabId: "deleted-tab", permission: "read" }] },
      ];
      render(<GroupManagementPage />);
      await screen.findByText("Family");

      // The assignment outlived the tab. Showing the raw id would look like data
      // corruption; naming it as unknown says what actually happened.
      expect(screen.getByText("Unknown Tab")).toBeInTheDocument();
    });

    it("says when a group reaches no tabs at all", async () => {
      h.groups = [{ ...sampleGroup, tabAssignments: [] }];
      render(<GroupManagementPage />);
      await screen.findByText("Family");

      expect(screen.getByText("No tabs assigned")).toBeInTheDocument();
    });

    it("counts members in the plural on the group card", async () => {
      h.groups = [sampleGroup];
      h.users = [
        { id: "u1", username: "alice", role: "user", groupId: "g1" },
        { id: "u2", username: "bob", role: "user", groupId: "g1" },
      ];
      render(<GroupManagementPage />);
      expect(await screen.findByText("2 users")).toBeInTheDocument();
    });

    it("keeps working when the user list cannot be fetched", async () => {
      h.groups = [sampleGroup];
      h.authFetch.mockImplementation(async (url: string) => {
        if (url.endsWith("/api/auth/users")) return { ok: false, json: async () => ({}) };
        return { ok: true, json: async () => h.groups };
      });

      render(<GroupManagementPage />);

      // Membership is supporting detail; the groups themselves still render, and
      // the page claims no membership rather than claiming zero members.
      expect(await screen.findByText("Family")).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("user");
    });

    it("keeps working when the user request throws", async () => {
      h.groups = [sampleGroup];
      h.authFetch.mockImplementation(async (url: string) => {
        if (url.endsWith("/api/auth/users")) throw new Error("network down");
        return { ok: true, json: async () => h.groups };
      });

      render(<GroupManagementPage />);
      expect(await screen.findByText("Family")).toBeInTheDocument();
    });

    it("reports a groups request that throws rather than showing an empty list", async () => {
      h.authFetch.mockImplementation(async (url: string) => {
        if (url.endsWith("/api/auth/groups")) throw new Error("gateway timeout");
        return { ok: true, json: async () => [] };
      });

      render(<GroupManagementPage />);
      expect(await screen.findByText("gateway timeout")).toBeInTheDocument();
    });
  });
});
