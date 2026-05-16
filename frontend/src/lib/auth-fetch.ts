// frontend/src/lib/auth-fetch.ts — Authenticated fetch wrapper that injects Bearer token

import { useAuthStore } from "../store/auth-store";

/**
 * Wrapper around fetch that automatically adds the Authorization header
 * with the current access token from the auth store.
 * Falls back to a regular fetch if no token is available.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { accessToken } = useAuthStore.getState();

  const headers = new Headers(init?.headers);

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  // Ensure Content-Type is set if not already provided
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });
}
