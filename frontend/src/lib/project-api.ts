// frontend/src/lib/project-api.ts — the Project API management routes (ADR-0027) for the
// Endpoints section of the Automation Project editor.
//
// Every route is admin-only on the server, whatever the UI shows. One-time API keys come
// back from issueKey() and rotateKey() only. Callers must keep them in component state,
// never in a store, IndexedDB draft, log or error message.

import { authFetch } from "./auth-fetch";
import { API_URL } from "./env";
import { createMutationId } from "./mutation-id";

export type EndpointStatusCode =
  | "no-api"
  | "serving"
  | "not-found"
  | "unpublished"
  | "disabled"
  | "authority-lost"
  | "publisher-not-admin"
  | "contract-mismatch"
  | "integrity";

export interface ApiRouteInfo {
  id: string;
  method: "GET";
  path: string;
  handler: string;
  description?: string;
  response: Record<string, unknown>;
}

export interface SnapshotSummary {
  id: string;
  apiId: string;
  automationRevision: number;
  runtimeContract: number;
  contentHash: string;
  bundleHash: string;
  publishedBy: string;
  publishedAt: number;
  routeIds: string[];
}

export type RouteChangeKind = "unchanged" | "changed" | "removed" | "added";

export interface CompileError { path?: string; line: number; column: number; message: string }

export interface PublicationEvent {
  action: "api.published" | "api.unpublished" | "api.approval.revoked";
  at: number;
  actorUsername: string;
  reason: string | null;
}

export interface EndpointStatus {
  automationId: string;
  revision: number;
  declared: { contentHash: string; routes: ApiRouteInfo[]; files: string[] } | null;
  compileErrors: CompileError[] | null;
  api: { id: string; slug: string; path: string } | null;
  published: SnapshotSummary | null;
  publishedRoutes: ApiRouteInfo[] | null;
  routeChanges: Array<{ routeId: string; change: RouteChangeKind }>;
  unpublishedChanges: boolean;
  status: EndpointStatusCode;
  lastPublicationEvent: PublicationEvent | null;
}

export interface ApiClient {
  id: string;
  name: string;
  status: "active" | "disabled";
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface ApiClientSummary extends ApiClient { activeKeys: number; activeGrants: number }

export interface ApiCredential {
  id: string;
  clientId: string;
  keyId: string;
  last4: string;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  createdBy: string;
  createdAt: number;
}

export interface ApiGrant {
  id: string;
  clientId: string;
  apiId: string;
  routeId: string;
  routeFingerprint: string;
  access: "read";
  grantedBy: string;
  grantedAt: number;
  revokedAt: number | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export interface ApiGrantWithClient extends ApiGrant { clientName: string; clientStatus: ApiClient["status"] }

export interface ApiClientDetail { client: ApiClient; credentials: ApiCredential[]; grants: ApiGrant[] }

/** The only shape a full key ever arrives in. Hold it in component state alone. */
export interface IssuedKey { key: string; credential: ApiCredential }

export interface AuditEvent {
  id: number;
  at: number;
  actorUsername: string;
  action: string;
  clientId: string | null;
  credentialId: string | null;
  routeId: string | null;
  metadata: Record<string, unknown>;
}

/** A refused request. `reason` is the server's stable cause, such as "slug-retired". */
export class ProjectApiRequestError extends Error {
  constructor(public readonly status: number, message: string, public readonly reason?: string) {
    super(message);
    this.name = "ProjectApiRequestError";
  }
}

const BASE = "/api/project-apis";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const mutating = init.method !== undefined && init.method !== "GET";
  const res = await authFetch(`${API_URL}${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      // Correlates the audit record with this request.
      ...(mutating ? { "X-Aeolus-Mutation-Id": createMutationId() } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: unknown; details?: { reason?: unknown } };
    const reason = typeof body.details?.reason === "string" ? body.details.reason : undefined;
    throw new ProjectApiRequestError(res.status, typeof body.error === "string" ? body.error : `Request failed (${res.status})`, reason);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) => call<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const id = encodeURIComponent;

export const fetchEndpointStatus = (automationId: string) => call<EndpointStatus>(`/${id(automationId)}`);
export const setApiSlug = (automationId: string, slug: string, reclaim = false) =>
  call<{ id: string; slug: string; reclaimedFrom?: string }>(`/${id(automationId)}/slug`, { method: "PUT", body: JSON.stringify(reclaim ? { slug, reclaim } : { slug }) });
export const publishApi = (automationId: string, contentHash: string) => post<SnapshotSummary>(`/${id(automationId)}/publish`, { contentHash });
export const unpublishApi = (automationId: string) => post<{ success: true; revokedGrants: number }>(`/${id(automationId)}/unpublish`);
export const fetchApiGrants = async (automationId: string) => (await call<{ grants: ApiGrantWithClient[] }>(`/${id(automationId)}/grants`)).grants;
export const grantRoute = (automationId: string, clientId: string, routeId: string) => post<ApiGrant>(`/${id(automationId)}/grants`, { clientId, routeId });
export const revokeRouteGrant = (automationId: string, clientId: string, routeId: string) =>
  post<{ revoked: boolean }>(`/${id(automationId)}/grants/revoke`, { clientId, routeId });
export const fetchApiAudit = async (apiId: string, limit = 20) =>
  (await call<{ events: AuditEvent[] }>(`/audit?apiId=${id(apiId)}&limit=${limit}`)).events;

export const fetchClients = async () => (await call<{ clients: ApiClientSummary[] }>("/clients")).clients;
export const createClient = (name: string) => post<ApiClient>("/clients", { name });
export const fetchClient = (clientId: string) => call<ApiClientDetail>(`/clients/${id(clientId)}`);
export const setClientEnabled = (clientId: string, enabled: boolean) => post<ApiClient>(`/clients/${id(clientId)}/${enabled ? "enable" : "disable"}`);
export const issueKey = (clientId: string, expiresAt: number | null) => post<IssuedKey>(`/clients/${id(clientId)}/keys`, { expiresAt });
export const rotateKey = (clientId: string, credentialId: string, expiresAt: number | null, overlapSeconds: number) =>
  post<IssuedKey>(`/clients/${id(clientId)}/keys/${id(credentialId)}/rotate`, { expiresAt, overlapSeconds });
export const revokeKey = (clientId: string, credentialId: string) => post<ApiCredential>(`/clients/${id(clientId)}/keys/${id(credentialId)}/revoke`);

export interface TryResult {
  path: string;
  status: number;
  durationMs: number;
  requestId: string | null;
  retryAfter: string | null;
  body: unknown;
}

/**
 * Call a published route through the server's real /api/exposed pipeline, as a client
 * would. A browser cannot call /api/exposed itself (no CORS), so the server makes the
 * request. The key is sent once in this request body and is not kept anywhere.
 */
export const tryRoute = (automationId: string, routeId: string, params: Record<string, string>, key: string) =>
  post<TryResult>(`/${id(automationId)}/try`, { routeId, params, key });

/** The published snapshot's OpenAPI 3.1 document, as text ready to save. */
export async function fetchOpenApiDocument(automationId: string): Promise<string> {
  return JSON.stringify(await call<Record<string, unknown>>(`/${id(automationId)}/openapi.json`), null, 2);
}
