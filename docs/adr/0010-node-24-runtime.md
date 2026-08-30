# ADR-0010: Move the pinned runtime to Node 24

- **Status:** Accepted
- **Date:** 2026-08-30
- **Supersedes:** [ADR-0009](0009-pinned-node-22-runtime.md)

## Context

[ADR-0009](0009-pinned-node-22-runtime.md) pinned Node 22 and gave one hard reason: `isolated-vm` 5.x does not build against Node 24's changed V8 API, and because `sandbox.ts` fails soft on a missing addon, a mismatched runtime would silently disable the automation engine rather than fail loudly.

That constraint no longer applies. GHSA-864f-rcv7-6rh4 forced `isolated-vm` off 5.x, and the fix on the 6.x line (`backport-v6`, 6.2.0) declares `engines: >=22.0.0` — so it runs on both the old and new runtime. ADR-0009 anticipated exactly this as the way to decouple the dependency upgrade from the runtime move; taking the security fix completed the first half.

The remaining reason to move is support runway. Node 22 entered Maintenance in October 2025 and reaches end-of-life on 2027-04-30. Node 24 "Krypton" is Active LTS and is supported to the end of April 2028.

## Decision

Move the pin to **24.20.0**, keeping ADR-0009's discipline exactly as it was: one exact patch release, a closed upper bound, declared in every place a runtime appears.

`engines.node` becomes `>=24.20.0 <25` in both `package.json` files (and their lockfile mirrors), `.nvmrc` becomes `24.20.0`, the backend and frontend Dockerfiles and the Compose seed images move to `node:24.20.0-slim`/`-alpine`, the `Makefile` seed-image check follows, and the `tsup` target becomes `node24`.

The closed `<25` bound is retained deliberately. It is still the mechanism that stops an untested runtime, or a dependency major that assumes one, from arriving unnoticed.

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

Run against a portable Node 24.20.0 rather than assuming a nearby patch was representative:

- backend `tsc --noEmit` clean; 198 test files pass, 5 skipped; coverage 94.12% lines / 90.55% branches / 95.59% functions, thresholds met;
- the real-isolate integration tests executed rather than self-skipping, and no "isolated-vm not available" warning appeared, so the sandbox loaded through the `abi137` prebuild;
- frontend `tsc --noEmit` clean; 100 test files / 774 tests pass; coverage thresholds met;
- repo-wide `eslint --max-warnings 0` clean;
- both builds succeed, backend reporting `Target: node24`.

Not verified here: Docker image builds on `arm64`, the broker-backed integration tests (they need Docker), and the Playwright e2e suite (separate scheduled workflow).

## Revisit when

Node 26 reaches Active LTS in October 2026, or an `isolated-vm` upgrade again forces the question. Use the same order that worked this time: adopt a dependency line that supports both runtimes first, then move the pin as its own change.

## Implementation anchors

- `.nvmrc`, `package.json`, `frontend/package.json`
- `Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`, `docker-compose.public-demo.yml`
- `Makefile`
- `src/automations/sandbox.ts`
- `docs/adr/0009-pinned-node-22-runtime.md`
