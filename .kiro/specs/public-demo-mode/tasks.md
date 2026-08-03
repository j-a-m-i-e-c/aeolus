# Implementation Plan: Public Demo Mode

## Overview

Deliver the fail-closed demo capability envelope first (Phase A — the entire
security boundary, independently testable), then the isolated, disposable
deployment (Phase B). Order follows requirements §32. Tasks marked `*` are
optional test tasks; the non-`*` tasks are the feature. Every task keeps normal
(non-demo) behaviour byte-for-byte unchanged (Req 17).

---

## Phase A — Application demo mode

> **STATUS: COMPLETE (implemented + verified).** All Phase A tasks (1–12) are
> done. Backend: `config.publicDemo`, `sessionType` claim, migration 012 +
> `demo_access` in `initSchema`, `createDemoSession` + `POST /api/auth/demo-session`,
> `src/demo/{demo-policy,public-demo-guard,demo-validators,demo-rule-access}.ts`
> wired after `authenticate` in `index.ts`, demo rate limiters, and
> `provisionDemoIdentity` seed helper. Frontend: `PUBLIC_DEMO` env,
> `auth-store.initDemoSession` (auto session + skip login), `DemoBanner` in
> `Layout`. Tests: 31 demo unit tests + `public-demo.integration.test.ts` (20);
> full backend suite 1844 pass, frontend 752 pass.
>
> Deviations from the plan, all deliberate:
> - **Guard reads path params from the matcher**, not `req.params` — app-level
>   middleware runs before Express populates route params. `DemoPolicyMatch`
>   returns `{ entry, params }` and the guard passes `params` to validators.
> - **Demo write/fire limiters are keyed by IP** (with `skip` for non-demo
>   sessions), because every demo visitor shares the one seeded `demo` user, so
>   per-IP is the honest per-visitor bound.
> - **WebSocket** needs no change: demo tokens verify (carry `sessionType`) and
>   broadcasts are already tab-scoped; the connection-attempt cap is deferred to
>   Phase B hardening.
> - **Frontend hiding** largely falls out of the demo user being a non-admin
>   `user` with only `interact` (existing `isAdmin`/`write` gating already hides
>   admin pages and authoring); the maintenance-window state is deferred to
>   Phase B alongside the reset mechanism.
> - The 16 KB demo body cap is enforced via a `Content-Length` check in the
>   validators rather than a second `express.json` instance.

### Phase A follow-on — read-only admin visibility (masked)

> **STATUS: COMPLETE.** Enhancement so the demo showcases the whole platform:
> public-demo sessions may now *view* the admin/pinned tabs (System, Data Store,
> Security, Connectors) read-only, with sensitive data masked server-side. See
> `docs/AEOLUS_PUBLIC_DEMO_REQUIREMENTS.md` §7.3 for the allowlisted admin reads
> and masking contract. Implementation: admin GET patterns added to
> `buildDemoPolicy`; `requireAdmin` relaxes for demo GET/HEAD (guard stays the
> authoritative allowlist); new `src/demo/demo-scrub.ts` wraps `res.json` for
> demo sessions and redacts host/network identifiers, credentials, usernames,
> and log contents; frontend un-hides the pinned/security tabs in `PUBLIC_DEMO`
> and renders the admin pages without mutating controls (`useReadOnlyDemo`).
> Safe because the demo box is throwaway with no real credentials and is reset
> on a schedule. Writes remain fail-closed.

- [ ] 1. Demo configuration flags
  - [ ] 1.1 Add `config.publicDemo { enabled, sessionMinutes, resetTime }` to
    `src/config.ts` (env: `AEOLUS_PUBLIC_DEMO` default false,
    `DEMO_SESSION_MINUTES` default 120, `DEMO_RESET_TIME` default `03:30`);
    document in `.env.example`
    - _Requirements: 1.1, 1.2, 1.4_
  - [ ] 1.2 Add `VITE_PUBLIC_DEMO` to `frontend/.env.example` and a `demoMode`
    accessor in the frontend env module
    - _Requirements: 1.3_

- [ ] 2. `sessionType` token claim (backward compatible)
  - [ ] 2.1 Extend `AccessTokenPayload` with optional `sessionType`; thread it
    through `generateAccessToken` (with an optional expiry-minutes override),
    `verifyAccessToken`, `verifyAccessTokenWithExpiry`, and the `req.user`
    augmentation + `authenticate` in `src/auth/auth-middleware.ts` (absent ⇒
    `"normal"`)
    - _Requirements: 2.2, 2.3, 17.2_
  - [ ]* 2.2 Extend token-service tests: claim round-trips, defaults to normal,
    demo expiry honoured
    - _Validates: 2.2, 2.3, 2.5_

- [ ] 3. Seeded demo identity
  - [ ] 3.1 Seed a `Public Demo` group + `demo` user (role `user`) with only
    `read`/`interact` on seeded demo tabs; add `authService.getDemoUser()`
    - _Requirements: 3.1, 3.2, 3.3_
  - [ ] 3.2 Add nullable `demo_access TEXT` column to `automation_rules` via a
    numbered migration under `src/db/migrations/`, plus a cached
    `getDemoRuleAccess(ruleId)` accessor
    - _Requirements: 6.3, 7.3_

- [ ] 4. Demo session endpoint
  - [ ] 4.1 Add `POST /api/auth/demo-session` to `PUBLIC_ROUTES`; inert (404)
    unless `config.publicDemo.enabled`; mints a `public-demo` token for the
    seeded demo user with `sessionMinutes` lifetime and **no** refresh
    token/cookie
    - _Requirements: 2.1, 2.4, 2.5, 1.5_
  - [ ]* 4.2 Route tests: inert when off; issues demo token; no refresh cookie
    - _Validates: 2.1, 2.4, 1.5_

- [ ] 5. Fail-closed Public Demo Guard + policy
  - [ ] 5.1 Create `src/demo/demo-policy.ts` (allowlist + segment matcher with
    `:param` support) and `src/demo/public-demo-guard.ts`
    (`createPublicDemoGuard`): pass-through for normal/absent sessions; allow
    only matched entries for demo sessions; else 403; run entry validators
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_
  - [ ] 5.2 Wire `app.use(createPublicDemoGuard())` in `src/index.ts` immediately
    after `app.use(authenticate)` and before route mounts
    - _Requirements: 4.1, 4.5_
  - [ ]* 5.3 Unit tests: matcher (params, unknown route fails closed); guard
    pass-through vs allow vs deny; validator invocation
    - _Validates: 4.2, 4.3, 4.4, 4.6_

- [ ] 6. Allow safe read endpoints
  - [ ] 6.1 Populate the read entries of `DEMO_POLICY` (Req 5.1 list) and confirm
    each still flows through its existing resource/collection filter
    - _Requirements: 5.1, 5.2_
  - [ ] 6.2 Accept `public-demo` tokens on the WebSocket path and confine
    broadcasts to existing tab-scoped visibility; cap connection attempts
    - _Requirements: 5.3, 9.1_

- [ ] 7. Bounded `aeolus.save()` state writes
  - [ ] 7.1 Add `validateDemoStateWrite` (key ≤ 64, value ≤ 8 KB, ≤ 100 keys,
    `writableStateKeys` allowlist) in `src/demo/demo-validators.ts`; attach to
    the state entry in `DEMO_POLICY`; mount a small (16 KB) json limit on the
    state route
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]* 7.2 Validator unit tests (each limit + writable-key allow/deny)
    - _Validates: 6.2, 6.3, 6.4_

- [ ] 8. Allowlisted `aeolus.fire()` events
  - [ ] 8.1 Add `validateDemoFire` (reject `context`; require `eventName`;
    enforce `fireEvents` allowlist) and attach to the fire entry
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 11.2_
  - [ ]* 8.2 Validator unit tests (context rejected, undeclared event rejected,
    declared event allowed)
    - _Validates: 7.2, 7.3, 7.4_

- [ ] 9. Demo rate & payload limits
  - [ ] 9.1 Add `demoSessionRateLimiter` (per IP), `demoWriteRateLimiter` and
    `demoFireRateLimiter` (per session) in `rate-limiter.ts`; apply to the
    respective routes; ensure history-query and Data-Store result caps apply
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 10. Checkpoint — verify the security boundary
  - Run the demo integration + adversarial suites and `make verify`; confirm
    demo-off behaviour is unchanged.

- [ ] 11. Frontend demo mode
  - [ ] 11.1 On load (when `demoMode`), auto-request `/api/auth/demo-session`,
    store token, skip login, open default demo tab; transparently re-request on
    expiry
    - _Requirements: 10.1, 10.4_
  - [ ] 11.2 Add a persistent `DemoBanner` (simulated · shared · resets nightly +
    link to `aeolus.com.au`, build SHA)
    - _Requirements: 10.2, 15.2 (version display)_
  - [ ] 11.3 Hide admin/authoring/destructive surfaces under `demoMode` (reuse
    the `isAdmin`-gating pattern); show a maintenance state during the reset
    window; verify mobile layout
    - _Requirements: 10.3, 10.5, 10.6_

- [ ] 12. Security & adversarial tests (Phase A gate)
  - [ ]* 12.1 `public-demo.integration.test.ts`: allow matrix (Req 16.1) + deny
    matrix (Req 16.2, every §8 capability, arbitrary context, oversized value,
    unknown route fails closed)
    - _Validates: 16.1, 16.2, 16.3, 8.*, 5.*_
  - [ ]* 12.2 `public-demo-adversarial.integration.test.ts`: hostile client,
    forged/expired tokens, hidden IDs, fuzzing, rapid fire — only 4xx/429, no 500
    - _Validates: 16.4_
  - [ ]* 12.3 Demo-off regression suite: demo-shaped requests behave normally
    - _Validates: 17.1, 17.3, 17.4_

---

## Phase B — Deployment & operations

- [ ] 13. Demo Compose stack
  - [ ] 13.1 Add `docker-compose.demo.yml` (frontend, backend, mosquitto,
    cloudflared): bridge networking, `NODE_ENV=production`,
    `AEOLUS_PUBLIC_DEMO=true`, no host networking, no published
    1883/backend/DB ports, `no-new-privileges`, dropped caps, mem/cpu limits, no
    Docker socket
    - _Requirements: 12.1, 12.2, 14.1, 14.2, 11.4_

- [ ] 14. Golden/active database
  - [ ] 14.1 Establish `/opt/aeolus-demo/{golden,data}`; backend mounts only
    `data/`; golden mounted read-only or not at all
    - _Requirements: 13.1, 13.2_

- [ ] 15. Manual reset
  - [ ] 15.1 Add `scripts/reset-demo.sh` (orderly sequence) and
    `scripts/demo-health-check.sh`
    - _Requirements: 13.3, 13.4, 13.5_

- [ ] 16. Nightly reset
  - [ ] 16.1 Schedule the reset at ~`03:30` Australia/Sydney (cron/systemd timer)
    with maintenance flag + health gate; safety must not depend on it running
    - _Requirements: 13.3, 13.6_

- [ ] 17. Deploy & reset workflows
  - [ ] 17.1 Add a `workflow_dispatch` "Deploy Aeolus Demo" (build/publish for a
    chosen ref → deploy → health check) and an admin-only "Reset Public Demo";
    no auto-deploy on `main`
    - _Requirements: 14.5, 13.5_

- [ ] 18. Cloudflare Tunnel ingress
  - [ ] 18.1 Configure cloudflared as the sole public ingress; no direct
    80/443/1883/backend/DB exposure on the VM
    - _Requirements: 14.3_

- [ ] 19. Observability
  - [ ] 19.1 Surface operator-only signals (version/commit, backend/broker
    health, reset status, active WS sessions, rate-limit activity, 403/404
    spikes, resource usage, restart count); never expose to demo sessions
    - _Requirements: 15.2, 15.3_

- [ ] 20. Reset tests + final hostile pass
  - [ ]* 20.1 Reset test: mutate → reset → seeded state restored, temporary gone,
    golden unchanged, services healthy
    - _Validates: 16.5, 13.*_
  - [ ] 20.2 Manual hostile-client pass against the deployed demo before launch
    - _Requirements: 16.4_

- [ ] 21. Seed quality review & launch
  - [ ] 21.1 Review every seeded tab (distinct use case, meaningful state, no
    placeholders/sensitive data, trusted Logic only, works without LAN hardware,
    recovers after reset); then launch `demo.aeolus.com.au`
    - _Requirements: 15.1_

## Notes

- Phase A is the complete security boundary and is independently valuable and
  testable; Phase B makes it a public, disposable deployment.
- The guard is additive: it only ever removes capability from `public-demo`
  sessions and never alters normal sessions (Req 17).
- Governing rule (Req §33): arbitrary code/IDs/topics/URLs/credentials/durable
  text/host behaviour ⇒ deny by default; only bounded interactions against
  trusted seeded content are allowlisted.
- Established stack only: TypeScript (strict), Express, better-sqlite3,
  express-rate-limit, Vitest/supertest/fast-check, React/Zustand, Docker Compose,
  Cloudflare Tunnel, GitHub Actions.
