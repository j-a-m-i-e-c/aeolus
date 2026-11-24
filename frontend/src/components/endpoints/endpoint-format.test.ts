import { describe, expect, it } from "vitest";
import type { EndpointStatus } from "../../lib/project-api";
import {
  credentialState, curlExample, displayPath, explainStatus, expiryFromChoice, formatWhen, maskedKey, shortHash,
} from "./endpoint-format";

const DAY = 24 * 3600 * 1000;
const base = (over: Partial<EndpointStatus>): Pick<EndpointStatus, "status" | "lastPublicationEvent" | "declared"> => ({
  status: "serving", lastPublicationEvent: null, declared: { contentHash: "a", routes: [], files: [] }, ...over,
});

describe("endpoint wording", () => {
  it("formats times and masks keys", () => {
    expect(formatWhen(null)).toBe("never");
    expect(formatWhen(undefined)).toBe("never");
    expect(formatWhen(Date.UTC(2026, 0, 2))).toMatch(/2026/);
    expect(shortHash("0123456789abcdef")).toBe("0123456789ab");
    expect(maskedKey({ keyId: "0123456789abcdef", last4: "WXYZ" })).toBe("aeo_0123456789abcdef_…WXYZ");
  });

  it("shows paths the way callers fill them in, and examples only with a placeholder key", () => {
    expect(displayPath("/tanks/:id/levels/:when")).toBe("/tanks/{id}/levels/{when}");
    const example = curlExample("http://aeolus.local:3001/api/exposed/v1/x/level");
    expect(example).toContain("$AEOLUS_API_KEY");
    expect(example).not.toMatch(/aeo_[0-9a-f]{16}_/);
  });

  it("tells active, expired and revoked keys apart", () => {
    expect(credentialState({ expiresAt: null, revokedAt: null }, 10)).toBe("active");
    expect(credentialState({ expiresAt: 11, revokedAt: null }, 10)).toBe("active");
    expect(credentialState({ expiresAt: 10, revokedAt: null }, 10)).toBe("expired");
    expect(credentialState({ expiresAt: 11, revokedAt: 5 }, 10)).toBe("revoked");
  });

  it("makes every expiry an explicit choice", () => {
    const now = Date.UTC(2026, 10, 24, 12);
    expect(expiryFromChoice("never", "", now)).toEqual({ ok: true, expiresAt: null });
    expect(expiryFromChoice("30", "", now)).toEqual({ ok: true, expiresAt: now + 30 * DAY });
    expect(expiryFromChoice("365", "", now)).toEqual({ ok: true, expiresAt: now + 365 * DAY });
    expect(expiryFromChoice("custom", "", now)).toMatchObject({ ok: false, error: expect.stringMatching(/Choose the date/) });
    expect(expiryFromChoice("custom", "not-a-date", now)).toMatchObject({ ok: false });
    expect(expiryFromChoice("custom", "2020-01-01", now)).toMatchObject({ ok: false, error: expect.stringMatching(/future/) });
    const future = expiryFromChoice("custom", "2030-06-30", now);
    expect(future.ok && future.expiresAt).toBe(new Date("2030-06-30T23:59:59").getTime());
  });
});

describe("explaining publication status", () => {
  it("separates temporary unavailability from permanent states", () => {
    for (const status of ["disabled", "authority-lost", "contract-mismatch"] as const) {
      expect(explainStatus(base({ status })), status).toMatchObject({ temporary: true, tone: "warn" });
    }
    expect(explainStatus(base({ status: "disabled" })).detail).toMatch(/Grants and keys are kept/);
    for (const status of ["publisher-not-admin", "integrity", "not-found"] as const) {
      expect(explainStatus(base({ status })), status).toMatchObject({ temporary: false, tone: "error" });
    }
  });

  it("explains serving, no API yet, and an unknown state", () => {
    expect(explainStatus(base({ status: "serving" }))).toMatchObject({ label: "Serving", tone: "ok" });
    expect(explainStatus(base({ status: "no-api" })).detail).toMatch(/Choose a slug/);
    expect(explainStatus(base({ status: "no-api", declared: null })).detail).toMatch(/declares no endpoints/);
    expect(explainStatus(base({ status: "mystery" as never }))).toMatchObject({ label: "Unavailable" });
  });

  it("says why an API is unpublished", () => {
    expect(explainStatus(base({ status: "unpublished" })).label).toBe("Not published");
    expect(explainStatus(base({ status: "unpublished", lastPublicationEvent: { action: "api.unpublished", at: 1, actorUsername: "jamie", reason: null } })))
      .toMatchObject({ label: "Unpublished", detail: expect.stringMatching(/by jamie.*restores none/) });
    const demoted = explainStatus(base({ status: "unpublished", lastPublicationEvent: { action: "api.approval.revoked", at: 1, actorUsername: "user-management", reason: "publisher-demoted" } }));
    expect(demoted).toMatchObject({ label: "Approval withdrawn", tone: "error" });
    expect(demoted.detail).toMatch(/no longer an admin.*Regaining the admin role restores nothing/);
    expect(explainStatus(base({ status: "unpublished", lastPublicationEvent: { action: "api.approval.revoked", at: 1, actorUsername: "x", reason: "publisher-deleted" } })).detail)
      .toMatch(/was deleted/);
  });
});
