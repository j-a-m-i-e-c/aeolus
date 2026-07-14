// e2e/helpers.ts — Shared actions for the e2e specs.
//
// The suite is designed to survive BOTH a fresh backend (first-run setup) and
// an already-set-up one (login). `ensureAdmin` hides that branch so every spec
// except the dedicated first-run test can run regardless of DB state — which is
// what makes local iteration (`make e2e`) and future seeded specs pleasant.

import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { ADMIN, API_URL } from "./constants";

/** True when the backend has no admin yet (first-run). */
export async function isFreshBackend(page: Page): Promise<boolean> {
  const res = await page.request.get(`${API_URL}/api/auth/status`);
  if (!res.ok()) return false;
  const body = (await res.json()) as { needsSetup?: boolean };
  return body.needsSetup === true;
}

/** Run the first-run setup flow: create the admin and land on the dashboard. */
export async function createAdmin(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Create Admin Account" }),
  ).toBeVisible();
  await page.locator("#setup-username").fill(ADMIN.username);
  await page.locator("#setup-password").fill(ADMIN.password);
  await page.locator("#setup-confirm-password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Log in as the admin and land on the dashboard (assumes an admin exists). */
export async function login(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByText("Sign in to your dashboard")).toBeVisible();
  await page.locator("#login-username").fill(ADMIN.username);
  await page.locator("#login-password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * Get to an authenticated dashboard regardless of DB state: create the admin on
 * a fresh backend, otherwise log in with the same credentials.
 */
export async function ensureAdmin(page: Page): Promise<void> {
  if (await isFreshBackend(page)) {
    await createAdmin(page);
  } else {
    await login(page);
  }
}

/**
 * Get a Bearer token for the admin account via the login API.
 * Use this token in `page.request` headers for authenticated API calls.
 */
export async function getAdminToken(request: APIRequestContext): Promise<string> {
  // Try login first (admin already exists)
  const loginRes = await request.post(`${API_URL}/api/auth/login`, {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  if (loginRes.ok()) {
    const body = (await loginRes.json()) as { accessToken: string };
    return body.accessToken;
  }

  // If login fails, maybe we need to set up first
  const setupRes = await request.post(`${API_URL}/api/auth/setup`, {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  if (setupRes.ok()) {
    const body = (await setupRes.json()) as { accessToken: string };
    return body.accessToken;
  }

  throw new Error(`Failed to get admin token: login=${loginRes.status()}, setup=${setupRes.status()}`);
}

/**
 * Create an authenticated API helper that includes the Bearer token.
 * Call after ensureAdmin() to get a token-bearing request wrapper.
 */
export function authedApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  return {
    get: (url: string) => request.get(url, { headers }),
    post: (url: string, data?: unknown) => request.post(url, { headers, data }),
    put: (url: string, data?: unknown) => request.put(url, { headers, data }),
    patch: (url: string, data?: unknown) => request.patch(url, { headers, data }),
    delete: (url: string) => request.delete(url, { headers }),
  };
}
