// frontend/src/store/auth-store.ts — Zustand store for authentication state

import { create } from "zustand";
import { API_URL, PUBLIC_DEMO } from "../lib/env";

export interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "user";
  groupId: string | null;
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  needsSetup: boolean;
  loading: boolean;

  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  setup: (username: string, password: string) => Promise<void>;
  checkSetupNeeded: () => Promise<void>;
  /** Obtain (or renew) an anonymous public-demo session. Only used when PUBLIC_DEMO. */
  initDemoSession: () => Promise<boolean>;
}

/** Interval ID for silent refresh timer */
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Duration before token expiry to trigger refresh (13 minutes in ms) */
const REFRESH_INTERVAL_MS = 13 * 60 * 1000;

function startRefreshTimer(refresh: () => Promise<boolean>) {
  stopRefreshTimer();
  refreshTimer = setInterval(async () => {
    const success = await refresh();
    if (!success) {
      stopRefreshTimer();
    }
  }, REFRESH_INTERVAL_MS);
}

function stopRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/** Decode JWT payload without verification (client-side only) */
function decodeTokenPayload(token: string): AuthUser | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return {
      id: payload.userId,
      username: payload.username,
      role: payload.role,
      groupId: payload.groupId ?? null,
    };
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  needsSetup: false,
  loading: true,

  login: async (username: string, password: string) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Login failed" }));
      throw new Error(body.error || "Login failed");
    }

    const data = await res.json();
    const user = decodeTokenPayload(data.accessToken);

    set({
      accessToken: data.accessToken,
      user,
      isAuthenticated: true,
      needsSetup: false,
    });

    startRefreshTimer(get().refresh);
  },

  logout: async () => {
    const { accessToken } = get();
    stopRefreshTimer();

    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        credentials: "include",
      });
    } catch {
      // Logout best-effort — clear state regardless
    }

    set({
      accessToken: null,
      user: null,
      isAuthenticated: false,
    });
  },

  refresh: async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!res.ok) {
        // Refresh failed — clear auth state and redirect to login
        stopRefreshTimer();
        set({
          accessToken: null,
          user: null,
          isAuthenticated: false,
        });
        return false;
      }

      const data = await res.json();
      const user = decodeTokenPayload(data.accessToken);

      set({
        accessToken: data.accessToken,
        user,
        isAuthenticated: true,
      });

      return true;
    } catch {
      stopRefreshTimer();
      set({
        accessToken: null,
        user: null,
        isAuthenticated: false,
      });
      return false;
    }
  },

  setup: async (username: string, password: string) => {
    const res = await fetch(`${API_URL}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Setup failed" }));
      throw new Error(body.error || "Setup failed");
    }

    const data = await res.json();
    const user = decodeTokenPayload(data.accessToken);

    set({
      accessToken: data.accessToken,
      user,
      isAuthenticated: true,
      needsSetup: false,
    });

    startRefreshTimer(get().refresh);
  },

  initDemoSession: async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/demo-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        set({ isAuthenticated: false, loading: false });
        return false;
      }
      const data = await res.json();
      const user = decodeTokenPayload(data.accessToken);
      set({
        accessToken: data.accessToken,
        user,
        isAuthenticated: true,
        needsSetup: false,
        loading: false,
      });
      // Demo tokens carry no refresh; re-request a fresh session on the timer so
      // it never expires mid-visit (Req 2.7, 10.4).
      startRefreshTimer(get().initDemoSession);
      return true;
    } catch {
      set({ isAuthenticated: false, loading: false });
      return false;
    }
  },

  checkSetupNeeded: async () => {
    // Public demo: skip the login/refresh/setup flow entirely and obtain an
    // anonymous demo session on load (Req 10.1).
    if (PUBLIC_DEMO) {
      await get().initDemoSession();
      return;
    }
    try {
      // Try to refresh first — if we have a valid refresh cookie, we're authenticated
      const refreshRes = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (refreshRes.ok) {
        const data = await refreshRes.json();
        const user = decodeTokenPayload(data.accessToken);
        set({
          accessToken: data.accessToken,
          user,
          isAuthenticated: true,
          needsSetup: false,
          loading: false,
        });
        startRefreshTimer(get().refresh);
        return;
      }

      // Refresh failed — check if setup is needed via public status endpoint
      const statusRes = await fetch(`${API_URL}/api/auth/status`, {
        headers: { "Content-Type": "application/json" },
      });

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.needsSetup) {
          set({ needsSetup: true, isAuthenticated: false, loading: false });
          return;
        }
      }

      // Server is set up but user is not authenticated — show login
      set({ needsSetup: false, isAuthenticated: false, loading: false });
    } catch {
      // Network error — assume not reachable
      set({ needsSetup: false, isAuthenticated: false, loading: false });
    }
  },
}));
