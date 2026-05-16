// frontend/src/lib/auth-fetch.ts — Authenticated fetch wrapper that injects Bearer token

import { useAuthStore } from "../store/auth-store";

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

/**
 * Wrapper around fetch that automatically adds the Authorization header
 * with the current access token from the auth store.
 * On 401 responses, automatically attempts a token refresh and retries once.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { accessToken } = useAuthStore.getState();

  const headers = new Headers(init?.headers);

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });

  // If 401 and we have a refresh mechanism, try to refresh and retry once
  if (response.status === 401 && accessToken) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      // Retry with the new token
      const { accessToken: newToken } = useAuthStore.getState();
      const retryHeaders = new Headers(init?.headers);
      if (newToken) {
        retryHeaders.set("Authorization", `Bearer ${newToken}`);
      }
      if (!retryHeaders.has("Content-Type")) {
        retryHeaders.set("Content-Type", "application/json");
      }
      return fetch(input, {
        ...init,
        headers: retryHeaders,
        credentials: "include",
      });
    }
  }

  return response;
}

/**
 * Attempt to refresh the access token. Deduplicates concurrent refresh attempts.
 */
async function attemptRefresh(): Promise<boolean> {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = useAuthStore.getState().refresh();

  try {
    const result = await refreshPromise;
    return result;
  } finally {
    isRefreshing = false;
    refreshPromise = null;
  }
}
