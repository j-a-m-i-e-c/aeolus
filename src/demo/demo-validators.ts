// src/demo/demo-validators.ts — Demo-specific validation for the two visitor-
// writable routes (automation state write and fire). These run from the
// PublicDemoGuard for public-demo sessions ONLY; normal sessions never reach
// them, so authoring/admin behaviour is unchanged.
//
// They complement (never replace) the routes' own Zod validation and resource
// authorization. Their job is to keep a public visitor inside a bounded
// interaction envelope: small, allowlisted state keys and declared fire events,
// with no arbitrary automation context.

import type { Request } from "express";
import { BadRequestError, ForbiddenError } from "../api/middleware/error-handler.js";
import type { DemoRuleAccessReader } from "./demo-rule-access.js";
import type { AutomationStateStore } from "../automations/automation-state-store.js";

/** Maximum length of a state key a demo visitor may write. */
export const DEMO_MAX_KEY_LENGTH = 64;
/** Maximum serialized value size (bytes) a demo visitor may write. */
export const DEMO_MAX_VALUE_BYTES = 8 * 1024;
/** Maximum number of state keys a single automation may hold under demo writes. */
export const DEMO_MAX_KEYS_PER_RULE = 100;
/**
 * Dedicated small request-body cap for demo mutations, well below the global
 * 1 MB limit (Req 6.5). Enforced from the Content-Length header so an oversized
 * body is rejected regardless of the parsed value.
 */
export const DEMO_MAX_BODY_BYTES = 16 * 1024;

/** Reject a demo mutation whose declared body size exceeds the demo cap. */
function assertBodyWithinDemoLimit(req: Request): void {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > DEMO_MAX_BODY_BYTES) {
    throw new BadRequestError(`Request body exceeds the ${DEMO_MAX_BODY_BYTES}-byte demo limit`);
  }
}

export interface DemoValidatorDeps {
  getDemoRuleAccess: DemoRuleAccessReader;
  stateStore: AutomationStateStore;
}

/**
 * Validate a public-demo `PUT /api/automations/:id/state` before persistence.
 *
 * Rejects (4xx, store untouched) when: the key is missing/oversized; the
 * serialized value exceeds the byte cap; the rule already holds the key cap and
 * this write introduces a new key; or the rule declares `writableStateKeys` and
 * the key is not among them.
 */
export function makeDemoStateWriteValidator(deps: DemoValidatorDeps): (req: Request) => void {
  return function validateDemoStateWrite(req: Request, params: Record<string, string> = {}): void {
    assertBodyWithinDemoLimit(req);
    const ruleId = params.id ?? req.params?.id;
    const body = (req.body ?? {}) as { key?: unknown; value?: unknown };
    const { key, value } = body;

    if (typeof key !== "string" || key.length === 0) {
      throw new BadRequestError("A non-empty string 'key' is required");
    }
    if (key.length > DEMO_MAX_KEY_LENGTH) {
      throw new BadRequestError(`State key exceeds the ${DEMO_MAX_KEY_LENGTH}-character demo limit`);
    }

    // Byte size of the serialized value (undefined serializes as null).
    let serializedBytes: number;
    try {
      serializedBytes = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
    } catch {
      throw new BadRequestError("State value is not serializable");
    }
    if (serializedBytes > DEMO_MAX_VALUE_BYTES) {
      throw new BadRequestError(`State value exceeds the ${DEMO_MAX_VALUE_BYTES}-byte demo limit`);
    }

    // Per-rule writable-key allowlist (preferred stricter policy).
    const access = ruleId ? deps.getDemoRuleAccess(ruleId) : undefined;
    if (access?.writableStateKeys && !access.writableStateKeys.includes(key)) {
      throw new ForbiddenError("This state key is not writable in the public demo");
    }

    // Key-count cap: only blocks *new* keys once the rule is at the limit.
    if (ruleId) {
      const existing = deps.stateStore.getAll(ruleId);
      const isNewKey = !Object.prototype.hasOwnProperty.call(existing, key);
      if (isNewKey && Object.keys(existing).length >= DEMO_MAX_KEYS_PER_RULE) {
        throw new BadRequestError(
          `This automation has reached the ${DEMO_MAX_KEYS_PER_RULE}-key demo limit`,
        );
      }
    }
  };
}

/**
 * Validate a public-demo `POST /api/automations/:id/fire` before dispatch.
 *
 * A demo visitor may only fire in the `{ eventName, payload? }` form. Supplying
 * a `context` (topic/deviceId/state) override is rejected, so trusted Seeded
 * Logic never receives a visitor-chosen trigger context. When the rule declares
 * `fireEvents`, only those event names are accepted.
 */
export function makeDemoFireValidator(deps: DemoValidatorDeps): (req: Request) => void {
  return function validateDemoFire(req: Request, params: Record<string, string> = {}): void {
    assertBodyWithinDemoLimit(req);
    const ruleId = params.id ?? req.params?.id;
    const body = (req.body ?? {}) as { context?: unknown; eventName?: unknown };

    if ("context" in body && body.context !== undefined) {
      throw new ForbiddenError("Custom automation context is not allowed in the public demo");
    }

    const eventName = body.eventName;
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new BadRequestError("A non-empty 'eventName' is required in the public demo");
    }

    const access = ruleId ? deps.getDemoRuleAccess(ruleId) : undefined;
    if (access?.fireEvents && !access.fireEvents.includes(eventName)) {
      throw new ForbiddenError("This event is not allowed in the public demo");
    }
  };
}
