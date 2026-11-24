import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock("./auth-fetch", () => ({ authFetch: h.authFetch }));
vi.mock("./env", () => ({ API_URL: "http://aeolus.test:3001", PUBLIC_DEMO: false }));

import * as api from "./project-api";

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const lastCall = () => {
  const [url, init] = h.authFetch.mock.calls.at(-1) as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined };
};

describe("project-api client", () => {
  beforeEach(() => {
    h.authFetch.mockReset();
    h.authFetch.mockImplementation(() => respond({ grants: [], clients: [], events: [] }));
  });

  it("reads without a mutation id and never from a cache", async () => {
    await api.fetchEndpointStatus("auto/1");
    const { url, init } = lastCall();
    expect(url).toBe("http://aeolus.test:3001/api/project-apis/auto%2F1");
    expect(init.cache).toBe("no-store");
    expect(init.headers["X-Aeolus-Mutation-Id"]).toBeUndefined();
  });

  it("sends a mutation id with every change, so the audit record correlates", async () => {
    await api.publishApi("a1", "f".repeat(64));
    const { init, body } = lastCall();
    expect(init.method).toBe("POST");
    expect(init.headers["X-Aeolus-Mutation-Id"]).toEqual(expect.any(String));
    expect(body).toEqual({ contentHash: "f".repeat(64) });
  });

  it.each([
    ["setApiSlug", () => api.setApiSlug("a1", "tank-levels"), "PUT", "/a1/slug", { slug: "tank-levels" }],
    ["setApiSlug reclaim", () => api.setApiSlug("a1", "tank-levels", true), "PUT", "/a1/slug", { slug: "tank-levels", reclaim: true }],
    ["unpublishApi", () => api.unpublishApi("a1"), "POST", "/a1/unpublish", undefined],
    ["grantRoute", () => api.grantRoute("a1", "c1", "level"), "POST", "/a1/grants", { clientId: "c1", routeId: "level" }],
    ["revokeRouteGrant", () => api.revokeRouteGrant("a1", "c1", "level"), "POST", "/a1/grants/revoke", { clientId: "c1", routeId: "level" }],
    ["createClient", () => api.createClient("Farm"), "POST", "/clients", { name: "Farm" }],
    ["fetchClient", () => api.fetchClient("c1"), undefined, "/clients/c1", undefined],
    ["setClientEnabled false", () => api.setClientEnabled("c1", false), "POST", "/clients/c1/disable", undefined],
    ["setClientEnabled true", () => api.setClientEnabled("c1", true), "POST", "/clients/c1/enable", undefined],
    ["issueKey", () => api.issueKey("c1", 5000), "POST", "/clients/c1/keys", { expiresAt: 5000 }],
    ["rotateKey", () => api.rotateKey("c1", "k1", null, 3600), "POST", "/clients/c1/keys/k1/rotate", { expiresAt: null, overlapSeconds: 3600 }],
    ["revokeKey", () => api.revokeKey("c1", "k1"), "POST", "/clients/c1/keys/k1/revoke", undefined],
    ["tryRoute", () => api.tryRoute("a1", "tank", { id: "main" }, "aeo_k"), "POST", "/a1/try", { routeId: "tank", params: { id: "main" }, key: "aeo_k" }],
  ] as const)("%s calls the right route", async (_name, invoke, method, path, body) => {
    await invoke();
    const call = lastCall();
    expect(call.url).toBe(`http://aeolus.test:3001/api/project-apis${path}`);
    expect(call.init.method).toBe(method);
    expect(call.body).toEqual(body);
  });

  it("unwraps list responses", async () => {
    h.authFetch.mockImplementation((url: string) => respond(
      url.includes("/grants") ? { grants: [{ id: "g" }] } : url.includes("/audit") ? { events: [{ id: 1 }] } : { clients: [{ id: "c" }] },
    ));
    expect(await api.fetchApiGrants("a1")).toEqual([{ id: "g" }]);
    expect(await api.fetchClients()).toEqual([{ id: "c" }]);
    expect(await api.fetchApiAudit("api 1", 5)).toEqual([{ id: 1 }]);
    expect(lastCall().url).toBe("http://aeolus.test:3001/api/project-apis/audit?apiId=api%201&limit=5");
  });

  it("returns the OpenAPI document as formatted JSON text", async () => {
    h.authFetch.mockImplementation(() => respond({ openapi: "3.1.0" }));
    expect(await api.fetchOpenApiDocument("a1")).toBe('{\n  "openapi": "3.1.0"\n}');
    expect(lastCall().url).toBe("http://aeolus.test:3001/api/project-apis/a1/openapi.json");
  });

  it("raises the server's message and stable reason", async () => {
    h.authFetch.mockImplementation(() => respond({ error: "Slug was used before", details: { reason: "slug-retired" } }, 409));
    const error = await api.setApiSlug("a1", "old").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(api.ProjectApiRequestError);
    expect(error).toMatchObject({ status: 409, message: "Slug was used before", reason: "slug-retired" });
  });

  it("falls back to the status when the body is not JSON or has no message", async () => {
    h.authFetch.mockImplementation(() => Promise.resolve(new Response("gateway", { status: 502 })));
    await expect(api.fetchClients()).rejects.toMatchObject({ status: 502, message: "Request failed (502)", reason: undefined });
    h.authFetch.mockImplementation(() => respond({ details: [{ path: "x" }] }, 400));
    await expect(api.fetchClients()).rejects.toMatchObject({ message: "Request failed (400)", reason: undefined });
  });

  it("keeps no key anywhere after an issue", async () => {
    h.authFetch.mockImplementation(() => respond({ key: "aeo_0123456789abcdef_SECRETSECRET", credential: { id: "k1" } }, 201));
    const issued = await api.issueKey("c1", null);
    expect(issued.key).toBe("aeo_0123456789abcdef_SECRETSECRET");
    expect(JSON.stringify(localStorage)).not.toContain("SECRET");
    expect(JSON.stringify(sessionStorage)).not.toContain("SECRET");
  });
});
