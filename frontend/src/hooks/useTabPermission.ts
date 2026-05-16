// frontend/src/hooks/useTabPermission.ts — Hook for permission-based UI control

import { useAuthStore } from "../store/auth-store";
import { usePermissionsStore, type PermissionLevel } from "../store/permissions-store";

export interface TabPermissionInfo {
  /** The permission level the user has on this tab (null = no access) */
  permission: PermissionLevel | null;
  /** Whether the user is an admin (full access regardless of tab assignment) */
  isAdmin: boolean;
  /** Whether the user can view the tab content (read, interact, or write) */
  canRead: boolean;
  /** Whether the user can interact with device controls (interact or write) */
  canInteract: boolean;
  /** Whether the user can edit (automation code, pane management, etc.) */
  canWrite: boolean;
}

/**
 * Returns permission info for the given tab.
 * Admin users always get full access.
 * Non-admin users get access based on their group's tab assignment.
 */
export function useTabPermission(tabId: string | null): TabPermissionInfo {
  const user = useAuthStore((s) => s.user);
  const getTabPermission = usePermissionsStore((s) => s.getTabPermission);

  const isAdmin = user?.role === "admin";

  if (isAdmin) {
    return {
      permission: "write",
      isAdmin: true,
      canRead: true,
      canInteract: true,
      canWrite: true,
    };
  }

  if (!tabId) {
    return {
      permission: null,
      isAdmin: false,
      canRead: false,
      canInteract: false,
      canWrite: false,
    };
  }

  const permission = getTabPermission(tabId);

  return {
    permission,
    isAdmin: false,
    canRead: permission !== null,
    canInteract: permission === "interact" || permission === "write",
    canWrite: permission === "write",
  };
}
