// e2e/automations.spec.ts — Automation rules CRUD.
//
// Exercises creating a form-based automation rule, toggling it, and deleting it.

import { test, expect } from "@playwright/test";
import { ensureAdmin, getAdminToken, authedApi } from "./helpers";
import { API_URL } from "./constants";

test.describe("automations", () => {
  test("can create a form-based automation rule via API and see it listed", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const ruleName = `E2E Rule ${Date.now()}`;
    const createRes = await api.post(`${API_URL}/api/automations`, {
      name: ruleName,
      triggerTopic: "test/e2e/sensor",
      ruleType: "form",
      actionType: "log",
      actionTarget: "test/e2e/sensor",
      actionParams: { message: "E2E test fired" },
    });
    expect(createRes.ok()).toBe(true);
    const { id: ruleId } = (await createRes.json()) as { id: string };

    // Verify the rule appears in the list
    const listRes = await api.get(`${API_URL}/api/automations`);
    expect(listRes.ok()).toBe(true);
    const rules = (await listRes.json()) as Array<{ id: string; name: string }>;
    expect(rules.some((r) => r.id === ruleId)).toBe(true);

    // Clean up
    await api.delete(`${API_URL}/api/automations/${ruleId}`);
  });

  test("can toggle an automation rule on and off", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const createRes = await api.post(`${API_URL}/api/automations`, {
      name: `Toggle Test ${Date.now()}`,
      triggerTopic: "test/toggle",
      ruleType: "form",
      actionType: "log",
      actionTarget: "test/toggle",
      actionParams: { message: "toggled" },
    });
    const { id: ruleId } = (await createRes.json()) as { id: string };

    // Disable the rule
    const disableRes = await api.patch(`${API_URL}/api/automations/${ruleId}/toggle`, { enabled: false });
    expect(disableRes.ok()).toBe(true);
    const disableBody = (await disableRes.json()) as { success: boolean; enabled: boolean };
    expect(disableBody.enabled).toBe(false);

    // Re-enable the rule
    const enableRes = await api.patch(`${API_URL}/api/automations/${ruleId}/toggle`, { enabled: true });
    expect(enableRes.ok()).toBe(true);
    const enableBody = (await enableRes.json()) as { success: boolean; enabled: boolean };
    expect(enableBody.enabled).toBe(true);

    // Clean up
    await api.delete(`${API_URL}/api/automations/${ruleId}`);
  });

  test("can delete an automation rule", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const createRes = await api.post(`${API_URL}/api/automations`, {
      name: `Delete Test ${Date.now()}`,
      triggerTopic: "test/delete",
      ruleType: "form",
      actionType: "log",
      actionTarget: "test/delete",
      actionParams: { message: "delete me" },
    });
    const { id: ruleId } = (await createRes.json()) as { id: string };

    const deleteRes = await api.delete(`${API_URL}/api/automations/${ruleId}`);
    expect(deleteRes.ok()).toBe(true);

    // Verify it's gone
    const listRes = await api.get(`${API_URL}/api/automations`);
    const rules = (await listRes.json()) as Array<{ id: string }>;
    expect(rules.some((r) => r.id === ruleId)).toBe(false);
  });

  test("can manually fire an automation rule", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const createRes = await api.post(`${API_URL}/api/automations`, {
      name: `Fire Test ${Date.now()}`,
      triggerTopic: "test/fire",
      ruleType: "form",
      actionType: "log",
      actionTarget: "test/fire",
      actionParams: { message: "manual fire" },
    });
    const { id: ruleId } = (await createRes.json()) as { id: string };

    const fireRes = await api.post(`${API_URL}/api/automations/${ruleId}/fire`);
    expect(fireRes.ok()).toBe(true);
    const fireBody = (await fireRes.json()) as { success: boolean; ruleId: string };
    expect(fireBody.success).toBe(true);

    // Verify execution appears in history
    const historyRes = await api.get(`${API_URL}/api/automations/history?ruleId=${ruleId}`);
    expect(historyRes.ok()).toBe(true);
    const history = (await historyRes.json()) as Array<{ ruleId: string }>;
    expect(history.length).toBeGreaterThan(0);

    // Clean up
    await api.delete(`${API_URL}/api/automations/${ruleId}`);
  });

  test("can create a script-based automation rule", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const scriptSource = `
      export default function handler(context: EventContext): void {
        log("Script rule executed from e2e test");
      }
    `;

    const createRes = await api.post(`${API_URL}/api/automations`, {
      name: `Script Rule ${Date.now()}`,
      triggerTopic: "test/script",
      ruleType: "script",
      scriptSource,
    });
    expect(createRes.ok()).toBe(true);
    const { id: ruleId } = (await createRes.json()) as { id: string };

    // Verify it's listed as a script rule
    const listRes = await api.get(`${API_URL}/api/automations`);
    const rules = (await listRes.json()) as Array<{ id: string; ruleType: string }>;
    const created = rules.find((r) => r.id === ruleId);
    expect(created?.ruleType).toBe("script");

    // Clean up
    await api.delete(`${API_URL}/api/automations/${ruleId}`);
  });
});
