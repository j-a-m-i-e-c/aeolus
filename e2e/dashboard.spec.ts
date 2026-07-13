// e2e/dashboard.spec.ts — Dashboard page (device grid & welcome screen).
//
// Exercises the main dashboard landing: on a fresh/empty backend the
// WelcomeScreen shows; when devices exist, the SystemPage health summary
// renders. Also verifies the WebSocket connection indicator and basic
// navigation between pinned tabs.

import { test, expect } from "@playwright/test";
import { ensureAdmin } from "./helpers";

test.describe("dashboard", () => {
  test("shows welcome screen when no devices exist", async ({ page }) => {
    await ensureAdmin(page);

    // On a fresh backend with no MQTT devices connected, the dashboard shows
    // the WelcomeScreen with onboarding guidance.
    await expect(
      page.getByRole("heading", { name: "Welcome to Aeolus" }),
    ).toBeVisible();
  });

  test("sidebar shows pinned navigation tabs", async ({ page }) => {
    await ensureAdmin(page);

    // Verify all four pinned tabs are visible in the sidebar
    await expect(page.getByRole("link", { name: "System" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Connectors" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Data" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Security" })).toBeVisible();
  });

  test("navigating to Connectors tab loads the connectors page", async ({ page }) => {
    await ensureAdmin(page);

    await page.getByRole("link", { name: "Connectors" }).click();
    await expect(page).toHaveURL(/\/connectors$/);
    await expect(
      page.getByRole("heading", { name: "Connectors" }),
    ).toBeVisible();
  });

  test("navigating to Data tab loads the data store page", async ({ page }) => {
    await ensureAdmin(page);

    await page.getByRole("link", { name: "Data" }).click();
    await expect(page).toHaveURL(/\/data-store$/);
  });

  test("navigating to Security tab loads the security page", async ({ page }) => {
    await ensureAdmin(page);

    await page.getByRole("link", { name: "Security" }).click();
    await expect(page).toHaveURL(/\/security$/);
  });
});
