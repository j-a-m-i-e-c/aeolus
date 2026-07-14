// e2e/dashboard.spec.ts — Dashboard renders after login.

import { test, expect } from "@playwright/test";
import { ensureAdmin } from "./helpers";

test.describe("dashboard", () => {
  test("renders content after login", async ({ page }) => {
    await ensureAdmin(page);

    // Dashboard shows either WelcomeScreen (fresh DB) or SystemPage (devices exist)
    const content = page
      .getByRole("heading", { name: "Welcome to Aeolus" })
      .or(page.getByRole("heading", { name: "System" }));
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});
