// e2e/automation-project-demo.spec.ts — Public-demo Automation Project access.
//
// Proves the demo capability envelope against a REAL running backend with a
// REAL public-demo session token, rather than at middleware-unit level:
//
//   • GET  /api/automations/:id/project → 200  (must be allowlisted in
//     demo-policy.ts; without it the demo's own source viewer is 403'd, and
//     every seeded showcase automation is a project)
//   • PUT  /api/automations/:id/project → 403  (authoring stays forbidden)
//   • PUT/POST/DELETE on automations    → 403  (fail-closed by default)
//
// Requires the stack in public-demo mode:
//   backend  AEOLUS_PUBLIC_DEMO=true
//   frontend VITE_PUBLIC_DEMO=true
// The spec skips itself when the backend is not in demo mode, so it is safe to
// run alongside the normal suite (CI runs the ordinary stack and skips this).
//
// Provisioning uses an admin session, which the demo guard does not constrain —
// it only confines tokens stamped sessionType: "public-demo".
//
// NOTE: the browser-level "Edit" walkthrough (tree renders, files
// browsable, draft editable) is not automated here. The two-pane react-grid
// layout intercepts pointer events into Monaco, which needs more selector work
// than it is worth; the authenticated multi-file workflow in
// automation-project.spec.ts covers the editor itself in a real browser.

import { test, expect, type APIRequestContext } from "@playwright/test";
import { API_URL } from "./constants";
import { adminAuth } from "./helpers";

const TAB_ID = "tab-e2e-demo-project";
const TAB_NAME = "E2E Demo Project";
const RULE_NAME = "E2E Demo Project Automation";

const PROJECT = {
  logicEntry: "logic/index.ts",
  uiEntry: "ui/index.tsx",
  files: [
    {
      path: "logic/index.ts",
      content: [
        `import { THRESHOLD } from "./constants";`,
        `export default async function run(context: EventContext) {`,
        `  state.set("threshold", THRESHOLD);`,
        `}`,
      ].join("\n"),
    },
    { path: "logic/constants.ts", content: `export const THRESHOLD = 42;` },
    { path: "ui/index.tsx", content: `export default function View() {\n  return <div>demo project ui</div>;\n}` },
  ],
};

/** Seed a project automation, a demo-readable tab/pane, and the demo identity. */
async function provisionDemo(request: APIRequestContext): Promise<string> {
  const auth = await adminAuth(request);

  const rules = await (await request.get(`${API_URL}/api/automations`, { headers: auth })).json() as
    Array<{ id: string; name: string }>;
  const found = rules.find((r) => r.name === RULE_NAME);

  let ruleId: string;
  if (found) {
    ruleId = found.id;
    const reset = await request.put(`${API_URL}/api/automations/${ruleId}/project`, { headers: auth, data: PROJECT });
    expect(reset.ok(), await reset.text()).toBeTruthy();
  } else {
    const created = await request.post(`${API_URL}/api/automations`, {
      headers: auth,
      data: { name: RULE_NAME, ruleType: "script", triggerType: "mqtt", triggerTopic: "sensor/e2e/demo", project: PROJECT },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    ruleId = (await created.json()).id as string;
  }

  const now = new Date().toISOString();
  const layout = await request.put(`${API_URL}/api/layout`, {
    headers: auth,
    data: {
      tabs: [{ id: TAB_ID, name: TAB_NAME, icon: "code", order: 0, pinned: false, createdAt: now }],
      panes: [{
        id: `${TAB_ID}-pane-0`, tabId: TAB_ID, x: 0, y: 0, w: 12, h: 18, createdAt: now,
        paneType: "automation", config: { ruleId, ruleName: RULE_NAME },
      }],
    },
  });
  expect(layout.ok(), await layout.text()).toBeTruthy();

  // Demo identity: read-only on the tab, exactly as demo/seed/lib.mjs does.
  const groups = await (await request.get(`${API_URL}/api/auth/groups`, { headers: auth })).json() as
    Array<{ id: string; name: string }>;
  const tabAssignments = [{ tabId: TAB_ID, permission: "read" as const }];
  const existingGroup = groups.find((g) => g.name === "Public Demo");
  let groupId: string;
  if (existingGroup) {
    await request.put(`${API_URL}/api/auth/groups/${existingGroup.id}`, { headers: auth, data: { name: "Public Demo", tabAssignments } });
    groupId = existingGroup.id;
  } else {
    const created = await request.post(`${API_URL}/api/auth/groups`, { headers: auth, data: { name: "Public Demo", tabAssignments } });
    expect(created.ok(), await created.text()).toBeTruthy();
    groupId = (await created.json()).id as string;
  }

  const users = await (await request.get(`${API_URL}/api/auth/users`, { headers: auth })).json() as
    Array<{ id: string; username: string }>;
  if (!users.find((u) => u.username === "demo")) {
    const created = await request.post(`${API_URL}/api/auth/users`, {
      headers: auth,
      data: { username: "demo", password: `demo-${Math.random().toString(36).slice(2)}x9`, groupId, role: "user" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }

  return ruleId;
}

/** A public-demo access token, obtained the same way the frontend obtains one. */
async function demoToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/demo-session`);
  expect(res.ok(), `demo-session failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).accessToken as string;
}

test.describe("Public demo — Automation Project access", () => {
  test.beforeAll(async ({ request }) => {
    const probe = await request.post(`${API_URL}/api/auth/demo-session`);
    // 404 means the backend is not running with AEOLUS_PUBLIC_DEMO=true.
    test.skip(probe.status() === 404, "backend is not in public-demo mode");
  });

  test("allows reading a project tree but never writing one", async ({ request }) => {
    const ruleId = await provisionDemo(request);
    const headers = { Authorization: `Bearer ${await demoToken(request)}` };

    // Read is explicitly allowlisted — this is what the demo source viewer needs.
    const read = await request.get(`${API_URL}/api/automations/${ruleId}/project`, { headers });
    expect(read.status()).toBe(200);
    const project = await read.json();
    expect(project.files.map((f: { path: string }) => f.path).sort()).toEqual([
      "logic/constants.ts", "logic/index.ts", "ui/index.tsx",
    ]);
    expect(project.files.find((f: { path: string }) => f.path === "logic/constants.ts").content).toContain("THRESHOLD = 42");

    // Every authoring route stays denied for a demo session (fail-closed).
    expect((await request.put(`${API_URL}/api/automations/${ruleId}/project`, { headers, data: PROJECT })).status()).toBe(403);
    expect((await request.put(`${API_URL}/api/automations/${ruleId}`, { headers, data: { name: "hijacked" } })).status()).toBe(403);
    expect((await request.post(`${API_URL}/api/automations`, { headers, data: { name: "new", ruleType: "script", project: PROJECT } })).status()).toBe(403);
    expect((await request.delete(`${API_URL}/api/automations/${ruleId}`, { headers })).status()).toBe(403);

    // The seeded source is unchanged after the write attempts.
    const after = await (await request.get(`${API_URL}/api/automations/${ruleId}/project`, { headers })).json();
    expect(after.files).toEqual(project.files);
  });
});
