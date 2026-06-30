// frontend/src/store/permissions-store.ts — Zustand store for user permissions and accessible tabs

import { create } from "zustand";
import { useAuthStore } from "./auth-store";
import { API_URL } from "../lib/env";

export type PermissionLevel = "read" | "interact" | "write";

export interface TabPermission {
  tabId: string;
  permission: PermissionLevel;
}

interface PermissionsState {
  accessibleTabs: TabPermission[];
  loaded: boolean;

  /** Fetch accessible tabs from /api/auth/me */
  fetchPermissions: () => Promise<void>;

  /** Clear permissions (on logout) */
  clear: () => void;

  /** Check if user has access to a specific tab */
  hasTabAccess: (tabId: string) => boolean;

  /** Get the permission level for a specific tab (null if no access) */
  getTabPermission: (tabId: string) => PermissionLevel | null;

  /** Check if user can perform an action at the given permission level on a tab */
  canPerform: (tabId: string, required: PermissionLevel) => boolean;
}

const PERMISSION_HIERARCHY: Record<PermissionLevel, number> = {
  read: 1,
  interact: 2,
  write: 3,
};

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  accessibleTabs: [],
  loaded: false,

  fetchPermissions: async () => {
    const { accessToken, user } = useAuthStore.getState();

    // Admin users have full access — no need to fetch tab restrictions
    if (user?.role === "admin") {
      set({ accessibleTabs: [], loaded: true });
      return;
    }

    if (!accessToken) {
      set({ accessibleTabs: [], loaded: true });
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: "include",
      });

      if (!res.ok) {
        set({ accessibleTabs: [], loaded: true });
        return;
      }

      const data = await res.json();
      const tabs: TabPermission[] = data.accessibleTabs || [];
      set({ accessibleTabs: tabs, loaded: true });
    } catch {
      set({ accessibleTabs: [], loaded: true });
    }
  },

  clear: () => {
    set({ accessibleTabs: [], loaded: false });
  },

  hasTabAccess: (tabId: string) => {
    const { user } = useAuthStore.getState();
    if (user?.role === "admin") return true;

    const { accessibleTabs } = get();
    return accessibleTabs.some((t) => t.tabId === tabId);
  },

  getTabPermission: (tabId: string) => {
    const { user } = useAuthStore.getState();
    if (user?.role === "admin") return "write";

    const { accessibleTabs } = get();
    const entry = accessibleTabs.find((t) => t.tabId === tabId);
    return entry?.permission ?? null;
  },

  canPerform: (tabId: string, required: PermissionLevel) => {
    const { user } = useAuthStore.getState();
    if (user?.role === "admin") return true;

    const { accessibleTabs } = get();
    const entry = accessibleTabs.find((t) => t.tabId === tabId);
    if (!entry) return false;

    return PERMISSION_HIERARCHY[entry.permission] >= PERMISSION_HIERARCHY[required];
  },
}));
