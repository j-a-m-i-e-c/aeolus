// showcase-cleanup §12 — the showcase seed must be safe to rerun.
//
// The reported Pi failure was `POST /api/data-store/collections → 409: Collection
// already exists`, and the standing answer was "wipe the database". Both halves of
// that are covered here: the seeder no longer fails when a collection exists, and it
// no longer reaches outside its own fixture set to guarantee that.
//
// The 409 was never purely a rerun problem. `db.write()` auto-creates a collection,
// and several seeded automations write to the very names the seeder declares — `space`
// on `* * * * *`, `wildlife-detection` and `stage-show-sequencer` on simulator
// traffic. Created before the collections, they race the seeding and win. So the
// ordering assertion below is as load-bearing as the tolerance ones.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { seedCollection, seedBucket } from "../../demo/seed/lib.mjs";
import { tabModules } from "../../demo/seed/tabs/index.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

interface Call {
  method: string;
  path: string;
  body?: unknown;
  tolerate?: number[];
}

/**
 * A fake API whose `existing` set decides what is already there.
 *
 * Mirrors the real client's contract: a tolerated status resolves to `null`, an
 * untolerated one throws. That contract is the whole mechanism under test, so the
 * fake has to honour it rather than resolving everything.
 */
function fakeApi(options: { existingCollections?: string[]; bucketKeys?: Record<string, string[]> } = {}) {
  const calls: Call[] = [];
  const existing = new Set(options.existingCollections ?? []);
  const bucketKeys = options.bucketKeys ?? {};

  const api = async (
    method: string,
    reqPath: string,
    body?: unknown,
    opts?: { tolerate?: number[] },
  ): Promise<unknown> => {
    calls.push({ method, path: reqPath, body, ...(opts?.tolerate ? { tolerate: opts.tolerate } : {}) });
    const tolerate = opts?.tolerate ?? [];

    const collectionMatch = /^\/api\/data-store\/collections\/([^/]+)$/.exec(reqPath);
    const bucketMatch = /^\/api\/data-store\/buckets\/([^/]+)$/.exec(reqPath);

    if (method === "DELETE" && collectionMatch) {
      const name = decodeURIComponent(collectionMatch[1]!);
      if (!existing.has(name)) return reject(404, tolerate, method, reqPath);
      existing.delete(name);
      return { success: true };
    }
    if (method === "POST" && reqPath === "/api/data-store/collections") {
      const name = (body as { name: string }).name;
      if (existing.has(name)) return reject(409, tolerate, method, reqPath);
      existing.add(name);
      return { success: true };
    }
    if (method === "PATCH" && collectionMatch) {
      return { success: true };
    }
    if (method === "GET" && bucketMatch) {
      const bucket = decodeURIComponent(bucketMatch[1]!);
      return (bucketKeys[bucket] ?? []).map((key) => ({ key, value: "stale" }));
    }
    return { success: true };
  };

  function reject(status: number, tolerate: number[], method: string, reqPath: string): null {
    if (tolerate.includes(status)) return null;
    throw new Error(`${method} ${reqPath} → ${status}`);
  }

  return { api, calls, existing };
}

const COLLECTION = {
  name: "tank-levels",
  description: "Header tank level history",
  retentionDays: 30,
  records: [
    { payload: { pct: 61 }, timestamp: 1_000 },
    { payload: { pct: 64 }, timestamp: 2_000 },
  ],
};

function pathsFor(calls: Call[], method: string): string[] {
  return calls.filter((call) => call.method === method).map((call) => call.path);
}

describe("seedCollection — rerunnable", () => {
  it("creates the collection and writes its records on a first run", async () => {
    const { api, calls } = fakeApi();
    await seedCollection(api, COLLECTION);

    expect(pathsFor(calls, "POST")).toContain("/api/data-store/collections");
    // Two records, so two record writes — the fixture set, in full.
    expect(pathsFor(calls, "POST").filter((p) => p.endsWith("/records"))).toHaveLength(2);
  });

  it("tolerates deleting a collection that was never there", async () => {
    // The normal first-run case. A 404 here is an answer, not a fault.
    const { api, calls } = fakeApi();
    await seedCollection(api, COLLECTION);

    const del = calls.find((call) => call.method === "DELETE");
    expect(del?.tolerate).toContain(404);
  });

  it("replaces the fixture set on a rerun instead of appending to it", async () => {
    // Records are append-only in the Data Store API and there is no record-level
    // delete, so removing the collection is the only way to reset its contents.
    // Without this a reseed would double every seeded series.
    const { api, calls } = fakeApi({ existingCollections: ["tank-levels"] });
    await seedCollection(api, COLLECTION);

    expect(pathsFor(calls, "DELETE")).toContain("/api/data-store/collections/tank-levels");
    const order = calls.map((call) => `${call.method} ${call.path}`);
    expect(order.indexOf("DELETE /api/data-store/collections/tank-levels")).toBeLessThan(
      order.indexOf("POST /api/data-store/collections"),
    );
  });

  it("adopts a collection an automation auto-created in the gap", async () => {
    // The race the ordering fix makes rare but cannot make impossible: a cron
    // automation calling db.write() between the delete and the create. Previously
    // this threw and aborted the whole seed.
    const raced = fakeApi();
    const api = async (method: string, reqPath: string, body?: unknown, opts?: { tolerate?: number[] }) => {
      // Re-create it immediately after the seeder's delete, as db.write() would.
      const result = await raced.api(method, reqPath, body, opts);
      if (method === "DELETE" && reqPath.includes("/collections/")) raced.existing.add("tank-levels");
      return result;
    };

    await expect(seedCollection(api, COLLECTION)).resolves.toBeUndefined();

    // Brought up to the declared shape rather than left with auto-create defaults:
    // the description and retention are part of what the showcase demonstrates.
    const patch = raced.calls.find((call) => call.method === "PATCH");
    expect(patch?.path).toBe("/api/data-store/collections/tank-levels");
    expect(patch?.body).toEqual({ description: COLLECTION.description, retentionDays: 30 });
  });

  it("tolerates only the conflict on create, never an arbitrary failure", async () => {
    const { api, calls } = fakeApi();
    await seedCollection(api, COLLECTION);

    const create = calls.find((call) => call.method === "POST" && call.path === "/api/data-store/collections");
    expect(create?.tolerate).toEqual([409]);
  });

  it("touches only the collection it was given", async () => {
    // The blast radius. A reseed must not reach an operator's own collections.
    const { api, calls } = fakeApi({ existingCollections: ["tank-levels", "my-own-data"] });
    await seedCollection(api, COLLECTION);

    expect(calls.every((call) => !call.path.includes("my-own-data"))).toBe(true);
    // And never enumerates the store to decide what to remove.
    expect(pathsFor(calls, "GET")).not.toContain("/api/data-store/collections");
  });

  it("defaults retention to null rather than omitting it", async () => {
    const { api, calls } = fakeApi();
    await seedCollection(api, { ...COLLECTION, retentionDays: undefined } as never);

    const create = calls.find((call) => call.path === "/api/data-store/collections");
    expect((create?.body as { retentionDays: unknown }).retentionDays).toBeNull();
  });
});

describe("seedBucket — rerunnable", () => {
  it("clears the bucket's existing keys before writing the declared set", async () => {
    // PUT upserts, so without this a key from an older showcase revision would
    // survive: present, stale, and indistinguishable from a current one.
    const { api, calls } = fakeApi({ bucketKeys: { "showcase-config": ["retired-key", "another"] } });
    await seedBucket(api, { name: "showcase-config", entries: { live: 1 } });

    expect(pathsFor(calls, "DELETE")).toEqual([
      "/api/data-store/buckets/showcase-config/retired-key",
      "/api/data-store/buckets/showcase-config/another",
    ]);
    expect(pathsFor(calls, "PUT")).toEqual(["/api/data-store/buckets/showcase-config/live"]);
  });

  it("touches only its own bucket", async () => {
    const { api, calls } = fakeApi({ bucketKeys: { "showcase-config": ["k"], "operator-bucket": ["secret"] } });
    await seedBucket(api, { name: "showcase-config", entries: { live: 1 } });

    expect(calls.every((call) => !call.path.includes("operator-bucket"))).toBe(true);
    expect(pathsFor(calls, "GET")).not.toContain("/api/data-store/buckets");
  });

  it("survives a bucket that does not exist yet", async () => {
    const { api } = fakeApi();
    await expect(seedBucket(api, { name: "fresh", entries: { a: 1 } })).resolves.toBeUndefined();
  });
});

describe("seed ordering", () => {
  const seedSource = readFileSync(path.join(REPO_ROOT, "demo", "seed", "seed.mjs"), "utf8");

  it("seeds the Data Store before creating automations", () => {
    // Load-bearing, not cosmetic. Automations created first would auto-create these
    // collections via db.write() and win the race, which is the reported 409.
    const dataStore = seedSource.indexOf("seedCollection(api, collection)");
    const automations = seedSource.indexOf("createAutomations(api, allAutomations)");
    expect(dataStore).toBeGreaterThan(-1);
    expect(automations).toBeGreaterThan(-1);
    expect(dataStore).toBeLessThan(automations);
  });

  it("no longer wipes the whole Data Store", () => {
    expect(seedSource).not.toContain("clearDataStore");
  });

  it("declares collections that seeded automations also write to", () => {
    // The premise of the ordering fix. If this ever stops being true the ordering
    // still does no harm, but the reasoning above would no longer apply.
    const declared = new Set(
      tabModules.flatMap((mod: { dataStore?: Array<{ name: string }> }) =>
        (mod.dataStore ?? []).map((collection) => collection.name),
      ),
    );
    for (const written of ["tank-levels", "show-cues", "wildlife-events", "iss-track"]) {
      expect(declared.has(written)).toBe(true);
    }
  });
});
