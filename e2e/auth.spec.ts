// e2e/auth.spec.ts — Authentication journeys against the live backend.
//
// Exercises the real auth wiring end-to-end — the public /api/auth/status gate,
// admin creation, the httpOnly refresh cookie, bearer token, and the sidebar
// logout — none of which the jsdom unit tests can cover.
//
// State handling: every test is self-sufficient (each gets its own browser
// context, and `ensureAdmin` sets up or logs in as needed), so they don't rely
// on each other's ordering. The one exception is the first-run test below,
// which is the suite's ONLY hard dependency on a fresh DB — it skips cleanly
// when an admin already exists. On a fresh CI DB it runs first (Playwright
// orders spec files alphabetically, and "auth" precedes "custom-tab"), so it
// genuinely exercises setup before anything else creates the admin.

import { test, expect } from "@playwright/test";
import { ADMIN } from "./constants";
import { createAdmin, ensureAdmin, isFreshBackend } from "./helpers";

test.describe("authentication", () => {
  test("first-run setup creates the admin and lands on the dashboard", async ({ page }) => {
    test.skip(
      !(await isFreshBackend(page)),
      "Backend already set up — the first-run path only runs against a fresh DB",
    );

    await createAdmin(page);

    // With no devices yet, the WelcomeScreen is the landing content, and the
    // sidebar reflects the signed-in admin. Allow extra time on first load —
    // the backend has just initialised and the frontend is hydrating cold.
    await expect(
      page.getByRole("heading", { name: "Welcome to Aeolus" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("(admin)")).toBeVisible();
  });

  test("admin reaches the dashboard and can log out", async ({ page }) => {
    await ensureAdmin(page);

    // Dashboard shows either WelcomeScreen or SystemPage depending on device state
    const hasContent = await page.getByRole("heading", { name: "Welcome to Aeolus" }).or(
      page.getByRole("heading", { name: "System" }),
    ).isVisible({ timeout: 10000 });
    expect(hasContent).toBe(true);

    // Log out via the sidebar control (title="Sign out") → back to login.
    await page.getByTitle("Sign out").click();
    await expect(page.getByText("Sign in to your dashboard")).toBeVisible();
  });

  test("wrong password is rejected", async ({ page }) => {
    // Guarantee an admin exists, then get to a clean login screen.
    await ensureAdmin(page);
    await page.getByTitle("Sign out").click();
    await expect(page.getByText("Sign in to your dashboard")).toBeVisible();

    await page.locator("#login-username").fill(ADMIN.username);
    await page.locator("#login-password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign In" }).click();

    // Error surfaces and we stay on the login card.
    await expect(page.getByText("Sign in to your dashboard")).toBeVisible();
    await expect(page.locator("#login-username")).toBeVisible();
  });
});
