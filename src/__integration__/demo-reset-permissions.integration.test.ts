// src/__integration__/demo-reset-permissions.integration.test.ts
//
// Regression guard for a public-demo outage: the nightly reset restored the
// golden database as root:root while the hardened backend container runs as an
// unprivileged numeric user. The backend could read the DB but not write it, so
// it started and then died with SQLITE_READONLY on its first setting write —
// leaving the tunnel and frontend up and every /api/* request on 502.
//
// The functional half actually runs scripts/reset-demo.sh as root inside a
// container, with `docker compose` stubbed, and inspects the resulting owner of
// the active database and its directory. It skips when Docker is unavailable,
// matching the other integration suites here.
//
// The structural half is cheap and always runs: it pins the ORDER of the reset
// (ownership must be corrected after the golden copy and before services start)
// and the failure handling, which no filesystem assertion would catch.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const RESET_SCRIPT = readFileSync(path.join(REPO_ROOT, "scripts", "reset-demo.sh"), "utf8");
const GOLDEN_SCRIPT = readFileSync(path.join(REPO_ROOT, "scripts", "create-demo-golden.sh"), "utf8");
const DEPLOY_SCRIPT = readFileSync(path.join(REPO_ROOT, "scripts", "deploy", "deploy-demo-from-pc.sh"), "utf8");

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version"], { stdio: "pipe", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const describeDocker = dockerAvailable() ? describe : describe.skip;

/** Index of the first line matching a pattern, for order assertions. */
function lineOf(source: string, pattern: RegExp): number {
  const index = source.split("\n").findIndex((line) => pattern.test(line));
  expect(index, `expected reset script to contain ${pattern}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("demo reset — runtime ownership contract", () => {
  it("corrects ownership after replacing the DB and before starting services", () => {
    // The bug was ordering-sensitive: a chown that runs after `compose up`, or
    // before the copy, still hands the backend a root-owned database.
    const replaced = lineOf(RESET_SCRIPT, /mv "\$staged_db" "\$ACTIVE_DB"/);
    const chowned = lineOf(RESET_SCRIPT, /chown -R "\$\{runtime_uid\}:\$\{runtime_gid\}"/);
    // Anchored: the failure trap also restarts the services, and that line must
    // not be mistaken for the normal start.
    const started = lineOf(RESET_SCRIPT, /^compose up -d backend simulator$/);

    expect(replaced).toBeLessThan(chowned);
    expect(chowned).toBeLessThan(started);
  });

  it("derives the runtime identity from the same variables the compose file uses", () => {
    expect(RESET_SCRIPT).toMatch(/runtime_uid="\$\{AEOLUS_RUNTIME_UID:-1000\}"/);
    expect(RESET_SCRIPT).toMatch(/runtime_gid="\$\{AEOLUS_RUNTIME_GID:-1000\}"/);

    // Same defaults the hardened stack applies to backend/simulator, so the two
    // cannot drift apart.
    const compose = readFileSync(path.join(REPO_ROOT, "docker-compose.public-demo.yml"), "utf8");
    expect(compose).toContain('user: "${AEOLUS_RUNTIME_UID:-1000}:${AEOLUS_RUNTIME_GID:-1000}"');
  });

  it("covers SQLite sidecars by owning the whole active data directory", () => {
    // -wal/-shm are created by the backend at runtime and may also be left over
    // from a previous run, so naming files individually is fragile.
    expect(RESET_SCRIPT).toMatch(/chown -R "\$\{runtime_uid\}:\$\{runtime_gid\}" "\$DATA_DIR"/);
    expect(RESET_SCRIPT).toMatch(/rm -f "\$ACTIVE_DB" "\$\{ACTIVE_DB\}-wal" "\$\{ACTIVE_DB\}-shm"/);
  });

  it("never loosens the golden snapshot", () => {
    // The golden is the copy SOURCE only. It must stay read-only and must not be
    // chowned to the runtime user.
    expect(GOLDEN_SCRIPT).toMatch(/chmod 0444 "\$tmp"/);
    expect(RESET_SCRIPT).not.toMatch(/chown[^\n]*\$GOLDEN_DB/);
    expect(RESET_SCRIPT).not.toMatch(/chmod[^\n]*\$GOLDEN_DB/);
    // Ownership is corrected on the data directory, which the golden is outside of.
    expect(RESET_SCRIPT).not.toMatch(/chown -R[^\n]*golden/i);
  });

  it("holds the same ownership invariant when a golden snapshot is created", () => {
    // create-demo-golden.sh also stops and restarts the backend, and its WAL
    // checkpoint can create sidecars as whoever ran it.
    const chowned = lineOf(GOLDEN_SCRIPT, /chown -R "\$\{runtime_uid\}:\$\{runtime_gid\}" "\$DATA_DIR"/);
    const restarted = lineOf(GOLDEN_SCRIPT, /^compose up -d backend simulator$/);
    expect(chowned).toBeLessThan(restarted);
  });

  it("stages the restore so a failed copy cannot leave the demo with no database", () => {
    const staged = lineOf(RESET_SCRIPT, /cp "\$GOLDEN_DB" "\$staged_db"/);
    const removedActive = lineOf(RESET_SCRIPT, /rm -f "\$ACTIVE_DB" "\$\{ACTIVE_DB\}-wal"/);
    expect(staged).toBeLessThan(removedActive);
  });

  it("recovers, loudly, if the reset aborts after stopping the services", () => {
    // Fail-fast plus a stopped backend is an outage. The trap must attempt a
    // restart and make the failure obvious in the journal.
    expect(RESET_SCRIPT).toMatch(/trap on_exit EXIT/);
    expect(RESET_SCRIPT).toMatch(/services_stopped=1/);
    expect(RESET_SCRIPT).toMatch(/RESET FAILED/);
    const stopped = lineOf(RESET_SCRIPT, /^compose stop backend simulator$/);
    const flagged = lineOf(RESET_SCRIPT, /^services_stopped=1$/);
    expect(flagged).toBeGreaterThan(stopped);
  });

  it("reloads systemd when the deploy installs unit files", () => {
    // Without this systemd keeps running the old unit and warns that the unit
    // file changed on disk.
    expect(DEPLOY_SCRIPT).toMatch(/cp scripts\/systemd\/aeolus-demo-reset\.service[^\n]*systemctl daemon-reload/);
  });
});

describe("public demo release gate", () => {
  it("gives the frontend build context its own ignore file", () => {
    // The deploy builds `$ROOT/frontend` as an INDEPENDENT Docker context, so the
    // repo-root .dockerignore does not apply. The Dockerfile runs `npm ci` and
    // then `COPY . .`, so without these exclusions a host node_modules/ (wrong
    // platform) or a stale dist/ silently overwrites the clean Linux install, and
    // a host .env would be inlined into the public static bundle by Vite.
    const ignore = readFileSync(path.join(REPO_ROOT, "frontend", ".dockerignore"), "utf8")
      .split("\n")
      .map((line) => line.trim());

    for (const entry of ["node_modules", "dist", ".env", ".env.*"]) {
      expect(ignore, `frontend/.dockerignore must exclude ${entry}`).toContain(entry);
    }

    // The guard only matters while the Dockerfile still copies the whole context
    // after installing dependencies. If that changes, revisit this together.
    const dockerfile = readFileSync(path.join(REPO_ROOT, "frontend", "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/RUN npm ci[\s\S]*COPY \. \./);
  });

  it("smoke-tests anonymous demo session creation, not just / and /api/health", () => {
    // Regression guard for the outage this file documents: the frontend served
    // and /api/health answered while every anonymous visitor got a 502 from
    // /api/auth/demo-session. A public gate that cannot see that is not a gate.
    expect(DEPLOY_SCRIPT).toMatch(/\/api\/auth\/demo-session/);
    const demoSessionCheck = DEPLOY_SCRIPT.split("\n").findIndex((line) =>
      /\$\{DEMO_PUBLIC_ORIGIN\}\/api\/auth\/demo-session/.test(line),
    );
    expect(demoSessionCheck).toBeGreaterThanOrEqual(0);
    // It must be a POST (the endpoint only mints sessions on POST) and it must
    // feed the same pass/fail variable as the other public checks.
    const block = DEPLOY_SCRIPT.split("\n").slice(demoSessionCheck - 6, demoSessionCheck + 3).join("\n");
    expect(block).toMatch(/-X POST/);
    expect(block).toMatch(/public_ok=0/);
  });
});

describeDocker("demo reset — actual resulting ownership (root reset)", () => {
  it("leaves the active database and its directory owned by the runtime UID/GID", () => {
    // Run the real script as root with `docker compose` stubbed out, so the only
    // thing under test is the filesystem work: copy, permissions, ownership.
    const script = [
      "set -eu",
      "mkdir -p /work/bin /demo/golden /demo/data /demo/app",
      // Stub compose so stop/up succeed without a daemon.
      "printf '#!/bin/sh\\nexit 0\\n' > /work/bin/docker",
      "chmod +x /work/bin/docker",
      "export PATH=/work/bin:$PATH",
      // A plausible golden file, plus a stale root-owned sidecar and a
      // root-owned active DB — exactly the broken state from production.
      "printf 'golden-db-bytes' > /demo/golden/aeolus-demo.db",
      "printf 'stale' > /demo/data/aeolus.db",
      "printf 'stale-wal' > /demo/data/aeolus.db-wal",
      "chown -R 0:0 /demo/data",
      "cp /repo/scripts/reset-demo.sh /demo/app/reset-demo.sh",
      "chmod +x /demo/app/reset-demo.sh",
      "cd /demo/app",
      // No health-check script beside it, so the gate is skipped.
      "AEOLUS_DEMO_GOLDEN_DB=/demo/golden/aeolus-demo.db AEOLUS_DEMO_DATA_DIR=/demo/data ./reset-demo.sh > /tmp/out 2>&1 || { echo SCRIPT_FAILED; cat /tmp/out; exit 1; }",
      // Report what the backend would actually see.
      "echo RESULT",
      "stat -c '%n %u:%g %a' /demo/data /demo/data/aeolus.db",
      "echo CONTENT=$(cat /demo/data/aeolus.db)",
      "ls /demo/data",
    ].join("\n");

    const output = execFileSync(
      "docker",
      [
        "run", "--rm",
        "-v", `${REPO_ROOT}:/repo:ro`,
        "--entrypoint", "sh",
        "bash:5", "-c", script,
      ],
      { encoding: "utf8", timeout: 180_000 },
    );

    expect(output).toContain("RESULT");

    // The data directory and the active DB must belong to the runtime user, or
    // the hardened backend dies with SQLITE_READONLY on its first write.
    expect(output).toMatch(/\/demo\/data 1000:1000/);
    expect(output).toMatch(/\/demo\/data\/aeolus\.db 1000:1000 644/);

    // The restore actually happened, and the stale WAL sidecar is gone.
    expect(output).toContain("CONTENT=golden-db-bytes");
    expect(output).not.toContain("aeolus.db-wal");
    // No staging leftovers.
    expect(output).not.toMatch(/aeolus\.db\.restoring/);
  });
});
