// frontend/src/hooks/useTabPermission.test.ts — Permission hook: admin, user levels, no tab

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockUser = { current: { role: "admin" as "admin" | "user", id: "u1", username: "test", groupId: null } as { role: "admin" | "user"; id: string; username: string; groupId: string | null } | null };
const permissionsState = { accessibleTabs: [] as Array<{ tabId: string; permission: "read" | "interact" | "write" }>, loaded: true };

vi.mock("../store/auth-store", () => ({
  useAuthStore: (sel: (s: { user: typeof mockUser.current }) => unknown) => sel({ user: mockUser.current }),
}));
vi.mock("../store/permissions-store", () => ({
  usePermissionsStore: (sel: (s: typeof permissionsState) => unknown) => sel(permissionsState),
}));

import { useTabPermission } from "./useTabPermission";

describe("useTabPermission", () => {
  beforeEach(() => {
    permissionsState.accessibleTabs = [];
    permissionsState.loaded = true;
  });
  it("gives full access to admin regardless of tab", () => {
    mockUser.current = { role: "admin", id: "u1", username: "admin", groupId: null };
    const { result } = renderHook(() => useTabPermission("tab-1"));
    expect(result.current).toEqual({
      permission: "write",
      isAdmin: true,
      canRead: true,
      canInteract: true,
      canWrite: true,
    });
  });

  it("returns no access when tabId is null for non-admin", () => {
    mockUser.current = { role: "user", id: "u2", username: "bob", groupId: "g1" };
    const { result } = renderHook(() => useTabPermission(null));
    expect(result.current).toEqual({
      permission: null,
      isAdmin: false,
      canRead: false,
      canInteract: false,
      canWrite: false,
    });
  });

  it("returns read-only access for 'read' permission", () => {
    mockUser.current = { role: "user", id: "u2", username: "bob", groupId: "g1" };
    permissionsState.accessibleTabs = [{ tabId: "tab-2", permission: "read" }];
    const { result } = renderHook(() => useTabPermission("tab-2"));
    expect(result.current).toEqual({
      permission: "read",
      isAdmin: false,
      canRead: true,
      canInteract: false,
      canWrite: false,
    });
  });

  it("returns interact access for 'interact' permission", () => {
    mockUser.current = { role: "user", id: "u2", username: "bob", groupId: "g1" };
    permissionsState.accessibleTabs = [{ tabId: "tab-3", permission: "interact" }];
    const { result } = renderHook(() => useTabPermission("tab-3"));
    expect(result.current).toEqual({
      permission: "interact",
      isAdmin: false,
      canRead: true,
      canInteract: true,
      canWrite: false,
    });
  });

  it("returns full write access for 'write' permission", () => {
    mockUser.current = { role: "user", id: "u2", username: "bob", groupId: "g1" };
    permissionsState.accessibleTabs = [{ tabId: "tab-4", permission: "write" }];
    const { result } = renderHook(() => useTabPermission("tab-4"));
    expect(result.current).toEqual({
      permission: "write",
      isAdmin: false,
      canRead: true,
      canInteract: true,
      canWrite: true,
    });
  });

  it("returns no access when permission is null for non-admin", () => {
    mockUser.current = { role: "user", id: "u2", username: "bob", groupId: "g1" };
    permissionsState.accessibleTabs = [];
    const { result } = renderHook(() => useTabPermission("tab-5"));
    expect(result.current).toEqual({
      permission: null,
      isAdmin: false,
      canRead: false,
      canInteract: false,
      canWrite: false,
    });
  });
});
