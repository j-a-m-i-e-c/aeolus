// src/project-api/publication-store.test.ts — code is snapshotted, authority is live,
// and nothing changes without an audit record.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { runMigrations } from "../db/migration-runner.js";
import { migrations } from "../db/migrations/index.js";
import { compileProjectApi, type CompiledProjectApi } from "./api-compiler.js";
import { createProjectApiStore, ProjectApiError, withdrawApprovalsBy, type AuditContext, type ProjectApiStore } from "./publication-store.js";

let db: DatabaseType;
let store: ProjectApiStore;
const ADMIN: AuditContext = { actor: { userId: "u-admin", username: "admin" }, requestId: "req-1" };
const OTHER_ADMIN: AuditContext = { actor: { userId: "u-admin-2", username: "second" }, requestId: "req-2" };

const routes = (handler = "getLevel") => JSON.stringify({
  version: 1,
  routes: [{ id: "level", method: "GET", path: "/level", handler, response: { type: "object" } }],
});

async function compileApi(body = "return { level: 1 };", extra: Record<string, string> = {}): Promise<CompiledProjectApi> {
  const files = { "api/routes.json": routes(), "api/handlers.ts": `export function getLevel() { ${body} }`, ...extra };
  return (await compileProjectApi(Object.entries(files).map(([path, content]) => ({ path, content }))))!;
}

function addAutomation(id: string, authoredUnrestricted = 1): void {
  db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
    VALUES (?, ?, 't', 'script', 1, ?, 1, 1)`).run(id, id, authoredUnrestricted);
}

const revision = (id: string) => (db.prepare("SELECT revision FROM automation_rules WHERE id = ?").get(id) as { revision: number }).revision;
const actions = () => (db.prepare("SELECT action FROM project_api_audit ORDER BY id").all() as Array<{ action: string }>).map((r) => r.action);
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

async function published(automationId = "a1", slug = "tank-levels", body?: string) {
  store.setSlug(automationId, slug, ADMIN);
  const api = await compileApi(body);
  return { api, snapshot: store.publish(automationId, api, revision(automationId), api.contentHash, ADMIN) };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrations);
  for (const [id, role] of [["u-admin", "admin"], ["u-admin-2", "admin"], ["u-user", "user"]]) {
    db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, 'x', ?, 1)").run(id, id, role);
  }
  addAutomation("a1");
  store = createProjectApiStore(db);
});
afterEach(() => db.close());

describe("slugs", () => {
  it("creates an API with a slug, audited", () => {
    const record = store.setSlug("a1", "tank-levels", ADMIN);
    expect(record).toMatchObject({ automationId: "a1", slug: "tank-levels", publishedSnapshotId: null });
    expect(actions()).toEqual(["api.created"]);
  });

  it.each(["ab", "Tank", "-tank", "tank-", "tank--levels", "tank_levels", "tank/levels", "a".repeat(49)])("refuses the slug %j", (slug) => {
    expect(() => store.setSlug("a1", slug, ADMIN)).toThrow(ProjectApiError);
    expect(count("project_apis")).toBe(0);
  });

  it("refuses an automation that is not admin-authored, or does not exist", () => {
    addAutomation("scoped", 0);
    expect(() => store.setSlug("scoped", "scoped-api", ADMIN)).toThrow(/admin-authored/);
    expect(() => store.setSlug("missing", "missing-api", ADMIN)).toThrow(/not found/);
  });

  it("refuses a slug another API uses", () => {
    addAutomation("a2");
    store.setSlug("a1", "tank-levels", ADMIN);
    expect(() => store.setSlug("a2", "tank-levels", ADMIN)).toThrow(/already used/);
  });

  it("retires a changed slug: the old URL stops resolving and cannot be reused silently", async () => {
    await published();
    store.setSlug("a1", "water-levels", ADMIN);
    expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "not-found" });
    expect(store.resolve("water-levels").ok).toBe(true);

    addAutomation("a2");
    expect(() => store.setSlug("a2", "tank-levels", ADMIN)).toThrow(/retired/);
    expect(() => store.setSlug("a1", "tank-levels", ADMIN)).toThrow(/retired/);
  });

  it("reuses a retired slug only when it is explicitly reclaimed, and audits that", () => {
    store.setSlug("a1", "tank-levels", ADMIN);
    store.setSlug("a1", "water-levels", ADMIN);
    addAutomation("a2");
    store.setSlug("a2", "tank-levels", OTHER_ADMIN, true);
    expect(actions()).toEqual(["api.created", "api.slug.changed", "api.slug.reclaimed", "api.created"]);
  });

  it("refuses a retired slug at the database level too", () => {
    store.setSlug("a1", "tank-levels", ADMIN);
    db.prepare("DELETE FROM project_apis").run();
    addAutomation("a2");
    expect(() => db.prepare("INSERT INTO project_apis (id, automation_id, slug, created_at, updated_at) VALUES ('x', 'a2', 'tank-levels', 1, 1)").run())
      .toThrow(/retired/);
  });
});

describe("publishing", () => {
  it("needs a slug first", async () => {
    const api = await compileApi();
    expect(() => store.publish("a1", api, 1, api.contentHash, ADMIN)).toThrow(/slug/);
  });

  it("publishes exactly what was reviewed, recording the snapshot and its hashes", async () => {
    const { api, snapshot } = await published();
    expect(snapshot).toMatchObject({ automationRevision: 1, runtimeContract: 1, contentHash: api.contentHash, bundleHash: api.bundleHash, publishedBy: "u-admin", routeIds: ["level"] });
    const resolution = store.resolve("tank-levels");
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.snapshot.bundle).toBe(api.bundle);
      expect(resolution.snapshot.sources.map((f) => f.path)).toEqual(["api/handlers.ts", "api/routes.json"]);
      expect(resolution.routes.map((r) => r.id)).toEqual(["level"]);
    }
    const [event] = store.listAudit().events;
    expect(event).toMatchObject({ action: "api.published", actorUserId: "u-admin", requestId: "req-1", oldHash: null, newHash: api.contentHash, snapshotId: snapshot.id });
  });

  it("refuses a publish whose source changed after review", async () => {
    store.setSlug("a1", "tank-levels", ADMIN);
    const reviewed = await compileApi("return { level: 1 };");
    const changed = await compileApi("return { level: 2 };");
    expect(() => store.publish("a1", changed, 1, reviewed.contentHash, ADMIN)).toThrow(/changed after it was reviewed/);
  });

  it("refuses a publish when the automation moved on since the compile", async () => {
    store.setSlug("a1", "tank-levels", ADMIN);
    const api = await compileApi();
    db.prepare("UPDATE automation_rules SET revision = 2 WHERE id = 'a1'").run();
    expect(() => store.publish("a1", api, 1, api.contentHash, ADMIN)).toThrow(/changed after it was reviewed/);
    expect(count("project_api_snapshots")).toBe(0);
  });

  it("refuses to publish once the automation is no longer admin-authored", async () => {
    store.setSlug("a1", "tank-levels", ADMIN);
    db.prepare("UPDATE automation_rules SET authored_unrestricted = 0 WHERE id = 'a1'").run();
    const api = await compileApi();
    expect(() => store.publish("a1", api, 1, api.contentHash, ADMIN)).toThrow(/admin-authored/);
  });

  it("keeps serving the old snapshot after the source is edited, and reports the difference", async () => {
    const { api, snapshot } = await published();
    db.prepare("UPDATE automation_rules SET revision = 2 WHERE id = 'a1'").run();
    const edited = await compileApi("return { level: 2 };");
    expect(edited.contentHash).not.toBe(api.contentHash);
    const resolution = store.resolve("tank-levels");
    expect(resolution.ok && resolution.snapshot.id).toBe(snapshot.id);
    expect(resolution.ok && resolution.snapshot.bundle).toBe(api.bundle);
  });

  it("treats snapshots as immutable, even through direct SQL", async () => {
    await published();
    expect(() => db.prepare("UPDATE project_api_snapshots SET bundle = 'tampered'").run()).toThrow(/immutable/);
  });
});

describe("serving fails closed on live facts", () => {
  it("stops when the automation is disabled, and resumes when it is enabled again", async () => {
    await published();
    db.prepare("UPDATE automation_rules SET enabled = 0").run();
    const unavailable = store.resolve("tank-levels");
    // The API and its routes come back too, so the router can check the caller's
    // grant for the route before it admits the API is unavailable.
    expect(unavailable).toMatchObject({ ok: false, reason: "disabled", api: { slug: "tank-levels" } });
    expect("routes" in unavailable && unavailable.routes.length).toBeGreaterThan(0);
    db.prepare("UPDATE automation_rules SET enabled = 1").run();
    expect(store.resolve("tank-levels").ok).toBe(true);
  });

  it("stops when the automation loses admin authority", async () => {
    await published();
    db.prepare("UPDATE automation_rules SET authored_unrestricted = 0").run();
    expect(store.resolve("tank-levels")).toMatchObject({ ok: false, reason: "authority-lost" });
  });

  it("withdraws approval durably when the publisher is demoted, so promotion back restores nothing", async () => {
    const { snapshot } = await published();
    // Demote and promote again, with no request resolving the API in between.
    db.prepare("UPDATE users SET role = 'user' WHERE id = 'u-admin'").run();
    db.prepare("UPDATE users SET role = 'admin' WHERE id = 'u-admin'").run();
    expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "unpublished" });
    expect(store.get("a1")?.publishedSnapshotId).toBeNull();
    expect(store.snapshotSummary(snapshot.id)).not.toBeNull();
    const revoked = store.listAudit().events.find((e) => e.action === "api.approval.revoked")!;
    expect(revoked).toMatchObject({ actorUserId: "system", snapshotId: snapshot.id, metadata: { reason: "publisher-demoted", publisherUserId: "u-admin" } });
  });

  it("withdraws approval when the publisher is deleted", async () => {
    await published();
    db.prepare("DELETE FROM users WHERE id = 'u-admin'").run();
    expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "unpublished" });
    expect(store.listAudit().events[0]).toMatchObject({ action: "api.approval.revoked", metadata: { reason: "publisher-deleted" } });
  });

  it("records the acting admin when user management withdraws approval itself", async () => {
    await published();
    db.transaction(() => {
      expect(withdrawApprovalsBy(db, "u-admin", OTHER_ADMIN, "publisher-demoted")).toBe(1);
      db.prepare("UPDATE users SET role = 'user' WHERE id = 'u-admin'").run();
    })();
    const events = store.listAudit().events.filter((e) => e.action === "api.approval.revoked");
    // The trigger found nothing left to withdraw, so there is exactly one record, by the admin.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorUserId: "u-admin-2", requestId: "req-2" });
  });

  it("leaves other admins' publications alone", async () => {
    addAutomation("a2");
    store.setSlug("a2", "pump-status", OTHER_ADMIN);
    const other = await compileApi("return { pump: true };");
    store.publish("a2", other, 1, other.contentHash, OTHER_ADMIN);
    await published();
    db.prepare("UPDATE users SET role = 'user' WHERE id = 'u-admin'").run();
    expect(store.resolve("pump-status").ok).toBe(true);
    expect(store.resolve("tank-levels").ok).toBe(false);
  });

  it("still refuses to serve while the publisher is not an admin, even if the triggers were removed", async () => {
    await published();
    db.exec("DROP TRIGGER project_api_publisher_demoted");
    db.prepare("UPDATE users SET role = 'user' WHERE id = 'u-admin'").run();
    expect(store.resolve("tank-levels")).toMatchObject({ ok: false, reason: "publisher-not-admin" });
  });

  it("does not withdraw anything when a non-admin is demoted or deleted", async () => {
    await published();
    db.prepare("DELETE FROM users WHERE id = 'u-user'").run();
    expect(store.resolve("tank-levels").ok).toBe(true);
    expect(withdrawApprovalsBy(db, "u-user", ADMIN, "publisher-deleted")).toBe(0);
  });

  it("stops when this server's runtime contract differs from the snapshot's", async () => {
    await published();
    expect(createProjectApiStore(db, { runtimeContract: 2 }).resolve("tank-levels")).toMatchObject({ ok: false, reason: "contract-mismatch" });
  });

  it("stops when a stored bundle no longer matches its hash", async () => {
    await published();
    db.exec("DROP TRIGGER project_api_snapshots_immutable");
    db.prepare("UPDATE project_api_snapshots SET bundle = bundle || ' '").run();
    expect(store.resolve("tank-levels")).toMatchObject({ ok: false, reason: "integrity" });
  });

  it("stops on unpublish at once, keeping the snapshot as history", async () => {
    await published();
    store.unpublish("a1", ADMIN);
    expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "unpublished" });
    expect(count("project_api_snapshots")).toBe(1);
    expect(actions()).toEqual(["api.created", "api.published", "api.unpublished"]);
  });

  it("returns not-found for an unknown slug", () => {
    expect(store.resolve("nothing-here")).toEqual({ ok: false, reason: "not-found" });
  });

  it("treats a stored manifest that no longer parses as a contract mismatch", async () => {
    await published();
    db.exec("DROP TRIGGER project_api_snapshots_immutable");
    db.prepare("UPDATE project_api_snapshots SET manifest = '{\"version\": 9}'").run();
    expect(store.resolve("tank-levels")).toMatchObject({ ok: false, reason: "contract-mismatch" });
    const summary = store.snapshotSummary(store.get("a1")!.publishedSnapshotId!);
    expect(summary?.routeIds).toEqual([]);
    db.prepare("UPDATE project_api_snapshots SET manifest = 'not json'").run();
    expect(store.snapshotSummary(store.get("a1")!.publishedSnapshotId!)?.routeIds).toEqual([]);
  });

  it("treats unreadable stored sources as an integrity failure", async () => {
    await published();
    db.exec("DROP TRIGGER project_api_snapshots_immutable");
    db.prepare("UPDATE project_api_snapshots SET sources = 'not json'").run();
    expect(store.resolve("tank-levels")).toMatchObject({ ok: false, reason: "integrity" });
  });

  it("treats a pointer to a missing or foreign snapshot as unpublished", async () => {
    await published();
    db.prepare("UPDATE project_apis SET published_snapshot_id = 'missing'").run();
    expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "unpublished" });
    expect(store.snapshotSummary("missing")).toBeNull();

    addAutomation("a2");
    store.setSlug("a2", "pump-status", ADMIN);
    const other = await compileApi("return { pump: true };");
    const foreign = store.publish("a2", other, 1, other.contentHash, ADMIN);
    db.prepare("UPDATE project_apis SET published_snapshot_id = ? WHERE automation_id = 'a1'").run(foreign.id);
    expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "unpublished" });
  });
});

describe("no-op and edge operations", () => {
  it("leaves an unchanged slug alone without an audit record", () => {
    store.setSlug("a1", "tank-levels", ADMIN);
    expect(store.setSlug("a1", "tank-levels", ADMIN).slug).toBe("tank-levels");
    expect(actions()).toEqual(["api.created"]);
  });

  it("reclaims a retired slug for an API that already exists, recording both ids", () => {
    addAutomation("a2");
    store.setSlug("a1", "tank-levels", ADMIN);
    store.setSlug("a1", "water-levels", ADMIN);
    const second = store.setSlug("a2", "pump-status", ADMIN);
    store.setSlug("a2", "tank-levels", ADMIN, true);
    const reclaim = store.listAudit().events.find((e) => e.action === "api.slug.reclaimed")!;
    expect(reclaim).toMatchObject({ apiId: second.id, metadata: { slug: "tank-levels", previousApiId: store.get("a1")!.id } });
    expect(store.get("a2")?.slug).toBe("tank-levels");
  });

  it("unpublishing something not published changes nothing and is not audited", () => {
    store.setSlug("a1", "tank-levels", ADMIN);
    store.unpublish("a1", ADMIN);
    expect(actions()).toEqual(["api.created"]);
    expect(() => store.unpublish("missing", ADMIN)).toThrow(/no API/);
  });

  it("deleting an automation without an API does nothing", () => {
    store.deleteForAutomation("a1", ADMIN);
    expect(actions()).toEqual([]);
  });

  it("reports empty storage", () => {
    expect(store.storageStats()).toEqual({ auditEvents: 0, auditBytes: 0, snapshots: 0, snapshotBytes: 0 });
    expect(store.get("a1")).toBeNull();
  });
});

describe("resolve without an automation row", () => {
  it("returns not-found when the API outlives its automation (foreign keys off)", async () => {
    await published();
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM automation_rules WHERE id = 'a1'").run();
    expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("reverting source", () => {
  it("never revives an old publication: publishing identical content records a new snapshot", async () => {
    const first = await published("a1", "tank-levels", "return { level: 1 };");
    db.prepare("UPDATE automation_rules SET revision = 2").run();
    const v2 = await compileApi("return { level: 2 };");
    store.publish("a1", v2, 2, v2.contentHash, ADMIN);
    store.unpublish("a1", ADMIN);

    // The source goes back to exactly what the first snapshot approved.
    db.prepare("UPDATE automation_rules SET revision = 3").run();
    const reverted = await compileApi("return { level: 1 };");
    expect(reverted.contentHash).toBe(first.api.contentHash);
    expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "unpublished" });

    const again = store.publish("a1", reverted, 3, reverted.contentHash, OTHER_ADMIN);
    expect(again.id).not.toBe(first.snapshot.id);
    expect(again).toMatchObject({ publishedBy: "u-admin-2", automationRevision: 3 });
    expect(count("project_api_snapshots")).toBe(3);
  });
});

describe("deleting the automation", () => {
  it("removes its API and snapshots, retires the slug, and audits it in the same transaction", async () => {
    await published();
    db.transaction(() => {
      store.deleteForAutomation("a1", ADMIN);
      db.prepare("DELETE FROM automation_rules WHERE id = 'a1'").run();
    })();
    expect(count("project_apis")).toBe(0);
    expect(count("project_api_snapshots")).toBe(0);
    expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "not-found" });
    expect(actions().at(-1)).toBe("api.deleted");
    addAutomation("a2");
    expect(() => store.setSlug("a2", "tank-levels", ADMIN)).toThrow(/retired/);
  });

  it("restores everything when the automation delete itself fails", async () => {
    await published();
    expect(() => db.transaction(() => {
      store.deleteForAutomation("a1", ADMIN);
      throw new Error("revision conflict");
    })()).toThrow(/revision conflict/);
    expect(store.resolve("tank-levels").ok).toBe(true);
    expect(actions()).not.toContain("api.deleted");
  });

  it("retires the slug even when only the foreign-key cascade removes the API", async () => {
    await published();
    db.prepare("DELETE FROM automation_rules WHERE id = 'a1'").run();
    expect(count("project_apis")).toBe(0);
    expect(db.prepare("SELECT slug FROM project_api_retired_slugs").all()).toEqual([{ slug: "tank-levels" }]);
  });
});

describe("audit history", () => {
  it("is append-only at the database level", async () => {
    await published();
    expect(() => db.prepare("UPDATE project_api_audit SET action = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM project_api_audit").run()).toThrow(/append-only/);
  });

  it("stores no source, bundle or credential material in its records", async () => {
    const { api } = await published("a1", "tank-levels", 'return { secret: "BUNDLE_MARKER" };');
    const rows = JSON.stringify(db.prepare("SELECT * FROM project_api_audit").all());
    expect(rows).not.toContain("BUNDLE_MARKER");
    expect(rows).not.toContain(api.bundle.slice(0, 40));
  });

  describe("when an audit record cannot be written, the change does not happen", () => {
    // Installed inside each test, after setup, so only the operation under test fails.
    const failAudit = () => db.exec(`CREATE TEMP TRIGGER fail_audit BEFORE INSERT ON project_api_audit
      BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);

    it("for creating a slug", () => {
      failAudit();
      expect(() => store.setSlug("a1", "tank-levels", ADMIN)).toThrow(/disk full/);
      expect(count("project_apis")).toBe(0);
    });

    it("for renaming a slug", () => {
      store.setSlug("a1", "tank-levels", ADMIN);
      failAudit();
      expect(() => store.setSlug("a1", "water-levels", ADMIN)).toThrow(/disk full/);
      expect(store.get("a1")?.slug).toBe("tank-levels");
      expect(count("project_api_retired_slugs")).toBe(0);
    });

    it("for publishing", async () => {
      store.setSlug("a1", "tank-levels", ADMIN);
      const api = await compileApi();
      failAudit();
      expect(() => store.publish("a1", api, 1, api.contentHash, ADMIN)).toThrow(/disk full/);
      expect(count("project_api_snapshots")).toBe(0);
      expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "unpublished" });
    });

    it("for unpublishing", async () => {
      await published();
      failAudit();
      expect(() => store.unpublish("a1", ADMIN)).toThrow(/disk full/);
      expect(store.resolve("tank-levels").ok).toBe(true);
    });

    it("for deleting the automation", async () => {
      await published();
      failAudit();
      expect(() => db.transaction(() => {
        store.deleteForAutomation("a1", ADMIN);
        db.prepare("DELETE FROM automation_rules WHERE id = 'a1'").run();
      })()).toThrow(/disk full/);
      expect(count("automation_rules")).toBe(1);
      expect(store.resolve("tank-levels").ok).toBe(true);
    });
  });

  it("pages newest first, filters by API, and reports storage", async () => {
    await published();
    for (let i = 0; i < 4; i++) { store.unpublish("a1", ADMIN); const api = await compileApi(`return { level: ${i} };`); store.publish("a1", api, 1, api.contentHash, ADMIN); }
    const first = store.listAudit({ limit: 3 });
    expect(first.events.map((e) => e.action)).toEqual(["api.published", "api.unpublished", "api.published"]);
    const second = store.listAudit({ limit: 3, before: first.nextBefore! });
    expect(second.events[0]!.id).toBeLessThan(first.events[2]!.id);
    const all = store.listAudit({ limit: 500 });
    expect(all.events).toHaveLength(10);
    expect(all.nextBefore).toBeNull();
    expect(store.listAudit({ apiId: "other" }).events).toEqual([]);
    expect(store.storageStats()).toMatchObject({ auditEvents: 10, snapshots: 5 });
    expect(store.storageStats().snapshotBytes).toBeGreaterThan(0);
  });
});
