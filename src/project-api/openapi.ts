// src/project-api/openapi.ts — an OpenAPI 3.1 document for a published Project API (ADR-0027, Phase 4).
//
// Built only from an immutable publication snapshot: its manifest's routes and its
// identity. Never from the editable source, so the document always describes what is
// actually served. Route response schemas are the manifest's JSON Schema subset, which
// is valid JSON Schema 2020-12 and therefore valid OpenAPI 3.1 schema objects as-is.

import type { ApiRoute } from "./manifest.js";
import { DEFAULT_API_LIMITS } from "./api-sandbox.js";
import type { SnapshotSummary } from "./publication-store.js";

export interface OpenApiInput {
  slug: string;
  automationName: string;
  snapshot: SnapshotSummary;
  routes: ApiRoute[];
}

const ERROR_SCHEMA = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
  additionalProperties: false,
} as const;

const errorResponse = (description: string, headers?: Record<string, unknown>) => ({
  description,
  ...(headers ? { headers } : {}),
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const RETRY_AFTER = { "Retry-After": { description: "Seconds to wait before retrying", schema: { type: "integer", minimum: 1 } } };

/** `/tanks/:id` → `/tanks/{id}`, and the names of its parameters. */
function openApiPath(path: string): { path: string; params: string[] } {
  const params: string[] = [];
  const converted = path.split("/").map((segment) => {
    if (!segment.startsWith(":")) return segment;
    params.push(segment.slice(1));
    return `{${segment.slice(1)}}`;
  }).join("/");
  return { path: converted, params };
}

export function buildOpenApiDocument(input: OpenApiInput): Record<string, unknown> {
  const { slug, snapshot } = input;
  const paths: Record<string, unknown> = {};
  for (const route of input.routes) {
    const { path, params } = openApiPath(route.path);
    paths[path] = {
      get: {
        operationId: route.id,
        summary: route.description ?? `${route.method} ${route.path}`,
        ...(route.description ? { description: route.description } : {}),
        "x-aeolus-route-id": route.id,
        parameters: params.map((name) => ({
          name, in: "path", required: true,
          description: "Percent-decoded once; at most 128 bytes",
          schema: { type: "string", maxLength: 128 },
        })),
        responses: {
          "200": { description: "The handler's response, checked against this schema", content: { "application/json": { schema: route.response } } },
          "400": { description: "The handler refused the request, or a query string was sent (none are supported)", content: { "application/json": { schema: {} } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { description: "Not found or not granted (one body for both), or the handler's own 404", content: { "application/json": { schema: {} } } },
          "429": { $ref: "#/components/responses/TooManyRequests" },
          "500": { $ref: "#/components/responses/HandlerFailed" },
          "503": { $ref: "#/components/responses/Unavailable" },
          "504": { $ref: "#/components/responses/TimedOut" },
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: `${input.automationName} (${slug})`,
      version: `revision-${snapshot.automationRevision}`,
      description: [
        "Read-only endpoints published from an Aeolus Automation Project.",
        `Generated from publication snapshot ${snapshot.id} (content hash ${snapshot.contentHash}).`,
        "Each request needs an API key granted the route it calls. Use HTTPS unless the network is fully trusted:",
        "over plain HTTP the key crosses the network unencrypted.",
      ].join(" "),
    },
    servers: [{ url: `/api/exposed/v1/${slug}`, description: "Relative to the Aeolus backend, for example http://aeolus.local:3001" }],
    security: [{ apiKey: [] }],
    paths,
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", description: "An Aeolus API key, aeo_<keyId>_<secret>, sent as Authorization: Bearer. Never put it in a URL." },
      },
      schemas: { Error: ERROR_SCHEMA },
      responses: {
        Unauthorized: errorResponse("Missing, malformed, unknown, expired or revoked key, or a disabled client. One body for all",
          { "WWW-Authenticate": { schema: { type: "string" } } }),
        TooManyRequests: errorResponse("Over the per-minute or concurrent request limit", RETRY_AFTER),
        HandlerFailed: errorResponse("The handler threw, or returned something that breaks its schema"),
        Unavailable: errorResponse("The API is temporarily unavailable on a route you are granted, or every handler sandbox is busy", RETRY_AFTER),
        TimedOut: errorResponse(`The handler did not finish within ${DEFAULT_API_LIMITS.deadlineMs / 1000} s`),
      },
    },
    "x-aeolus-snapshot": {
      id: snapshot.id,
      contentHash: snapshot.contentHash,
      automationRevision: snapshot.automationRevision,
      publishedAt: new Date(snapshot.publishedAt).toISOString(),
      runtimeContract: snapshot.runtimeContract,
    },
  };
}
