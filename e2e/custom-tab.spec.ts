// e2e/custom-tab.spec.ts — Create a custom dashboard tab and confirm it renders.
//
// Exercises the admin-only "Add Tab" flow in the sidebar, then verifies the new
// tab is navigable and its (empty) TabLayout renders the authoring controls.
// Self-sufficient: `ensureAdmin` sets up or logs in depending on DB state.

import { test, expect } from "@playwright/test";
import { ensureAdmin } from "./helpers";

test("admin can create a custom tab and it renders", async ({ page }) => {
  await ensureAdmin(page);

  const tabName = `E2E Room ${Date.now()}`;

  // Open the inline "Add Tab" form in the sidebar (admin only).
  await page.getByRole("button", { name: "Add Tab" }).click();
  await page.getByPlaceholder("Tab name…").fill(tabName);
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // Adding a tab navigates straight to it (/tab/<slug>).
  await expect(page).toHaveURL(/\/tab\//);

  // The new tab appears in the sidebar nav…
  await expect(page.getByText(tabName)).toBeVisible();

  // …and its empty TabLayout shows the admin authoring controls.
  await expect(
    page.getByRole("button", { name: "Browse Panes" }),
  ).toBeVisible();
  // "New Automation", not "New Automation Pane" — ed8aa23 shortened the label when
  // panes and automations were unified for the public-demo admin surfaces.
  await expect(
    page.getByRole("button", { name: "New Automation" }),
  ).toBeVisible();
});
