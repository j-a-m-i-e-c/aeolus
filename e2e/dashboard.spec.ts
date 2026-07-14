// e2e/dashboard.spec.ts — Dashboard navigation and welcome screen.

import { test, expect } from "@playwright/test";
import { ensureAdmin } from "./helpers";

test.describe("dashboard", () => {
  test("shows welcome screen when no devices exist", async ({ page }) => {
    await ensureAdmin(page);
    await expect(
      page.getByRole("heading", { name: "Welcome to Aeolus" }),
    ).toBeVisible();
  });

  test("sidebar shows pinned navigation tabs", async ({ page }) => {
    await ensureAdmin(page);
    await expect(page.getByRole("link", { name: "System" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Connectors" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Data" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Security" })).toBeVisible();
  });

  test("navigating to Connectors tab loads the connectors page", async ({ page }) => {
    await ensureAdmin(page);
    await page.getByRole("link", { name: "Connectors" }).click();
    await expect(page).toHaveURL(/\/connectors$/);
    await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
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
