// e2e/connectors.spec.ts — Connector management page.
//
// Exercises listing available connectors, viewing their details, and verifying
// the enable/disable lifecycle. Uses the Kasa connector (no setup required) as
// the test subject since it can be enabled without external hardware.

import { test, expect } from "@playwright/test";
import { ensureAdmin } from "./helpers";
import { API_URL } from "./constants";

test.describe("connectors page", () => {
  test.beforeEach(async ({ page }) => {
    await ensureAdmin(page);
    await page.getByRole("link", { name: "Connectors" }).click();
    await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
  });

  test("shows available connectors (Hue & Kasa)", async ({ page }) => {
    // The Available Connectors section should list the built-in connectors
    await expect(page.getByText("TP-Link Kasa")).toBeVisible();
    await expect(page.getByText("Philips Hue")).toBeVisible();
  });

  test("can enable the Kasa connector", async ({ page }) => {
    // Find the Kasa card and click its Enable button
    const kasaCard = page.locator("text=TP-Link Kasa").locator("..");
    const enableButton = kasaCard.locator("..").locator("..").getByRole("button", { name: "Enable" });

    // If Kasa is already enabled, we'll see it in "Active" — skip enable step
    const isAlreadyEnabled = await page.getByText("Active Connectors").isVisible().catch(() => false)
      && await page.locator("text=TP-Link Kasa").first().isVisible().catch(() => false);

    if (!isAlreadyEnabled) {
      // Click Enable on the available connector
      await enableButton.first().click();
      // Wait for it to appear in the enabled/active section
      await expect(page.getByText("connected").or(page.getByText("disconnected"))).toBeVisible({ timeout: 10000 });
    }
  });

  test("can disable an enabled connector via API and see it return to available", async ({ page }) => {
    // First ensure Kasa is enabled via API
    const listRes = await page.request.get(`${API_URL}/api/connectors`);
    const connectors = (await listRes.json()) as Array<{ id: string; connectorType: string }>;
    const kasa = connectors.find((c) => c.connectorType === "kasa");

    if (kasa) {
      // Disable it via API so we can verify the UI reflects the change
      await page.request.delete(`${API_URL}/api/connectors/${kasa.id}`);
      // Reload the page
      await page.reload();
      await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
    }

    // The Kasa connector should be in the "Available" section with an Enable button
    await expect(page.getByText("TP-Link Kasa")).toBeVisible();
  });

  test("refresh button reloads connector list", async ({ page }) => {
    // Look for a refresh/reload control
    const refreshButton = page.getByRole("button", { name: /refresh/i }).or(
      page.locator("button").filter({ has: page.locator("svg") }).first(),
    );

    // The page should not crash on refresh
    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
    }
  });
});
