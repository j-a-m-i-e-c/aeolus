// frontend/src/hooks/useTabPermission.test.ts — Permission hook: admin, user levels, no tab

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mockUser = { current: { role: "admin" as "admin" | "user", id: "u1", username: "test", groupId: null } as { role: "admin" | "user"; id: string; username: string; groupId: string | null } | null };
const mockGetTabPermission = vi.fn();

vi.mock("../store/auth-store", () => ({
  useAuthStore: (sel: (s: { user: typeof mockUser.current }) => unknown) => sel({ user: mockUser.current }),
}));
vi.mock("../store/permissions-store", () => ({
  usePermissionsStore: (sel: (s: { getTabPermission: typeof mockGetTabPermission }) => unknown) => sel({ getTabPermission: mockGetTabPermission }),
}));

import { useTabPermission } from "./useTabPermission";

describe("useTabPermission", () => {
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
    mockGetTabPermission.mockReturnValue("read");
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
    mockGetTabPermission.mockReturnValue("interact");
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
    mockGetTabPermission.mockReturnValue("write");
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
    mockGetTabPermission.mockReturnValue(null);
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
