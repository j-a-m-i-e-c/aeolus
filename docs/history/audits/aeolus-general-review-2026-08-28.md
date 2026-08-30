# Aeolus general architecture review — 28 Aug 2026

## Scope

This review looks across the current repository rather than one feature: product model, runtime architecture, device/command semantics, sandboxing, data, authentication, connectors, frontend authoring, testing, documentation and deployment.

It is a checkpoint review, not a claim that every code path has been formally audited.

## Executive assessment

Aeolus now has the shape of a credible early-alpha edge platform rather than a collection of unrelated IoT features. Its strongest architectural idea is consistent across the codebase: **normalise heterogeneous physical systems behind one local device/event/command model, then be explicit about what the platform can prove happened.**

The highest-value work is no longer another large architecture rewrite. The main risks have shifted to:

1. transitional/legacy paths that duplicate the new model;
2. operational sharp edges in demo/release tooling;
3. documentation/backlog drift after rapid implementation;
4. a few deliberately deferred security/connector boundaries;
5. insufficient direct integration proof of the native automation isolate itself.

That is a healthy place for an early-alpha project to be, but it is also the right time to simplify before compatibility obligations exist.

## Immediate priorities

### P0 — Fix repeated golden-snapshot creation before re-enabling the demo reset

`scripts/create-demo-golden.sh` writes the checksum and metadata with shell redirection and then changes them to mode `0444`. The next golden creation attempts to truncate those same read-only files:

```bash
sha256sum "$GOLDEN_DB" > "${GOLDEN_DB}.sha256"
...
} > "$meta"
```

This reproduces the observed second-snapshot failure. Write both to temporary files, chmod the temporary files, then atomically `mv -f` them into place. Verify the checksum before enabling the timer. Add a test that creates/replaces a golden twice.

### P0 — Triage the current dependency alerts

GitHub currently reports three Dependabot alerts on the default branch (one high, two moderate). Determine whether they affect runtime, build-only tooling or transitive packages and either upgrade or document a time-bounded exception.

### P1 — Remove the legacy script-authoring fork before public compatibility exists

The new product model is Automation Projects, but the API/frontend still expose `projectMode: "project" | "legacy"`, old `ScriptEditor`/`UiEditor` branches and legacy single-source save paths.

That fork already caused the hosted demo and a real installation to present different authoring experiences. With no external users to preserve, this is the ideal time to make Automation Projects the single script-automation authoring/storage model. Form rules can remain as a separate simple/no-code feature without retaining a second script editor.

If desired, keep an import adapter for old local development data, but do not keep two permanent product paths.

## Area review

### Product architecture — strong

The local-first, single-site boundary is coherent with the target environment. The README, architecture reference and deployment shape agree that Aeolus is not a fleet manager or multi-tenant SaaS.

The project would lose clarity if it added cloud/fleet complexity before a concrete requirement exists.

### Device/event model — strong

MQTT and connector-backed products are normalised into one registry/event model. This is a better long-term abstraction than making automations understand each transport.

The lossless MQTT source-topic identity work is particularly important because physical routing identifiers must not be reconstructed from lossy display IDs.

### Command execution and acknowledgement — standout strength

The `REQUESTED -> DISPATCHED -> ACKNOWLEDGED -> OBSERVED` lifecycle, failure states, per-device capability ceiling and durable history are unusually strong for a portfolio IoT project.

The design answers a real physical-systems question: "what evidence do we have that the command happened?" rather than treating a successful API call as physical success.

One low-priority cleanup: comments around `isTerminal()` in `command-lifecycle.ts` say terminal means "no further transition possible", while `DISPATCHED` and `ACKNOWLEDGED` are intentionally considered terminal-success states for some required tiers even though the transition table allows later evidence. The implementation/tests are internally intentional, but the terminology/documentation should distinguish **lifecycle finality** from **sufficient completion for a selected tier**.

### Automation Logic sandbox — strong design, testing gap

The `isolated-vm` boundary is thoughtfully designed: fresh isolate, memory/time limits, host-mediated references, no Node globals, declarative cross-boundary conditions, and explicit async-command draining.

However, most sandbox tests exercise pure helper behaviour without constructing a real `Sandbox`; the repository does not appear to have a focused CI test that executes representative authored Logic through an actual Linux `isolated-vm` instance and asserts the exposed/blocked capabilities end to end.

Add a small Linux-only integration suite for the real isolate:

- allowed `state`, `devices`, `log` calls work;
- `process`, `require`, filesystem and dynamic imports remain unavailable;
- memory/CPU limits produce the expected classified failures;
- an async device action is awaited through the real bridge.

This is more valuable than raising a generic coverage percentage for `sandbox.ts`.

### Automation Projects — good architecture, finish the transition

The bounded virtual source tree, relative-only imports and in-memory esbuild compilation preserve the existing runtime privilege boundaries while allowing real code organisation.

The product rule should remain: **Logic and UI are the simple mental model; Files is the escape hatch for complexity.**

The remaining legacy projection/storage path is currently useful only as transition scaffolding. Before external users exist, decide whether to remove it rather than documenting it forever.

### Custom UI sandbox — strong browser boundary with a known future trust issue

Opaque-origin iframes and a host-owned MessageChannel broker are the right shape. Auth tokens are kept out of authored frames and there is no generic network bridge.

The known future issue is capability delegation: if untrusted authors ever create UI that a more privileged viewer opens, the host can become a confused deputy. The backlog correctly treats a per-project capability manifest as future work. Do not market the current UI sandbox as arbitrary third-party plugin isolation until that exists.

### SQLite/data model — strong fit

SQLite + WAL + versioned migrations is a good fit for the single-site deployment. The migration runner is much more mature than typical early-alpha code and has property tests around adoption, ordering and future-version rejection.

Operational scripts must continue to treat WAL sidecars and directory ownership as part of the database, not just `aeolus.db`; the public-demo incidents demonstrate why.

Before a first stable public release, consider whether the current pre-release migration history/legacy-adoption machinery should be squashed into a clean baseline. Once users exist, preserve migrations normally.

### Authentication/authorization — mature for the stated threat model

The codebase has moved beyond route-level "is admin" checks into resource ownership, tab-derived scope, filtered read surfaces and command-boundary rechecks. Public-demo restrictions are fail-closed rather than relying on UI hiding alone.

Keep the documented threat model narrow: small mostly-trusted site, not hostile SaaS tenants.

Remaining areas worth tracking:

- capability manifests for authored custom UI;
- safe scoped MQTT publish namespace;
- configurable trusted-proxy topology for non-demo reverse-proxy deployments.

### MQTT security/provisioning — implementation ahead of product sign-off

Broker verification and managed provisioning are substantial, but keeping the feature opt-in is correct until the real deployment lifecycle is exercised.

The backlog's revocation concern is valid: rejecting a made-up password for a deleted username does not prove the previously valid secret has stopped working. Fix the verification claim before enabling managed provisioning by default.

### Connectors — sound framework, still the least mature runtime area

The connector contract/lifecycle and action router are well structured. Hue/Kasa have received substantial correctness work.

The remaining "device disappeared from discovery" reconciliation problem is operationally important for long-running sites. Use consecutive misses/grace windows rather than immediate deletion.

As new connectors are added, treat truthful capability catalogs and failure semantics as release gates, not polish.

### Frontend/operator UX — architecture good, hierarchy still being refined

The dashboard/pane model and custom UI host are capable. The Automation Project editor is now on the correct conceptual path, but the recent work shows that product hierarchy matters as much as feature count.

Recommended authoring hierarchy:

1. automation identity/trigger;
2. primary navigation: Logic / UI / Files;
3. contextual tools: Insert / API / Format;
4. editor;
5. one clear save/cancel action.

Avoid making implementation concepts such as entry filenames or project structure visually dominant in the common case.

### Testing/CI — unusually strong, but target the excluded risk zones

The repository contains roughly 300 test files, property-based tests, broker-backed integration tests, browser E2E and 90% global coverage thresholds. CI builds images only after lint/backend/frontend/integration gates pass.

The quality of tests is more impressive than the raw percentage because command lifecycle, migrations and authorization have dedicated invariant/property tests.

The main improvement is to add **targeted real-environment tests for code excluded from coverage** rather than chasing the percentage:

- actual `isolated-vm` execution;
- repeated golden snapshot/reset lifecycle;
- key Monaco authoring flows on PRs when that surface changes.

Daily Playwright is reasonable generally, but high-risk authoring/security changes could run a focused subset on pull requests.

### Documentation — strong reference set, current backlog has drift

The docs are extensive and appropriately split by audience. Adding ADRs closes the missing "why" layer between product explanation and implementation reference.

`docs/BACKLOG.md` has already drifted in places. For example, it says generic MQTT devices lack a command-profile path, while the current implementation has `GET/PUT /api/devices/:id/mqtt-command-profile` and persisted `mqttCommandProfile` capability data. Audit/close stale backlog entries so the repo does not tell reviewers that implemented features are missing.

`docs/architecture/AUTOMATION_PROJECTS.md` also still spends significant space on legacy script compatibility. If the pre-release cleanup removes that path, rewrite the document around the final product model rather than historical transition mechanics.

### Deployment/operations — functional but currently the largest sharp edge

The normal Docker Compose shape is appropriate, and the public demo has good principles: no public backend/MQTT ports, Cloudflare Tunnel as ingress, immutable release images, health gates and golden reset.

The reset/golden scripts have nevertheless produced two real outage-class bugs during deployment. Treat those scripts as production code:

- idempotency tests;
- run twice, not just once;
- root/systemd ownership path in tests;
- atomic file replacement;
- hard failure if release gates fail;
- explicit rollback/recovery output.

The safest next demo step is to fix and test the golden creator before recreating/enabling the nightly timer.

## ADR recommendation

ADRs are a particularly good fit for Aeolus now because many of its strongest decisions are trade-offs interviewers will ask about:

- Why local-first rather than cloud-first?
- Why MQTT plus connectors?
- Why SQLite rather than Postgres?
- Why V8 isolates rather than Node `vm`, workers or containers?
- Why an opaque-origin iframe?
- Why completion tiers instead of "command succeeded"?
- Why esbuild/virtual projects?
- Why a modular monolith rather than microservices?

The initial ADR set under `docs/adr/` records those decisions. Future ADRs should be added when a meaningful alternative existed, not for every library choice.

## Suggested next sequence

1. Land the Automation authoring hierarchy polish.
2. Fix the golden snapshot replacement bug and add a two-run lifecycle test.
3. Triage Dependabot alerts.
4. Remove/simplify the legacy script-authoring path while there are no external users.
5. Clean stale backlog/reference text after that simplification.
6. Add the real-isolate integration test.
7. Work through the remaining backlog by product risk rather than by feature novelty.

At that point Aeolus will have a cleaner story both technically and in an interview: the code, reference docs and architectural rationale will all describe the same system.
