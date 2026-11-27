// src/__integration__/secrets-migration-crash.integration.test.ts — H2b: the process is
// killed (SIGKILL, no clean-up) at keyring, binding and migration boundaries; the next
// start must lose no secret, never treat a partial migration as complete, and finish.
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_CONNECTOR_MODULES, secretFieldLookup } from "../connectors/bundled.js";
import { bootstrapSecrets } from "../secrets/bootstrap.js";
import { isEnvelope } from "../secrets/envelope.js";
import { loadKeyring } from "../secrets/keyring.js";
import { collectSecretValues, locationId } from "../secrets/locations.js";
import { migrateSecrets, readMarker } from "../secrets/migration.js";
import { createSecretCodec } from "../secrets/secret-store.js";
import { buildSyntheticDatabase, upgradeSchema } from "../__test-helpers__/secrets-fixtures.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lookup = secretFieldLookup(BUNDLED_CONNECTOR_MODULES);
let root = "";
let dbPath = "";
let secretsDir = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aeolus-h2b-crash-"));
  dbPath = path.join(root, "data", "aeolus.db");
  secretsDir = path.join(root, "secrets");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function killAt(point: string): void {
  const run = spawnSync(process.execPath, ["--no-node-snapshot", "--import", "tsx", "src/__test-helpers__/secrets-migration-crash.ts", dbPath, secretsDir, point], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, LOG_LEVEL: "silent" },
  });
  expect(run.stdout ?? "").not.toContain("completed without reaching the crash point");
  if (process.platform === "win32") expect(run.status).not.toBe(0);
  else expect(run.signal).toBe("SIGKILL");
}

describe("hard kill at each boundary, then a normal start", () => {
  it.each([
    ["after-keyring-created", "none"],
    ["after-binding-committed", "none"],
    ["after-checkpoint", "plaintext"],
    ["in-shadow", "plaintext"],
    ["after-verify", "plaintext"],
    ["in-switch", "plaintext"],
    ["after-switch", "encrypted"],
    ["after-vacuum", "encrypted"],
  ])("killed at %s: state is %s, and the restart completes with every secret intact", (point, expected) => {
    const built = buildSyntheticDatabase(dbPath);
    upgradeSchema(built.db);
    built.db.close();
    const { secrets } = built.fixture;

    killAt(point);

    const db = new Database(dbPath);
    try {
      const stored = new Map(collectSecretValues(db, lookup).values.map((item) => [locationId(item.location), item.value]));
      const marker = readMarker(db);
      if (expected === "encrypted") {
        expect(marker?.state).toBe("encrypted");
        expect([...stored.values()].every(isEnvelope)).toBe(true);
      } else {
        // Before the switch commits, nothing is marked encrypted and every value is the original plaintext.
        expect(marker?.state ?? "none").not.toBe("encrypted");
        for (const [where, value] of secrets) expect(stored.get(where), where).toBe(value);
      }

      const { keyring, paths } = bootstrapSecrets(db, dbPath, lookup, { env: { AEOLUS_SECRETS_DIR: secretsDir } as NodeJS.ProcessEnv });
      expect(loadKeyring(paths.keyringFile).boundAt).toEqual(expect.any(Number));
      const report = migrateSecrets(db, keyring, { lookup, checkpointDir: paths.dir, dbPath });
      expect(report.cleaned).toBe(true);
      const codec = createSecretCodec(keyring);
      const after = new Map(collectSecretValues(db, lookup).values.map((item) => [locationId(item.location), item.value]));
      expect(after.size).toBe(secrets.size);
      for (const [where, value] of secrets) {
        const [kind, a, b] = where.split(":") as [string, string, string?];
        const opened = kind === "setting" ? codec.openSetting(a as "jwt_secret", after.get(where)!) : codec.openConnectorField(a, b!, after.get(where)!);
        expect(opened === value, where).toBe(true);
      }
      expect(readMarker(db)).toMatchObject({ state: "encrypted", cleanedAt: expect.any(Number) });
      expect(fs.readdirSync(secretsDir).filter((name) => name.startsWith("pre-secrets-"))).toEqual([]);
    } finally {
      db.close();
    }
  }, 90_000);
});
