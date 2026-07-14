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

  // Wait for the page to settle — either login form or already authenticated
  await page.waitForLoadState("networkidle");

  // If already on dashboard (session restored from cookie), we're done
  if (page.url().includes("/dashboard")) return;

  // If no login form visible, the app might still be loading or already authenticated
  const loginVisible = await page.getByText("Sign in to your dashboard").isVisible({ timeout: 5000 }).catch(() => false);
  if (!loginVisible) {
    // Wait a moment for React router to settle
    await page.waitForTimeout(1000);
    if (page.url().includes("/dashboard")) return;
    // Try navigating directly
    await page.goto("/dashboard");
    return;
  }

  await page.locator("#login-username").fill(ADMIN.username);
  await page.locator("#login-password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign In" }).click();

  // Wait for navigation away from login — could be /dashboard or just /
  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 15000 }).catch(() => {});
  // Give React router time to redirect / → /dashboard
  await page.waitForTimeout(500);
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
 * Caches the token for the duration of the test run to avoid rate limiting.
 */
let _cachedToken: string | null = null;

export async function getAdminToken(request: APIRequestContext): Promise<string> {
  if (_cachedToken) return _cachedToken;

  // Try login first (admin already exists)
  const loginRes = await request.post(`${API_URL}/api/auth/login`, {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  if (loginRes.ok()) {
    const body = (await loginRes.json()) as { accessToken: string };
    _cachedToken = body.accessToken;
    return _cachedToken;
  }

  // If login fails, maybe we need to set up first
  const setupRes = await request.post(`${API_URL}/api/auth/setup`, {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  if (setupRes.ok()) {
    const body = (await setupRes.json()) as { accessToken: string };
    _cachedToken = body.accessToken;
    return _cachedToken;
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
