# ADR-0009: Pin one exact Node 22 runtime across dev, CI and Docker

- **Status:** Superseded by [ADR-0010](0010-node-24-runtime.md)
- **Date:** 2026-08-30

> Superseded on 2026-08-30. The pinning discipline described here still stands and is
> still the reason the pin exists; only the pinned version moved. The specific
> constraint below — that `isolated-vm` 5.x cannot build on Node 24 — was removed when
> GHSA-864f-rcv7-6rh4 forced the upgrade to 6.2.0, which supports both runtimes.
> See [ADR-0010](0010-node-24-runtime.md).

## Context

Aeolus executes user-authored Logic in `isolated-vm` V8 isolates (see [ADR-0004](0004-isolated-v8-automation-runtime.md)). `isolated-vm` is a native C++ addon that binds directly to V8's internal API rather than to Node's stable ABI, so each of its release lines compiles against a bounded set of Node versions. `better-sqlite3` and `bcrypt` are also native, but they track Node's supported ABI range and are far more tolerant.

Two properties of that runtime coupling are not visible from the dependency manifest:

1. **The declared `engines` field understates the real constraint.** Aeolus depends on `isolated-vm@^5.0.1` (currently resolving to 5.0.4), which declares `engines: >=18.0.0`. In practice the 5.x line does not build against Node 24, whose V8 API changed — the native binding fails to compile. This has been reported downstream by other projects on the same major, for example [directus/directus#26299](https://github.com/directus/directus/issues/26299) and [j4k0xb/webcrack#183](https://github.com/j4k0xb/webcrack/issues/183). Trusting `engines` alone would let an unsupported runtime install cleanly.
2. **A runtime mismatch fails soft, not loud.** `src/automations/sandbox.ts` wraps the `isolated-vm` import in `try/catch`, logs a warning, and leaves the sandbox unavailable so that Windows contributors can still run most of the suite. That deliberate tolerance means a wrong Node version does not crash the backend — it quietly removes the automation runtime, which is the core of the product. The constraint therefore has to be enforced by declaration up front rather than discovered at runtime.

Node also only promotes even-numbered lines to LTS, and `isolated-vm` follows that: odd-numbered lines are not supported targets.

Aeolus additionally ships as a Docker appliance intended to run unattended on small hardware (often a Raspberry Pi). The historical failure mode here was not a bad Node version but *drift* between declarations: floating `node:22` tags and a `>=22 <23` range once left `.nvmrc`, the package `engines` and the Dockerfiles disagreeing with what the lockfile actually required.

## Decision

Pin exactly one Node patch release, currently **22.22.1**, in every place a runtime is declared, and keep the upper bound closed:

- `.nvmrc` (which also drives CI and the e2e workflow through `node-version-file`);
- `engines.node` = `>=22.22.1 <23` in the backend and frontend `package.json`;
- the backend and frontend Dockerfiles (all stages);
- the Compose seed helper image;
- the `tsup` build target (`--target node22`).

The closed `<23` upper bound is deliberate, not incidental tidiness. It is the mechanism that stops an unsupported runtime — and any dependency major that assumes one — from landing silently.

## Why this fits Aeolus

Aeolus is an appliance, not a library. It does not need to support a matrix of host runtimes; it needs one runtime that has actually been tested with the native addons it depends on, identical in development, CI and the shipped image. Reproducibility is worth more here than breadth.

The sandbox is also not an optional feature. Because losing it degrades quietly rather than loudly, a conservative and explicitly declared runtime is the cheaper safeguard.

## Alternatives considered

### Float the runtime (`>=22`, or the `node:22` tag)

Simpler to maintain, but it reintroduces exactly the drift this pin exists to prevent: the resolved patch release then differs between a contributor's machine, CI and the image, and native addons are the dependencies least tolerant of that.

### Track the latest Node (24 or newer)

Attractive for longevity, but this is a runtime migration rather than a version bump. It requires moving off `isolated-vm` 5.x first. The 6.x line is the real bridge — 6.0.1 and later (including the `backport-v6` tag at 6.2.0) declare support for Node 22 and above, so it can be adopted *before* the runtime moves, decoupling the two steps. `isolated-vm` 7.0.1 declares Node 24 and above. Either way the work is native-addon rebuilds, prebuilt-binary availability for the target architectures including arm64, and real sandbox verification — not a lockfile edit.

### Let each environment pick its own Node

Rejected because of the soft-failure mode above. A contributor on an unsupported runtime would get a backend that boots, serves the dashboard, and silently never runs an automation.

## Consequences

### Positive

- One tested runtime everywhere; native addons resolve to a single ABI.
- Dependabot majors that assume a newer runtime cannot land quietly; they fail the engine check instead.
- The Docker image, CI and local development cannot drift apart unnoticed.

### Negative / accepted trade-offs

- The pin lives in several files and must be updated together. This has real cost: it has already taken three separate corrective commits to keep aligned.
- Contributors on a newer Node see an `EBADENGINE` warning on install. If they proceed anyway, most of the test suite still passes while the sandbox is silently disabled, which is confusing until you know to look for the warning from `sandbox.ts`.
- Aeolus deliberately lags the current Node release. Node 22 is in Maintenance, with end-of-life on 2027-04-30, so this decision has a deadline rather than being indefinitely safe.
- Raising the upper bound is a deliberate migration, which is slower than it looks when a security advisory is the trigger.

## Revisit when

Node 22 nears its 2027-04-30 end-of-life, or an `isolated-vm` upgrade becomes necessary for a security fix or a required capability. Treat either as a runtime migration: adopt an `isolated-vm` line that supports both the old and new Node versions first, verify the sandbox on every shipped architecture, then move the pin.

## Implementation anchors

- `.nvmrc`, `package.json`, `frontend/package.json`
- `Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`
- `.github/workflows/ci.yml`
- `src/automations/sandbox.ts`
- `docs/reference/operations.md`
