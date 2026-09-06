// e2e/helpers.ts — Shared actions for the e2e specs.

import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN, API_URL } from "./constants";

/**
 * A cached admin bearer token for API-level setup.
 *
 * POST /api/auth/login is rate limited to 5 requests per minute per IP
 * (auth.routes.ts loginRateLimiter) — a deliberate security control, not a test
 * obstacle. Specs used to open a fresh API login for every seeding step, which on
 * a fast machine pushed the run over that cap and produced 429s that surface as
 * unrelated-looking UI failures several tests later. One token per run keeps the
 * control intact and stops the suite lying about what broke.
 *
 * Safe to cache: workers is 1 (playwright.config.ts) and the access token
 * outlives a suite run.
 */
let cachedAdminToken: string | undefined;

/** Bearer token for the admin, authenticating at most once per run. */
export async function adminToken(request: APIRequestContext): Promise<string> {
  if (cachedAdminToken) return cachedAdminToken;
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  expect(res.ok(), `admin login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  cachedAdminToken = (await res.json()).accessToken as string;
  return cachedAdminToken;
}

/** Authorization header for the admin, reusing the cached token. */
export async function adminAuth(request: APIRequestContext): Promise<{ Authorization: string }> {
  return { Authorization: `Bearer ${await adminToken(request)}` };
}

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
  await expect(page).toHaveURL(/\/dashboard/);
  await page.waitForLoadState("networkidle");
}

/** Log in as the admin and land on the dashboard (assumes an admin exists). */
export async function login(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Already on dashboard (session restored)
  if (page.url().includes("/dashboard")) return;

  const loginVisible = await page.getByText("Sign in to your dashboard").isVisible({ timeout: 5000 }).catch(() => false);
  if (!loginVisible) {
    await page.waitForTimeout(1000);
    return;
  }

  await page.locator("#login-username").fill(ADMIN.username);
  await page.locator("#login-password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Get to an authenticated dashboard regardless of DB state.
 */
export async function ensureAdmin(page: Page): Promise<void> {
  if (await isFreshBackend(page)) {
    await createAdmin(page);
  } else {
    await login(page);
  }
}
