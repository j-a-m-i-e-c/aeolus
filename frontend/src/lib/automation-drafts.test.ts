// frontend/src/lib/automation-drafts.test.ts — IndexedDB draft store
//
// jsdom has no IndexedDB, so these run against fake-indexeddb's in-memory
// implementation. The fake is installed here rather than in test-setup.ts so the
// rest of the suite still runs without IndexedDB and cannot come to depend on it
// by accident.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  readAutomationDraft,
  putAutomationDraft,
  deleteAutomationDraft,
  type DraftSnapshot,
} from "./automation-drafts";

const DB_NAME = "aeolus-automation-drafts";
const STORE_NAME = "snapshots";

interface Project { files: Array<{ path: string; content: string }> }

function snapshot(key: string, content: string, savedAt = 1_000): DraftSnapshot<Project> {
  return {
    key,
    baseline: JSON.stringify({ files: [{ path: "logic/index.ts", content: "// server" }] }),
    payload: { files: [{ path: "logic/index.ts", content }] },
    savedAt,
  };
}

/** Open the raw database to assert on structure the public API does not expose. */
function openRaw(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

beforeEach(() => {
  // A pristine factory per test: the module keeps no cross-test state beyond the
  // database itself, and the write queue drains as each test awaits.
  globalThis.indexedDB = new IDBFactory() as unknown as IDBFactory & typeof globalThis.indexedDB;
});

describe("automation draft store", () => {
  describe("round trip", () => {
    it("returns a stored snapshot unchanged", async () => {
      const draft = snapshot("user-a:page:rule-1", "// local edit", 1234);
      await putAutomationDraft(draft);

      expect(await readAutomationDraft<Project>("user-a:page:rule-1")).toEqual(draft);
    });

    it("resolves to undefined when no draft was ever stored", async () => {
      // The hook distinguishes "nothing to offer" from "storage is broken", so
      // a missing key must resolve rather than reject.
      await expect(readAutomationDraft("user-a:page:never-edited")).resolves.toBeUndefined();
    });

    it("resolves to undefined after the draft is deleted", async () => {
      await putAutomationDraft(snapshot("user-a:page:rule-1", "// local edit"));
      await deleteAutomationDraft("user-a:page:rule-1");

      expect(await readAutomationDraft("user-a:page:rule-1")).toBeUndefined();
    });

    it("deleting a key that holds no draft is not an error", async () => {
      await expect(deleteAutomationDraft("user-a:page:absent")).resolves.toBeUndefined();
    });
  });

  describe("store creation", () => {
    it("creates the snapshots store keyed by key on first use", async () => {
      await putAutomationDraft(snapshot("user-a:page:rule-1", "// local edit"));

      const db = await openRaw();
      expect(Array.from(db.objectStoreNames)).toContain(STORE_NAME);
      const keyPath = db.transaction(STORE_NAME).objectStore(STORE_NAME).keyPath;
      expect(keyPath).toBe("key");
      db.close();
    });

    it("reuses the existing store across many separate operations", async () => {
      // Each call opens its own connection and closes it on completion. If a
      // connection leaked, or the store were recreated, these would block.
      for (let i = 0; i < 5; i++) {
        await putAutomationDraft(snapshot("user-a:page:rule-1", `// edit ${i}`, i));
      }
      expect((await readAutomationDraft<Project>("user-a:page:rule-1"))?.savedAt).toBe(4);
    });
  });

  describe("key isolation", () => {
    it("keeps one user's draft out of another user's editor", async () => {
      await putAutomationDraft(snapshot("user-a:page:rule-1", "// belongs to A"));
      await putAutomationDraft(snapshot("user-b:page:rule-1", "// belongs to B"));

      const a = await readAutomationDraft<Project>("user-a:page:rule-1");
      const b = await readAutomationDraft<Project>("user-b:page:rule-1");
      expect(a?.payload.files[0].content).toBe("// belongs to A");
      expect(b?.payload.files[0].content).toBe("// belongs to B");
    });

    it("separates the page editor from a dashboard pane for the same automation", async () => {
      await putAutomationDraft(snapshot("user-a:page:rule-1", "// from the page"));
      await putAutomationDraft(snapshot("user-a:pane:rule-1", "// from the pane"));

      expect((await readAutomationDraft<Project>("user-a:page:rule-1"))?.payload.files[0].content)
        .toBe("// from the page");
      expect((await readAutomationDraft<Project>("user-a:pane:rule-1"))?.payload.files[0].content)
        .toBe("// from the pane");
    });

    it("overwrites the same key instead of accumulating snapshots", async () => {
      await putAutomationDraft(snapshot("user-a:page:rule-1", "// first", 1));
      await putAutomationDraft(snapshot("user-a:page:rule-1", "// second", 2));

      const db = await openRaw();
      const count = await new Promise<number>((resolve, reject) => {
        const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();

      expect(count).toBe(1);
      expect((await readAutomationDraft<Project>("user-a:page:rule-1"))?.savedAt).toBe(2);
    });
  });

  // The property the sequence() queue exists to guarantee. Without it, an
  // autosave put can land after the delete issued by a successful save, leaving
  // a stale draft that the editor then offers as "unsaved work" over the version
  // the author just saved.
  describe("write serialization", () => {
    it("lets a save acknowledgement win over an autosave write already in flight", async () => {
      const put = putAutomationDraft(snapshot("user-a:page:rule-1", "// mid-flight autosave"));
      const remove = deleteAutomationDraft("user-a:page:rule-1");

      await Promise.all([put, remove]);

      expect(await readAutomationDraft("user-a:page:rule-1")).toBeUndefined();
    });

    it("applies same-key writes in call order, not completion order", async () => {
      const first = putAutomationDraft(snapshot("user-a:page:rule-1", "// first", 1));
      const second = putAutomationDraft(snapshot("user-a:page:rule-1", "// second", 2));
      const third = putAutomationDraft(snapshot("user-a:page:rule-1", "// third", 3));

      await Promise.all([first, second, third]);

      const stored = await readAutomationDraft<Project>("user-a:page:rule-1");
      expect(stored?.savedAt).toBe(3);
      expect(stored?.payload.files[0].content).toBe("// third");
    });

    it("does not make unrelated editors wait on each other", async () => {
      await Promise.all([
        putAutomationDraft(snapshot("user-a:page:rule-1", "// one")),
        putAutomationDraft(snapshot("user-a:page:rule-2", "// two")),
        putAutomationDraft(snapshot("user-b:pane:rule-3", "// three")),
      ]);

      expect((await readAutomationDraft<Project>("user-a:page:rule-1"))?.payload.files[0].content).toBe("// one");
      expect((await readAutomationDraft<Project>("user-a:page:rule-2"))?.payload.files[0].content).toBe("// two");
      expect((await readAutomationDraft<Project>("user-b:pane:rule-3"))?.payload.files[0].content).toBe("// three");
    });

    it("keeps serving a key after one of its writes fails", async () => {
      const working = globalThis.indexedDB;
      // Fail only the first write, then restore storage. The queue chains on the
      // previous promise, so without its catch a single failure would stall every
      // later write for that key.
      globalThis.indexedDB = {
        open: () => {
          const req = { error: new Error("storage unavailable"), result: null } as unknown as IDBOpenDBRequest;
          setTimeout(() => req.onerror?.(new Event("error") as Event & { target: IDBRequest }), 0);
          return req;
        },
      } as unknown as typeof globalThis.indexedDB;

      await expect(putAutomationDraft(snapshot("user-a:page:rule-1", "// lost"))).rejects.toThrow();

      globalThis.indexedDB = working;
      await expect(putAutomationDraft(snapshot("user-a:page:rule-1", "// recovered", 9))).resolves.toBeUndefined();
      expect((await readAutomationDraft<Project>("user-a:page:rule-1"))?.savedAt).toBe(9);
    });
  });

  describe("storage failure", () => {
    afterEach(() => vi.restoreAllMocks());

    it("rejects when the database cannot be opened", async () => {
      // A newer build that bumped the schema leaves an older tab unable to open
      // version 1. That must surface, not silently look like "no draft".
      const bumped = await openRaw(2);
      bumped.close();

      await expect(readAutomationDraft("user-a:page:rule-1")).rejects.toBeTruthy();
    });

    it("rejects a write when the object store has been removed underneath it", async () => {
      await putAutomationDraft(snapshot("user-a:page:rule-1", "// local edit"));

      // Drop the store at a higher version; the next transaction cannot find it.
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 3);
        req.onupgradeneeded = () => req.result.deleteObjectStore(STORE_NAME);
        req.onsuccess = () => { req.result.close(); resolve(); };
        req.onerror = () => reject(req.error);
      });

      await expect(putAutomationDraft(snapshot("user-a:page:rule-1", "// cannot land"))).rejects.toBeTruthy();
    });
  });
});
