// e2e/remote-connector.spec.ts — the Aeolus-to-Aeolus walkthrough (ADR-0027, Project
// APIs Phase 5) between two independent, disposable installations of the E2E stack:
// A is the `peer` service, B is the backend under test with its dashboard.
//
//  1. A publishes a read-only GET /conditions/summary endpoint.
//  2. An admin on A creates a client and grants it exactly that route.
//  3. B connects through the Aeolus Remote connector, configured in B's dashboard.
//  4. B shows fresh data whose sourceTime is the one A's payload declares.
//  5. A goes away (its container is stopped): B keeps the reading, marked stale.
//  6. A comes back: B recovers, with the same device.
//  7. The key is rotated on A, B is given the new key in its dashboard and restarted,
//     the old key is revoked, and B still reads: the new key survived the restart.
//  8. The new key is revoked: B fails closed (no data, last reading kept apart).
//  9. B's MQTT ingestion, its command history and the read-only device are unaffected.
//
// Step 7 comes before the final revocation because a revoked key cannot be rotated.
// The run handles real keys, so it records no trace, video or automatic screenshot,
// masks every key field, and enters keys without fill() (e2e/credential-safety.ts).

import { execFileSync } from "node:child_process";
import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { ADMIN, API_URL, BACKEND_CONTAINER, PEER_CONTAINER, PEER_URL, PEER_URL_FROM_BACKEND } from "./constants";
import { adminAuth } from "./helpers";
import { enterSecret, maskedScreenshot, scrubCredentials } from "./credential-safety";
import { API_KEY_PATTERN } from "../scripts/e2e/credential-scan.mjs";

test.use({ trace: "off", video: "off", screenshot: "off" });
// A missing element fails the step quickly instead of waiting out the whole test.
test.use({ actionTimeout: 20_000 });

const SLUG = `site-a-${Date.now().toString(36)}`;
const ENDPOINT = `/api/exposed/v1/${SLUG}/conditions/summary`;
const DEVICE_NAME = "Site A conditions";

const ROUTES = {
  version: 1,
  routes: [{
    id: "conditions-summary",
    method: "GET",
    path: "/conditions/summary",
    handler: "getSummary",
    description: "Latest conditions observed at site A",
    response: {
      type: "object",
      properties: { level: { type: "number" }, observedAt: { type: "number" } },
      required: ["level", "observedAt"],
      additionalProperties: false,
    },
  }],
};

const PROJECT = {
  logicEntry: "logic/index.ts",
  uiEntry: null,
  files: [
    { path: "logic/index.ts", content: "export default async function run() {}" },
    { path: "api/routes.json", content: JSON.stringify(ROUTES, null, 2) },
    {
      path: "api/handlers.ts",
      // The handler reports A's own stored state, including when it was observed.
      content: `export function getSummary() {\n  return { level: Number(state.get("level") ?? 0), observedAt: Number(state.get("observedAt") ?? 0) };\n}`,
    },
  ],
};

interface Observation {
  data: { level: number; observedAt: number } | null;
  sourceTime: number | null;
  sourceTimeBasis: string;
  fetchedAt: number | null;
  stale: boolean;
  staleReason: string | null;
  httpStatus: number | null;
  error: string | null;
  lastKnown: { data: unknown } | null;
  transport: string;
}

/** Only the stack's own containers are ever touched. */
function docker(action: "stop" | "start" | "restart", container: string): void {
  if (!container.startsWith("aeolus-e2e-")) throw new Error(`refusing to ${action} ${container}`);
  execFileSync("docker", [action, container], { stdio: "pipe", timeout: 60_000 });
}

/**
 * B's stored secrets, inspected inside its container (H2b). Prints only counts: how many
 * secret settings and Remote key fields are envelopes or plaintext, and how many API-key
 * shaped strings the database files contain. No value leaves the container.
 */
function storedSecretsOnB(): { envelopes: number; plaintext: number; keyShapedInFiles: number } {
  const script = `
    const Database = require("better-sqlite3"); const fs = require("fs");
    const db = new Database("/app/data/aeolus.db", { readonly: true });
    let envelopes = 0, plaintext = 0;
    const count = (v) => { if (typeof v !== "string" || v === "") return; if (v.startsWith("aeolus-enc:v1:")) envelopes++; else plaintext++; };
    for (const r of db.prepare("SELECT value FROM system_settings WHERE key IN ('jwt_secret','mqtt_backend_password','mqtt_shared_password')").all()) count(r.value);
    for (const r of db.prepare("SELECT config FROM connectors WHERE connector_type = 'aeolus-remote'").all()) count(JSON.parse(r.config).apiKey);
    db.close();
    let keyShapedInFiles = 0;
    for (const f of ["/app/data/aeolus.db", "/app/data/aeolus.db-wal"]) {
      if (fs.existsSync(f)) keyShapedInFiles += (fs.readFileSync(f).toString("latin1").match(/aeo_[0-9a-f]{16}_[A-Za-z0-9_-]{43}/g) || []).length;
    }
    process.stdout.write(JSON.stringify({ envelopes, plaintext, keyShapedInFiles }));`;
  return JSON.parse(execFileSync("docker", ["exec", "-w", "/app", BACKEND_CONTAINER, "node", "-e", script], { encoding: "utf8", timeout: 60_000 })) as { envelopes: number; plaintext: number; keyShapedInFiles: number };
}

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["inspect", PEER_CONTAINER], { stdio: "pipe", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

async function waitHealthy(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not become healthy`);
}

/** Installation A: its own request context, so its cookies never mix with B's. */
async function peer(): Promise<{ api: APIRequestContext; auth: { Authorization: string } }> {
  const health = await (await fetch(`${PEER_URL}/api/health`)).json() as { e2e?: boolean };
  // The same guard global-setup applies to B: never change an installation that is not disposable.
  expect(health.e2e === true, "the peer must be a disposable E2E installation").toBe(true);
  const api = await playwrightRequest.newContext({ baseURL: PEER_URL });
  const status = await (await api.get("/api/auth/status")).json() as { needsSetup?: boolean };
  const response = status.needsSetup
    ? await api.post("/api/auth/setup", { data: { username: ADMIN.username, password: ADMIN.password } })
    : await api.post("/api/auth/login", { data: { username: ADMIN.username, password: ADMIN.password } });
  expect(response.ok(), `peer sign-in failed: ${response.status()}`).toBe(true);
  return { api, auth: { Authorization: `Bearer ${(await response.json()).accessToken as string}` } };
}

let observedDevice: string | undefined;

test.describe("Aeolus-to-Aeolus remote connector", () => {
  test.beforeAll(() => {
    if (!dockerAvailable()) {
      // CI always runs the full disposable stack; a local dev-server run may not have it.
      if (process.env.CI) throw new Error(`${PEER_CONTAINER} is not running; start the stack with make e2e-up`);
      test.skip(true, `${PEER_CONTAINER} is not running (make e2e-up starts it)`);
    }
  });

  test.afterEach(async ({ page, request }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await scrubCredentials(page).catch(() => undefined);
      await maskedScreenshot(page, testInfo, "failure.png", "failure").catch(() => undefined);
    }
    // Remove B's remote instances, pass or fail, so none keeps polling with a live key.
    await (async () => {
      await waitHealthy(API_URL);
      const auth = await adminAuth(request);
      const list = await (await request.get(`${API_URL}/api/connectors`, { headers: auth })).json() as Array<{ id: string; connectorType: string }>;
      for (const instance of list.filter((c) => c.connectorType === "aeolus-remote")) {
        await request.delete(`${API_URL}/api/connectors/${instance.id}`, { headers: auth });
      }
    })().catch(() => undefined);
    // Leave both installations running for the specs that follow.
    try { docker("start", PEER_CONTAINER); } catch { /* already running */ }
    await waitHealthy(API_URL).catch(() => undefined);
  });

  test("publish on A, read on B, survive an outage, rotate, restart and revoke", async ({ page, request }, testInfo) => {
    test.setTimeout(420_000);
    const a = await peer();
    const b = await adminAuth(request);

    // 1. A publishes a read-only endpoint over its own stored state.
    const created = await a.api.post("/api/automations", {
      headers: a.auth,
      data: { name: `Site A conditions ${SLUG}`, ruleType: "script", triggerType: "mqtt", triggerTopic: "sensor/site-a/conditions", project: PROJECT },
    });
    expect(created.ok(), `create on A failed: ${created.status()}`).toBe(true);
    const automationId = (await created.json()).id as string;
    const setState = async (key: string, value: number) => {
      const res = await a.api.put(`/api/automations/${automationId}/state`, { headers: a.auth, data: { key, value } });
      expect(res.ok(), `state write on A failed: ${res.status()}`).toBe(true);
    };
    const observedAt = Date.now() - 2_000;
    await setState("level", 61.5);
    await setState("observedAt", observedAt);
    expect((await a.api.put(`/api/project-apis/${automationId}/slug`, { headers: a.auth, data: { slug: SLUG } })).ok()).toBe(true);
    const status = await (await a.api.get(`/api/project-apis/${automationId}`, { headers: a.auth })).json() as { declared: { contentHash: string } };
    const published = await a.api.post(`/api/project-apis/${automationId}/publish`, { headers: a.auth, data: { contentHash: status.declared.contentHash } });
    expect(published.status(), "publish on A").toBe(201);

    // 2. A client for B, one expiring key, and a grant to exactly this route.
    const client = await (await a.api.post("/api/project-apis/clients", { headers: a.auth, data: { name: `Installation B ${SLUG}` } })).json() as { id: string };
    const firstIssue = await (await a.api.post(`/api/project-apis/clients/${client.id}/keys`, {
      headers: a.auth, data: { expiresAt: Date.now() + 7 * 24 * 3600_000 },
    })).json() as { key: string; credential: { id: string } };
    const firstKey = firstIssue.key;
    expect(API_KEY_PATTERN.test(firstKey), "A issued a key in the documented format").toBe(true);
    const granted = await a.api.post(`/api/project-apis/${automationId}/grants`, { headers: a.auth, data: { clientId: client.id, routeId: "conditions-summary" } });
    expect(granted.ok(), `grant on A failed: ${granted.status()}`).toBe(true);

    // 3. B connects, configured through its own dashboard.
    await page.goto("/connectors");
    const card = page.locator("div.rounded-xl").filter({ has: page.getByText("Reads one published Project API route") }).last();
    await card.getByRole("button", { name: /^Enable$/ }).click();
    await card.getByLabel("Remote installation URL").fill(PEER_URL_FROM_BACKEND);
    await card.getByLabel("Endpoint path").fill(ENDPOINT);
    // The only password field in the form; its label reads "API key*" (required).
    await enterSecret(card.locator('input[type="password"]'), firstKey);
    // B and A talk over the stack's private bridge network, in plain HTTP by explicit choice.
    await card.locator("label", { hasText: "Allow plaintext HTTP on a trusted LAN" }).locator("..").getByRole("button").click();
    await card.getByLabel("Poll interval (seconds)").fill("5");
    await card.getByLabel("Stale after (seconds)").fill("600");
    await card.getByLabel("Source time field").fill("observedAt");
    await card.getByLabel("Device name").fill(DEVICE_NAME);
    expect(await maskedScreenshot(page, testInfo, "01-configure-remote.png", "configure-remote"), "the key field is masked").toBeGreaterThan(0);
    const enabledResponse = page.waitForResponse((res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/connectors");
    await card.getByRole("button", { name: "Enable Connector" }).click();
    expect((await enabledResponse).status(), "B accepted the configuration").toBe(200);

    const connectors = await (await request.get(`${API_URL}/api/connectors`, { headers: b })).json() as Array<{ id: string; connectorType: string; config: Record<string, unknown> }>;
    const remote = connectors.filter((c) => c.connectorType === "aeolus-remote").at(-1);
    expect(remote, "B has an Aeolus Remote instance").toBeTruthy();
    // The stored key is never returned.
    expect(remote!.config.apiKey).toBe("********");
    expect(JSON.stringify(connectors).includes(firstKey.slice(21)), "no key in B's connector list").toBe(false);
    const deviceId = `aeolus-remote-${remote!.id}`;
    observedDevice = deviceId;
    const observe = async () => {
      const res = await request.get(`${API_URL}/api/devices/${deviceId}`, { headers: b });
      expect(res.ok(), `device read on B failed: ${res.status()}`).toBe(true);
      const device = await res.json() as { id: string; state: Observation };
      expect(JSON.stringify(device).includes(firstKey.slice(21)), "no key in the device").toBe(false);
      return device;
    };

    // 4. Fresh data, with the source time A's payload declared.
    await expect.poll(async () => (await observe()).state.httpStatus, { timeout: 30_000 }).toBe(200);
    const fresh = (await observe()).state;
    expect(fresh).toMatchObject({ data: { level: 61.5, observedAt }, sourceTime: observedAt, sourceTimeBasis: "payload", stale: false, staleReason: null, transport: "http-plaintext" });
    expect(fresh.fetchedAt! >= observedAt).toBe(true);
    // The active card shows the connector type; the available card does not.
    const activeCard = page.locator("div.rounded-xl").filter({ has: page.getByText("aeolus-remote", { exact: true }) }).last();
    await page.reload();
    await expect(activeCard.getByText(/cross the network unencrypted/)).toBeVisible();
    await maskedScreenshot(page, testInfo, "02-remote-connected.png", "remote-connected");

    // 5. A goes away. B keeps the last reading, clearly stale; nothing reads as live.
    docker("stop", PEER_CONTAINER);
    await expect.poll(async () => (await observe()).state.stale, { timeout: 60_000 }).toBe(true);
    const outage = (await observe()).state;
    expect(outage.data).toEqual({ level: 61.5, observedAt });
    expect(["dns", "connection-refused", "connect-timeout", "timeout", "network"]).toContain(outage.staleReason);
    expect(outage.error).toBeTruthy();

    // 6. A comes back; B recovers on the same device, with a newer reading.
    docker("start", PEER_CONTAINER);
    await waitHealthy(PEER_URL);
    const later = Date.now() - 1_000;
    const back = await peer();
    const writeAgain = await back.api.put(`/api/automations/${automationId}/state`, { headers: back.auth, data: { key: "observedAt", value: later } });
    expect(writeAgain.ok()).toBe(true);
    await expect.poll(async () => (await observe()).state.sourceTime, { timeout: 90_000 }).toBe(later);
    const recovered = await observe();
    expect(recovered.id).toBe(deviceId);
    expect(recovered.state).toMatchObject({ stale: false, staleReason: null, httpStatus: 200, error: null });

    // 7. Rotate on A with an overlap, give B the new key in its dashboard, restart B,
    //    then revoke the old key: B reading again proves the new key was stored.
    const rotated = await (await back.api.post(`/api/project-apis/clients/${client.id}/keys/${firstIssue.credential.id}/rotate`, {
      headers: back.auth, data: { expiresAt: Date.now() + 7 * 24 * 3600_000, overlapSeconds: 300 },
    })).json() as { key: string; credential: { id: string } };
    expect(API_KEY_PATTERN.test(rotated.key) && rotated.key !== firstKey, "rotation issued a new key").toBe(true);
    await page.reload();
    await activeCard.getByRole("button", { name: "Edit configuration" }).click();
    // The stored key shows only as the mask; it is replaced, everything else kept.
    await expect(activeCard.getByText(/A secret is stored and is never shown/)).toBeVisible();
    await enterSecret(activeCard.locator('input[type="password"]'), rotated.key);
    expect(await maskedScreenshot(page, testInfo, "03-replace-key.png", "replace-key"), "the key field is masked").toBeGreaterThan(0);
    await activeCard.getByRole("button", { name: "Save configuration" }).click();
    await expect(activeCard.getByRole("button", { name: "Save configuration" })).toBeHidden();

    docker("restart", BACKEND_CONTAINER);
    await waitHealthy(API_URL);
    // At rest on B, the key and the other secrets are envelopes; no key appears in the database files.
    const atRest = storedSecretsOnB();
    expect(atRest.plaintext, "no plaintext secret in B's database").toBe(0);
    expect(atRest.envelopes, "B's JWT secret, MQTT password and Remote key are encrypted").toBeGreaterThanOrEqual(2);
    expect(atRest.keyShapedInFiles, "no API key in B's database files").toBe(0);
    const revokedOld = await back.api.post(`/api/project-apis/clients/${client.id}/keys/${firstIssue.credential.id}/revoke`, { headers: back.auth });
    expect(revokedOld.ok(), `revoking the old key failed: ${revokedOld.status()}`).toBe(true);
    const restartedAt = Date.now();
    await expect.poll(async () => {
      const state = (await observe()).state;
      return state.httpStatus === 200 && !state.stale && (state.fetchedAt ?? 0) > restartedAt;
    }, { timeout: 60_000 }).toBe(true);
    expect((await observe()).id).toBe(deviceId);

    // 8. Revoke the key B now holds: B fails closed and keeps the reading only as lastKnown.
    const revoked = await back.api.post(`/api/project-apis/clients/${client.id}/keys/${rotated.credential.id}/revoke`, { headers: back.auth });
    expect(revoked.ok()).toBe(true);
    await expect.poll(async () => (await observe()).state.httpStatus, { timeout: 60_000 }).toBe(401);
    const closed = await observe();
    expect(closed.id).toBe(deviceId);
    expect(closed.state).toMatchObject({ data: null, sourceTime: null, stale: true, staleReason: "unauthorized" });
    expect(closed.state.lastKnown?.data).toEqual({ level: 61.5, observedAt: later });
    await page.reload();
    await expect(activeCard.getByText(/refused the key \(401\)/)).toBeVisible();
    await maskedScreenshot(page, testInfo, "04-key-revoked.png", "key-revoked");

    // 9. B is otherwise unaffected: MQTT ingestion, command history, and the remote
    //    device stays read-only.
    const topic = `sensor/e2e-remote-${SLUG}`;
    const published9 = await request.post(`${API_URL}/api/mqtt/publish`, { headers: b, data: { topic, payload: { temperature: 21.5 } } });
    expect(published9.ok(), `MQTT publish on B failed: ${published9.status()}`).toBe(true);
    await expect.poll(async () => {
      const devices = await (await request.get(`${API_URL}/api/devices`, { headers: b })).json() as Array<{ topic?: string; state: Record<string, unknown> }>;
      return devices.find((device) => device.topic === topic)?.state.temperature;
    }, { timeout: 20_000 }).toBe(21.5);
    expect((await request.get(`${API_URL}/api/commands`, { headers: b })).ok()).toBe(true);
    expect(await (await request.get(`${API_URL}/api/devices/${deviceId}/actions`, { headers: b })).json()).toEqual([]);
    const action = await request.post(`${API_URL}/api/devices/${deviceId}/action`, { headers: b, data: { type: "toggle", params: {} } });
    expect(action.ok(), "a remote observation cannot be commanded").toBe(false);

    // A's keys are already revoked; afterEach removes B's instance.
    await a.api.dispose();
    await back.api.dispose();
    expect(observedDevice).toBe(deviceId);
  });
});
