// e2e/auth.spec.ts — Authentication journeys against the live backend.
//
// Exercises the real auth wiring end-to-end — the login form, the httpOnly refresh
// cookie, the bearer token and the sidebar logout — none of which the jsdom unit
// tests can cover.
//
// State handling: this file deliberately opts OUT of the shared signed-in state that
// auth.setup.ts saves and the rest of the suite reuses. Logging out revokes the
// presented refresh token, and every reused context carries the same token, so a
// test that signs out would invalidate the saved state for everything that ran after
// it. Signing in and out is this file's actual subject, so it owns its own sessions.
//
// That costs two logins against the 5-per-minute limit, which is the point: the rest
// of the suite spends none, so the budget is there for the tests that need it.
//
// The first-run setup journey lives in auth.setup.ts, which owns it because it has
// to reach a pristine DB before anything else creates the admin.

import { test, expect } from "@playwright/test";
import { ADMIN } from "./constants";
import { login } from "./helpers";

// A genuinely unauthenticated context, not the saved admin state.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("authentication", () => {
  test("admin reaches the dashboard and can log out", async ({ page }) => {
    await login(page);

    // /dashboard renders SystemPage unconditionally (86624c8 removed the
    // WelcomeScreen this assertion also used to allow for).
    await expect(page.getByRole("heading", { name: "System" })).toBeVisible({ timeout: 10_000 });

    // Log out via the sidebar control (title="Sign out") → back to login.
    await page.getByTitle("Sign out").click();
    await expect(page.getByText("Sign in to your dashboard")).toBeVisible();
  });

  test("wrong password is rejected", async ({ page }) => {
    // No session to shed: this context starts unauthenticated, so the login card is
    // the landing surface.
    await page.goto("/");
    await expect(page.getByText("Sign in to your dashboard")).toBeVisible();

    await page.locator("#login-username").fill(ADMIN.username);
    await page.locator("#login-password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign In" }).click();

    // Error surfaces and we stay on the login card.
    await expect(page.getByText("Sign in to your dashboard")).toBeVisible();
    await expect(page.locator("#login-username")).toBeVisible();
  });
});
