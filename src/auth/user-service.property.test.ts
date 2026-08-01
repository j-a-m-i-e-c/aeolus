// Feature: admin-user-management — property-based tests for role management
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fc } from "@fast-check/vitest";
import Database from "better-sqlite3";
import { initSchema } from "../db/database.js";

let testDb: InstanceType<typeof Database>;

// Hashing is irrelevant to role/guard logic; stub bcrypt so 100 property runs
// don't pay the real cost-12 hashing latency (which otherwise times the test out).
vi.mock("bcrypt", () => ({
  default: {
    hash: async () => "stub-hash",
    compare: async () => true,
  },
}));

vi.mock("../db/database.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/database.js")>();
  return {
    ...original,
    getDatabase: () => testDb,
  };
});

const { createUser, updateUser, deleteUser, getUser } = await import(
  "./user-service.js"
);

/** Count current admins directly from the DB. */
function adminCount(): number {
  const { count } = testDb
    .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
    .get() as { count: number };
  return count;
}

/** Reset to a known baseline: a single admin plus a group to reference. */
function reset(): void {
  testDb.exec("DELETE FROM users");
  testDb
    .prepare(
      `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
       VALUES ('seed-admin', 'seedadmin', 'hash', 'admin', NULL, ?)`,
    )
    .run(Date.now());
}

beforeEach(() => {
  testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  initSchema(testDb);
  testDb
    .prepare("INSERT INTO groups (id, name, created_at) VALUES ('g1', 'G1', ?)")
    .run(Date.now());
});

afterEach(() => {
  testDb.close();
});

describe("user-service role management (properties)", () => {
  // Feature: admin-user-management, Property 1: The admin population never drops to zero
  it("never drives the admin count from 1 to 0 across any op sequence", async () => {
    type Op =
      | { kind: "createAdmin" }
      | { kind: "createUser" }
      | { kind: "promoteFirstUser" }
      | { kind: "demoteAnAdmin" }
      | { kind: "deleteAnAdmin" };

    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.constant({ kind: "createAdmin" as const }),
      fc.constant({ kind: "createUser" as const }),
      fc.constant({ kind: "promoteFirstUser" as const }),
      fc.constant({ kind: "demoteAnAdmin" as const }),
      fc.constant({ kind: "deleteAnAdmin" as const }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 25 }), async (ops) => {
        reset();
        let seq = 0;
        for (const op of ops) {
          expect(adminCount()).toBeGreaterThanOrEqual(1);
          const uname = `u${seq++}`;
          try {
            if (op.kind === "createAdmin") {
              await createUser(uname, "password123", null, "admin");
            } else if (op.kind === "createUser") {
              await createUser(uname, "password123", null, "user");
            } else if (op.kind === "promoteFirstUser") {
              const row = testDb
                .prepare("SELECT id FROM users WHERE role = 'user' LIMIT 1")
                .get() as { id: string } | undefined;
              if (row) await updateUser(row.id, { role: "admin" });
            } else if (op.kind === "demoteAnAdmin") {
              const row = testDb
                .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
                .get() as { id: string } | undefined;
              if (row) await updateUser(row.id, { role: "user" });
            } else if (op.kind === "deleteAnAdmin") {
              const row = testDb
                .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
                .get() as { id: string } | undefined;
              if (row) deleteUser(row.id);
            }
          } catch {
            // Rejections (e.g. last-admin guard) are expected; the invariant
            // below is what must hold.
          }
          expect(adminCount()).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: admin-user-management, Property 2: Role updates are exact and side-effect-isolated
  it("applies role exactly (or leaves it) and applies group independently", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<"admin" | "user">("admin", "user"),
        fc.option(fc.constantFrom<"admin" | "user">("admin", "user"), {
          nil: undefined,
        }),
        fc.boolean(),
        async (startRole, updateRole, changeGroup) => {
          reset();
          // A second admin guarantees demotion is never blocked by the guard,
          // isolating this property from the last-admin safeguard.
          testDb
            .prepare(
              `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
               VALUES ('guard-admin', 'guardadmin', 'hash', 'admin', NULL, ?)`,
            )
            .run(Date.now());

          const user = await createUser("subject", "password123", null, startRole);
          const updates: {
            role?: "admin" | "user";
            groupId?: string | null;
          } = {};
          if (updateRole !== undefined) updates.role = updateRole;
          if (changeGroup) updates.groupId = "g1";

          const updated = await updateUser(user.id, updates);

          const expectedRole = updateRole ?? startRole;
          expect(updated.role).toBe(expectedRole);
          expect(getUser(user.id)!.role).toBe(expectedRole);
          if (changeGroup) {
            expect(updated.groupId).toBe("g1");
          } else {
            expect(updated.groupId).toBe(user.groupId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
