// frontend/src/components/endpoints/endpoint-format.ts — wording and small helpers for the
// Endpoints section. Kept apart from the components so the rules are tested directly.

import type { ApiCredential, EndpointStatus, EndpointStatusCode } from "../../lib/project-api";

const DAY_MS = 24 * 3600 * 1000;

export function formatWhen(at: number | null | undefined): string {
  if (at === null || at === undefined) return "never";
  return new Date(at).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const shortHash = (hash: string) => hash.slice(0, 12);

/** A key as it may be shown after it was issued: its public id and last four characters. */
export const maskedKey = (credential: Pick<ApiCredential, "keyId" | "last4">) => `aeo_${credential.keyId}_…${credential.last4}`;

export type CredentialState = "active" | "expired" | "revoked";

export function credentialState(credential: Pick<ApiCredential, "expiresAt" | "revokedAt">, now = Date.now()): CredentialState {
  if (credential.revokedAt !== null) return "revoked";
  if (credential.expiresAt !== null && credential.expiresAt <= now) return "expired";
  return "active";
}

/** Expiry choices for a new or replacement key. The policy is always an explicit choice. */
export const EXPIRY_CHOICES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never expires" },
  { value: "custom", label: "On a date…" },
] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]["value"];

/** The expiry timestamp for a choice, null for none, or an error message. */
export function expiryFromChoice(choice: ExpiryChoice, customDate: string, now = Date.now()): { ok: true; expiresAt: number | null } | { ok: false; error: string } {
  if (choice === "never") return { ok: true, expiresAt: null };
  if (choice !== "custom") return { ok: true, expiresAt: now + Number(choice) * DAY_MS };
  const parsed = customDate ? new Date(`${customDate}T23:59:59`).getTime() : Number.NaN;
  if (!Number.isFinite(parsed)) return { ok: false, error: "Choose the date the key should stop working." };
  if (parsed <= now) return { ok: false, error: "Choose a date in the future." };
  return { ok: true, expiresAt: parsed };
}

/** How long a rotated key's predecessor keeps working. */
export const OVERLAP_CHOICES = [
  { value: 0, label: "Revoke the old key now" },
  { value: 3600, label: "Keep the old key for 1 hour" },
  { value: 24 * 3600, label: "Keep the old key for 1 day" },
  { value: 7 * 24 * 3600, label: "Keep the old key for 7 days" },
] as const;

export type StatusTone = "ok" | "warn" | "off" | "error";

export interface StatusExplanation {
  label: string;
  tone: StatusTone;
  /** What it means for callers, and what an admin can do about it. */
  detail: string;
  /** Temporary states keep every grant; they resume on their own once the cause is gone. */
  temporary: boolean;
}

const UNAVAILABLE: Partial<Record<EndpointStatusCode, StatusExplanation>> = {
  disabled: {
    label: "Temporarily unavailable",
    tone: "warn",
    temporary: true,
    detail: "The automation is disabled. Callers get 503 on the routes they are granted. Grants and keys are kept, and serving resumes when the automation is enabled again.",
  },
  "authority-lost": {
    label: "Temporarily unavailable",
    tone: "warn",
    temporary: true,
    detail: "The automation is no longer admin-authored, so it may not serve an API. Grants are kept; serving resumes if admin authority is restored.",
  },
  "contract-mismatch": {
    label: "Needs review after an upgrade",
    tone: "warn",
    temporary: true,
    detail: "This Aeolus version runs handlers under a different runtime contract from the one this snapshot was published against. Callers get 503 on granted routes. Grants are kept; review and republish to serve again.",
  },
  "publisher-not-admin": {
    label: "Unavailable",
    tone: "error",
    temporary: false,
    detail: "The admin who published this is no longer an admin. Republish to approve it again.",
  },
  integrity: {
    label: "Unavailable",
    tone: "error",
    temporary: false,
    detail: "The stored snapshot failed its integrity check, so it is not run. Republish from the current source.",
  },
  "not-found": {
    label: "Unavailable",
    tone: "error",
    temporary: false,
    detail: "The automation behind this API no longer exists.",
  },
};

export function explainStatus(status: Pick<EndpointStatus, "status" | "lastPublicationEvent" | "declared">): StatusExplanation {
  if (status.status === "serving") {
    return { label: "Serving", tone: "ok", temporary: false, detail: "Granted clients can call the published routes." };
  }
  if (status.status === "no-api") {
    return {
      label: "No API yet",
      tone: "off",
      temporary: false,
      detail: status.declared
        ? "Choose a slug to give this automation's API its permanent URL, then publish."
        : "This project declares no endpoints. Add api/routes.json and api/handlers.ts, then save.",
    };
  }
  if (status.status === "unpublished") {
    const event = status.lastPublicationEvent;
    if (event?.action === "api.approval.revoked") {
      const why = event.reason === "publisher-deleted" ? "was deleted" : "is no longer an admin";
      return {
        label: "Approval withdrawn",
        tone: "error",
        temporary: false,
        detail: `The admin who published this ${why}, so the publication was withdrawn on ${formatWhen(event.at)} and every grant revoked. Regaining the admin role restores nothing: republish, then grant access again.`,
      };
    }
    if (event?.action === "api.unpublished") {
      return {
        label: "Unpublished",
        tone: "off",
        temporary: false,
        detail: `Unpublished by ${event.actorUsername} on ${formatWhen(event.at)}. Its grants were revoked permanently; publishing again restores none.`,
      };
    }
    return { label: "Not published", tone: "off", temporary: false, detail: "Nothing is served yet. Review the routes below, then publish." };
  }
  return UNAVAILABLE[status.status] ?? { label: "Unavailable", tone: "error", temporary: false, detail: "This API is not being served." };
}

export const RESPONSE_STATUSES: Array<[string, string]> = [
  ["200", "The handler's JSON, checked against the route's response schema."],
  ["400", "A query string was sent (none are supported), or the handler refused the request."],
  ["401", "No key, or a malformed, unknown, expired or revoked key, or a disabled client. One body for every case."],
  ["404", "No such route, or a route this key is not granted. One body for both, so keys cannot probe for APIs."],
  ["429", "Over 60 requests a minute per key, or more than 2 at once per client. Wait for Retry-After."],
  ["500", "The handler threw, or returned something that breaks its schema. No details are sent."],
  ["503", "A granted route whose API is temporarily unavailable, or every handler sandbox is busy. Retry later."],
  ["504", "The handler did not finish within 5 seconds."],
];

export const EXAMPLE_MANIFEST = `{
  "version": 1,
  "routes": [
    {
      "id": "tank-status",
      "method": "GET",
      "path": "/tanks/:id",
      "handler": "getTank",
      "description": "Level and pump state of one tank",
      "response": {
        "type": "object",
        "properties": {
          "levelPercent": { "type": "number", "minimum": 0, "maximum": 100 },
          "pumpRunning": { "type": "boolean" }
        },
        "required": ["levelPercent", "pumpRunning"],
        "additionalProperties": false
      }
    }
  ]
}
`;

export const EXAMPLE_HANDLER = `// api/handlers.ts: read-only. \`state\` is this automation's own state.
export function getTank(req: { params: { id: string } }) {
  if (req.params.id !== "main") return api.response(404, { error: "Tank not found" });
  return {
    levelPercent: Number(state.get("mainTankLevel") ?? 0),
    pumpRunning: state.get("mainPumpRunning") === true,
  };
}
`;

/** A request example. The key is always a placeholder: no stored key can be shown. */
export function curlExample(url: string): string {
  return `curl -H "Authorization: Bearer $AEOLUS_API_KEY" \\\n  "${url}"`;
}

/** `/tanks/:id` → `/tanks/{id}`, the form callers fill in. */
export const displayPath = (path: string) => path.replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g, "{$1}");

export const AUDIT_LABELS: Record<string, string> = {
  "api.created": "API created",
  "api.slug.changed": "Slug changed",
  "api.slug.reclaimed": "Retired slug reclaimed",
  "api.published": "Published",
  "api.unpublished": "Unpublished",
  "api.approval.revoked": "Approval withdrawn",
  "api.deleted": "API deleted",
  "grant.created": "Access granted",
  "grant.revoked": "Access revoked",
};
