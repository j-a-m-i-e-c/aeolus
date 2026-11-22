// src/project-api/manifest.ts — the static route manifest of a Project API (ADR-0027).
//
// `api/routes.json` is data, never code: it is parsed with JSON.parse and validated
// here, and nothing in it is executed. It declares which GET endpoints exist, which
// exported handler serves each, and the JSON Schema each successful response must
// satisfy. Phase 0 proof of concept: not yet wired into compilation or routing.

import { z } from "zod";
import { AutomationProjectCompileError, type ProjectCompileError } from "../automations/automation-project.js";

export const API_MANIFEST_PATH = "api/routes.json";
export const MAX_API_ROUTES = 16;
export const MAX_PATH_SEGMENTS = 8;
export const MAX_PARAM_BYTES = 128;
const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_SCHEMA_BYTES = 8 * 1024;
const MAX_SCHEMA_DEPTH = 8;

const LITERAL_SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PARAM_SEGMENT = /^:([a-z][a-zA-Z0-9]{0,31})$/;
const ROUTE_ID = /^[a-z][a-z0-9-]{0,62}$/;
const HANDLER_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
// Names that would reach the module object's own machinery rather than an export.
const RESERVED_HANDLERS = new Set(["default", "constructor", "prototype", "__proto__", "toString", "valueOf", "then"]);

// ─── Response schema subset ──────────────────────────────────────────────────
//
// A deliberately small JSON Schema subset. Validation runs on the host for every
// response, so author-supplied keywords that execute author input on the host are
// excluded: `pattern` (a regular expression is a ReDoS surface), `$ref`/`$defs`
// (reference resolution), `format`, and composition keywords. The size and depth
// caps bound validation cost regardless of the shape.

type JsonType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
const jsonType = z.enum(["object", "array", "string", "number", "integer", "boolean", "null"]);
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export type ResponseSchema = {
  type: JsonType | JsonType[];
  description?: string;
  properties?: Record<string, ResponseSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: ResponseSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: Array<string | number | boolean | null>;
};

const responseSchemaSchema: z.ZodType<ResponseSchema> = z.lazy(() =>
  z.object({
    type: z.union([jsonType, z.array(jsonType).min(1).max(7)]),
    description: z.string().max(500).optional(),
    properties: z.record(z.string().min(1).max(64), responseSchemaSchema).optional(),
    required: z.array(z.string().min(1).max(64)).max(64).optional(),
    additionalProperties: z.boolean().optional(),
    items: responseSchemaSchema.optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    enum: z.array(scalar).min(1).max(64).optional(),
  }).strict(),
);

function schemaDepth(schema: ResponseSchema): number {
  const children = [...Object.values(schema.properties ?? {}), ...(schema.items ? [schema.items] : [])];
  return 1 + Math.max(0, ...children.map(schemaDepth));
}

// ─── Manifest ────────────────────────────────────────────────────────────────

const routeSchema = z.object({
  id: z.string().regex(ROUTE_ID, "must be lowercase letters, digits and hyphens, starting with a letter"),
  method: z.literal("GET"),
  path: z.string().min(1).max(200),
  handler: z.string().regex(HANDLER_NAME, "must be a JavaScript identifier")
    .refine((name) => !RESERVED_HANDLERS.has(name), "is a reserved name"),
  description: z.string().max(500).optional(),
  response: responseSchemaSchema,
}).strict();

const manifestSchema = z.object({
  version: z.literal(1),
  routes: z.array(routeSchema).min(1).max(MAX_API_ROUTES),
}).strict();

export type ApiRoute = z.infer<typeof routeSchema>;
export type ApiManifest = z.infer<typeof manifestSchema>;
type Segment = { kind: "literal"; value: string } | { kind: "param"; name: string };

function fail(message: string): never {
  throw new AutomationProjectCompileError([{ path: API_MANIFEST_PATH, line: 1, column: 0, message }]);
}

/** The path as segments, or the reason it is not a permitted route path. */
function parsePath(path: string): Segment[] | string {
  if (!path.startsWith("/")) return "must start with /";
  const raw = path.slice(1).split("/");
  if (raw.length > MAX_PATH_SEGMENTS) return `has more than ${MAX_PATH_SEGMENTS} segments`;
  const segments: Segment[] = [];
  const names = new Set<string>();
  for (const part of raw) {
    const param = PARAM_SEGMENT.exec(part);
    if (param) {
      if (names.has(param[1])) return `repeats the parameter :${param[1]}`;
      names.add(param[1]);
      segments.push({ kind: "param", name: param[1] });
    } else if (LITERAL_SEGMENT.test(part)) {
      segments.push({ kind: "literal", value: part });
    } else {
      return `has an invalid segment "${part}" (use lowercase letters, digits and hyphens, or :name)`;
    }
  }
  return segments;
}

/**
 * Two routes are ambiguous when some request path could match both. A parameter
 * matches any literal, so `/tanks/:id` and `/tanks/all` are rejected rather than
 * resolved by precedence: an author renaming a literal must never silently send
 * requests to a different handler.
 */
function ambiguous(a: Segment[], b: Segment[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((seg, i) => {
    const other = b[i]!;
    return seg.kind === "param" || other.kind === "param" || seg.value === other.value;
  });
}

export interface CompiledApiRoute extends ApiRoute {
  segments: Segment[];
}

/** Parse and validate `api/routes.json`. Throws the project compile error shape. */
export function parseApiManifest(source: string): { manifest: ApiManifest; routes: CompiledApiRoute[] } {
  if (Buffer.byteLength(source, "utf8") > MAX_MANIFEST_BYTES) fail(`exceeds ${MAX_MANIFEST_BYTES} bytes`);
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (error) {
    fail(`is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const details: ProjectCompileError[] = parsed.error.issues.slice(0, 20).map((issue) => ({
      path: API_MANIFEST_PATH,
      line: 1,
      column: 0,
      message: `${issue.path.length ? issue.path.join(".") + ": " : ""}${issue.message}`,
    }));
    throw new AutomationProjectCompileError(details);
  }

  const routes: CompiledApiRoute[] = [];
  const ids = new Set<string>();
  for (const [index, route] of parsed.data.routes.entries()) {
    const where = `routes.${index} (${route.id})`;
    if (ids.has(route.id)) fail(`${where}: duplicate route id`);
    ids.add(route.id);
    const segments = parsePath(route.path);
    if (typeof segments === "string") fail(`${where}: path ${segments}`);
    if (Buffer.byteLength(JSON.stringify(route.response), "utf8") > MAX_SCHEMA_BYTES) fail(`${where}: response schema exceeds ${MAX_SCHEMA_BYTES} bytes`);
    if (schemaDepth(route.response) > MAX_SCHEMA_DEPTH) fail(`${where}: response schema is nested deeper than ${MAX_SCHEMA_DEPTH}`);
    const clash = routes.find((other) => ambiguous(other.segments, segments));
    if (clash) fail(`${where}: path ${route.path} overlaps ${clash.path} (${clash.id})`);
    routes.push({ ...route, segments });
  }
  return { manifest: parsed.data, routes };
}

// ─── Matching ────────────────────────────────────────────────────────────────

export type RouteMatch = { route: CompiledApiRoute; params: Record<string, string> };

/**
 * Match a request path (the part after the project slug, still percent-encoded)
 * against the routes. Literals compare against the raw segment, so an encoded
 * slash or dot segment can never satisfy one; parameters are decoded once and
 * refused when the decoded value could be read as path structure.
 */
export function matchApiRoute(routes: CompiledApiRoute[], rawPath: string): RouteMatch | null {
  if (!rawPath.startsWith("/")) return null;
  const parts = rawPath.slice(1).split("/");
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = Object.create(null) as Record<string, string>;
    const matched = route.segments.every((segment, i) => {
      const part = parts[i]!;
      if (segment.kind === "literal") return part === segment.value;
      if (part.length === 0 || part.length > MAX_PARAM_BYTES * 3) return false;
      let value: string;
      try {
        value = decodeURIComponent(part);
      } catch {
        return false;
      }
      if (Buffer.byteLength(value, "utf8") > MAX_PARAM_BYTES || /[/\\\u0000-\u001f\u007f]/.test(value) || value === "." || value === "..") return false;
      params[segment.name] = value;
      return true;
    });
    if (matched) return { route, params: { ...params } };
  }
  return null;
}

// ─── Response validation ─────────────────────────────────────────────────────

/** A validator for a route's declared success response, built from its schema. */
export function responseValidator(route: ApiRoute): (body: unknown) => boolean {
  const schema = z.fromJSONSchema(route.response as Parameters<typeof z.fromJSONSchema>[0]);
  return (body) => schema.safeParse(body).success;
}
