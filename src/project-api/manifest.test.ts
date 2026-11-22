// src/project-api/manifest.test.ts — the route manifest is the only declaration of
// what a project exposes, so anything it does not state clearly must be refused.

import { describe, expect, it } from "vitest";
import { AutomationProjectCompileError } from "../automations/automation-project.js";
import { MAX_API_ROUTES, matchApiRoute, parseApiManifest, responseValidator, type ApiRoute } from "./manifest.js";

const route = (overrides: Partial<ApiRoute> & Record<string, unknown> = {}) => ({
  id: "tank-status",
  method: "GET",
  path: "/tanks/:id",
  handler: "getTank",
  response: { type: "object", properties: { level: { type: "number" } }, required: ["level"] },
  ...overrides,
});
const manifest = (routes: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, routes, ...extra });

function errorsOf(source: string): string[] {
  try {
    parseApiManifest(source);
  } catch (error) {
    expect(error).toBeInstanceOf(AutomationProjectCompileError);
    const details = (error as AutomationProjectCompileError).details;
    for (const detail of details) expect(detail.path).toBe("api/routes.json");
    return details.map((detail) => detail.message);
  }
  throw new Error("expected the manifest to be rejected");
}

describe("parseApiManifest", () => {
  it("accepts a GET route with a named parameter and a response schema", () => {
    const { manifest: parsed, routes } = parseApiManifest(manifest([route()]));
    expect(parsed.routes).toHaveLength(1);
    expect(routes[0]!.segments).toEqual([{ kind: "literal", value: "tanks" }, { kind: "param", name: "id" }]);
  });

  it.each([
    ["not JSON", "{ version: 1", /not valid JSON/],
    ["an unknown version", manifest([route()], { version: 2 }), /version/],
    ["an unknown top-level key", manifest([route()], { cors: "*" }), /Unrecognized key/],
    ["no routes", manifest([]), /routes/],
    ["a POST route", manifest([route({ method: "POST" })]), /method/],
    ["an unknown route key", manifest([route({ public: true })]), /Unrecognized key/],
    ["an uppercase route id", manifest([route({ id: "Tank" })]), /id/],
    ["a handler that is not an identifier", manifest([route({ handler: "get-tank" })]), /identifier/],
    ["the default export as a handler", manifest([route({ handler: "default" })]), /reserved/],
    ["__proto__ as a handler", manifest([route({ handler: "__proto__" })]), /reserved/],
    ["a regex keyword in the response schema", manifest([route({ response: { type: "string", pattern: "^(a+)+$" } })]), /Unrecognized key/],
    ["a $ref in the response schema", manifest([route({ response: { $ref: "https://example.com/x" } })]), /Unrecognized key|type/],
  ])("rejects %s", (_label, source, message) => {
    expect(errorsOf(source).join("\n")).toMatch(message);
  });

  it(`rejects more than ${MAX_API_ROUTES} routes`, () => {
    const routes = Array.from({ length: MAX_API_ROUTES + 1 }, (_, i) => route({ id: `r${i}`, path: `/r${i}` }));
    expect(errorsOf(manifest(routes)).join()).toMatch(/routes/);
  });

  it("rejects a manifest larger than 32 KiB", () => {
    expect(errorsOf(manifest([route({ description: "x".repeat(400) })]) + " ".repeat(33 * 1024)).join()).toMatch(/exceeds/);
  });

  it("rejects a repeated route id", () => {
    expect(errorsOf(manifest([route(), route({ path: "/other" })])).join()).toMatch(/duplicate route id/);
  });

  it.each([
    ["no leading slash", "tanks"],
    ["an empty segment", "/tanks//main"],
    ["a trailing slash", "/tanks/"],
    ["an uppercase literal", "/Tanks"],
    ["a wildcard", "/tanks/*"],
    ["a regular expression", "/tanks/(\\d+)"],
    ["an optional parameter", "/tanks/:id?"],
    ["an encoded segment", "/tanks/%2e%2e"],
    ["a dot segment", "/tanks/.."],
    ["a repeated parameter", "/:id/:id"],
    ["too many segments", "/a/b/c/d/e/f/g/h/i"],
  ])("rejects a path with %s", (_label, path) => {
    expect(errorsOf(manifest([route({ path })])).join()).toMatch(/path/);
  });

  it.each([
    ["/tanks/:id", "/tanks/all"],
    ["/tanks/all", "/tanks/:id"],
    ["/:site/level", "/tank/:reading"],
    ["/tanks/:id", "/tanks/:name"],
  ])("rejects %s alongside %s, which some request would match both", (first, second) => {
    const errors = errorsOf(manifest([route({ id: "a", path: first }), route({ id: "b", path: second })]));
    expect(errors.join()).toMatch(/overlaps/);
  });

  it("accepts routes that no single request path can match twice", () => {
    const { routes } = parseApiManifest(manifest([
      route({ id: "a", path: "/tanks" }),
      route({ id: "b", path: "/tanks/:id" }),
      route({ id: "c", path: "/pumps/:id" }),
      route({ id: "d", path: "/tanks/:id/level" }),
    ]));
    expect(routes.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("rejects a response schema nested deeper than eight levels", () => {
    let schema: Record<string, unknown> = { type: "number" };
    for (let i = 0; i < 9; i++) schema = { type: "object", properties: { x: schema } };
    expect(errorsOf(manifest([route({ response: schema })])).join()).toMatch(/deeper/);
  });

  it("rejects a response schema larger than 8 KiB", () => {
    const properties = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`p${i}`, { type: "string", description: "x".repeat(150) }]));
    expect(errorsOf(manifest([route({ response: { type: "object", properties } })])).join()).toMatch(/exceeds 8192/);
  });
});

describe("matchApiRoute", () => {
  const { routes } = parseApiManifest(manifest([
    route({ id: "list", path: "/tanks", handler: "listTanks" }),
    route({ id: "one", path: "/tanks/:id" }),
  ]));

  it("matches literals exactly and decodes a parameter once", () => {
    expect(matchApiRoute(routes, "/tanks")?.route.id).toBe("list");
    const match = matchApiRoute(routes, "/tanks/main%20tank");
    expect(match?.route.id).toBe("one");
    expect(match?.params).toEqual({ id: "main tank" });
  });

  it("returns plain parameter objects", () => {
    const params = matchApiRoute(routes, "/tanks/__proto__")!.params;
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
    expect(Object.keys(params)).toEqual(["id"]);
    expect(({} as Record<string, unknown>).id).toBeUndefined();
  });

  it.each([
    ["an unknown path", "/pumps"],
    ["an extra segment", "/tanks/main/extra"],
    ["a trailing slash", "/tanks/"],
    ["an empty parameter", "/tanks//"],
    ["a different case", "/Tanks"],
    ["no leading slash", "tanks"],
    ["an encoded slash", "/tanks/a%2Fb"],
    ["an encoded backslash", "/tanks/a%5Cb"],
    ["an encoded dot segment", "/tanks/%2e%2e"],
    ["a dot segment", "/tanks/.."],
    ["a control character", "/tanks/a%00b"],
    ["malformed percent-encoding", "/tanks/%E0%A4%A"],
    ["a parameter over 128 bytes", `/tanks/${"a".repeat(129)}`],
    ["an encoded parameter over 128 bytes", `/tanks/${"%C3%A9".repeat(65)}`],
  ])("matches nothing for %s", (_label, path) => {
    expect(matchApiRoute(routes, path)).toBeNull();
  });
});

describe("responseValidator", () => {
  it("accepts a declared response and rejects one that breaks the schema", () => {
    const valid = responseValidator(route({
      response: { type: "object", properties: { level: { type: "number", minimum: 0, maximum: 100 }, name: { type: ["string", "null"] } }, required: ["level"], additionalProperties: false },
    }) as ApiRoute);
    expect(valid({ level: 40, name: null })).toBe(true);
    expect(valid({ level: 140 })).toBe(false);
    expect(valid({ level: "40" })).toBe(false);
    expect(valid({})).toBe(false);
    expect(valid({ level: 40, role: "admin" })).toBe(false);
  });
});
