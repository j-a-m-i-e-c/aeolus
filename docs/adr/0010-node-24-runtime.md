# ADR-0010: Move the pinned runtime to Node 24

- **Status:** Accepted
- **Date:** 2026-08-30
- **Supersedes:** [ADR-0009](0009-pinned-node-22-runtime.md)

## Context

[ADR-0009](0009-pinned-node-22-runtime.md) pinned Node 22 and gave one hard reason: `isolated-vm` 5.x does not build against Node 24's changed V8 API, and because `sandbox.ts` fails soft on a missing addon, a mismatched runtime would silently disable the automation engine rather than fail loudly.

That constraint no longer applies. GHSA-864f-rcv7-6rh4 forced `isolated-vm` off 5.x, and the fix on the 6.x line (`backport-v6`, 6.2.0) declares `engines: >=22.0.0` — so it runs on both the old and new runtime. ADR-0009 anticipated exactly this as the way to decouple the dependency upgrade from the runtime move; taking the security fix completed the first half.

The remaining reason to move is support runway. Node 22 entered Maintenance in October 2025 and reaches end-of-life on 2027-04-30. Node 24 "Krypton" is Active LTS and is supported to the end of April 2028.

## Decision

Move the pin to **24.20.0**, keeping ADR-0009's discipline: one tested patch release, a closed upper bound, declared in every place a runtime appears.

`.nvmrc` becomes `24.20.0`, the backend and frontend Dockerfiles and the Compose seed images move to `node:24.20.0-slim`/`-alpine`, the `Makefile` seed-image check follows, and the `tsup` target becomes `node24`. `engines.node` becomes `>=24.20.0 <25` in both `package.json` files and their lockfile mirrors.

Note the deliberate asymmetry, because "one exact patch" is not literally true of every declaration. The operational pins — `.nvmrc`, which also drives CI through `node-version-file`, and the Docker image tags — are exact, and those are what actually build and run Aeolus. `engines` is a floor plus a closed ceiling instead, because an exact `engines` value would reject every contributor who is one patch ahead while adding nothing: it is a guard against the *wrong major*, not a build input. The closed `<25` bound is the part that matters, and it is retained deliberately as the thing that stops an untested runtime, or a dependency major assuming one, from arriving unnoticed.

### Required launch flag

`isolated-vm` documents `--no-node-snapshot` as **mandatory** on Node 20 and later, so on Node 24 every process that creates an isolate must pass it. This is part of the runtime decision rather than an incidental detail, because omitting it does not reliably throw — Node frequently tolerates it, so the appliance boots and the suite passes while running an unsupported V8 startup configuration. That is the same silent-degradation shape as the pin itself.

It is applied in three places: the production container `CMD` (authoritative — no Compose file overrides the backend command, so every deployment inherits it), the `start` script, and `node-options` in `.npmrc` so npm lifecycle scripts and the vitest workers they spawn inherit it during development and test. The last one is what makes the real-isolate integration tests exercise the supported configuration rather than merely showing that Node tolerated its absence. `src/automations/sandbox-runtime-flags.test.ts` pins all three, and asserts the flag is *not* forced on the simulator and seed entrypoints, which never create an isolate.

## Why this fits Aeolus

The pinning discipline is what ADR-0009 was really about, and nothing about it has changed — Aeolus is still an appliance that wants one tested runtime identical in development, CI and the shipped image. This ADR only moves the constant onto a line with two more years of support.

The native-addon risk that made Node 22 necessary has also inverted. `isolated-vm` 6.2.0 bundles prebuilt binaries in its own tarball via `node-gyp-build` rather than fetching them at install time, and ships `linux-arm64` at both `abi127` (Node 22) and `abi137` (Node 24). The Raspberry Pi therefore loads a prebuild instead of compiling a large C++ project, which is better than the position under 5.0.4.

## Alternatives considered

### Stay on Node 22 until closer to its end-of-life

Lowest effort, but the only technical reason for staying is gone, and deferring means doing the migration later under time pressure from an advisory or an EOL date rather than now with a green suite.

### Jump to Node 26

Node 26 is Current, not LTS until October 2026. Pairing a not-yet-LTS runtime with a native addon that binds V8 internals is precisely the combination this project avoids: `isolated-vm` 7.0.0 declared `>=26.0.0` and 7.0.1 then relaxed to `>=24.0.0`, which is the kind of churn to let settle rather than track.

### Float the range (`>=24`)

Rejected for the same reason ADR-0009 rejected it: the resolved patch then differs between a contributor's machine, CI and the image, and native addons are the least tolerant dependencies of that drift.

## Consequences

### Positive

- Support runway moves from 2027-04-30 to end of April 2028.
- `isolated-vm` prebuilds exist for the pinned ABI on both `linux-x64` and `linux-arm64`, so no image build compiles the addon from source.
- The pinning discipline, and the guard it provides, is unchanged.

### Negative / accepted trade-offs

- The pin still lives across roughly a dozen declarations that must move together. This ADR does not fix that; it re-pays the cost.
- Verified on `linux`/`win32` x64 only. The `linux-arm64` prebuild is confirmed present in the package but has not been exercised on real Pi hardware by this change.
- Raising `<25` remains a deliberate migration, which is still slower than it looks when an advisory is the trigger.

## Verification

First run against a portable Node 24.20.0 rather than assuming a nearby patch was representative: backend and frontend `tsc --noEmit` clean, 198 backend test files passing with 5 skipped, 100 frontend files / 774 tests passing, coverage thresholds met on both, `eslint --max-warnings 0` clean, and both builds succeeding with the backend reporting `Target: node24`. Critically, the real-isolate integration tests executed rather than self-skipping and logged no "isolated-vm not available", so the sandbox loaded through the `abi137` prebuild on Node 24.

Re-run afterwards with Docker available and `--no-node-snapshot` in effect, which is the configuration that actually ships:

- 204 backend test files pass — the 5 previously skipped Docker suites now execute — with coverage 94.93% lines / 91.01% branches / 97.48% functions;
- 100 frontend files / 774 tests pass, thresholds met;
- `eslint --max-warnings 0` clean; both `tsc --noEmit` clean; both builds succeed.

The backend run used `npm test` rather than `npx vitest` deliberately, because `node-options` in `.npmrc` reaches Node through npm lifecycle scripts. Confirmed empirically: a temporary `node -p process.env.NODE_OPTIONS` script invoked via `npm run` printed `--no-node-snapshot`.

Not verified here: Docker image builds on `arm64`, and the Playwright e2e suite (separate scheduled workflow).

## Revisit when

Node 26 reaches Active LTS in October 2026, or an `isolated-vm` upgrade again forces the question. Use the same order that worked this time: adopt a dependency line that supports both runtimes first, then move the pin as its own change.

## Implementation anchors

- `.nvmrc`, `package.json`, `frontend/package.json`
- `Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`, `demo/compose/hosted-runtime.yml`
- `Makefile`
- `src/automations/sandbox.ts`
- `docs/adr/0009-pinned-node-22-runtime.md`
