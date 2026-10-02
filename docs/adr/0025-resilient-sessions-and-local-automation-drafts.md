# ADR-0025: Resilient sessions, bounded administrator policies and local draft recovery

- **Status:** Accepted
- **Date:** 2026-09-30 (proposed), 2026-10-02 (accepted after browser verification)

## Context

Aeolus targets local, intermittently connected networks. Access JWTs expire every 15 minutes, renewed using a refresh cookie. A refresh request that throws because a Pi is restarting or Wi-Fi disconnects is not evidence of revoked credentials. Logging out on that signal can discard an editor's unsaved Automation Project. Increasing the JWT lifetime alone does not protect against tab reloads, crashes, browser restarts, conflicting edits or expired sessions. Administrators also need different overall session policies for different operator accounts without keeping long-lived bearer access JWTs.

## Decision

**Recovery versus rejection.** Keep the 15-minute access JWT in memory. On refresh HTTP `401/403`, clear auth; on network failures/5xx, keep existing state and retry periodically and on regained connectivity/focus. On initial load when the Pi cannot be reached, show an offline/reconnecting screen rather than incorrectly claiming the site is unconfigured or the cookie is invalid. A session is considered authenticated for UI continuity while temporarily offline, but protected API calls still depend on server validation; stale access tokens confer no offline authority.

**Local drafts.** Save unsaved automation metadata and the complete multi-file Project in origin-local IndexedDB, namespaced by logged-in user and automation/editor location. Writes are debounced, and a stored draft is *offered*, never applied automatically, after reopening. Mark when the loaded server version differs from the draft's original baseline. A pre-save project re-read detects a server change and blocks a naive overwrite of an already-changed project. Local snapshots are for recovery only, not authoritative server revisions and not a cross-device sync feature. Do not store credentials or tokens in them. The draft mechanism itself remains recovery-only. Atomic simultaneous-save protection is specified separately by ADR-0026 rather than being a responsibility of this ADR.

**Admin policy.** Keep short-lived JWTs fixed. Administrators can configure per-user refresh-session lifetimes (1, 7, or 30 days) and optional inactivity (disabled, 30 minutes, 2 hours or 8 hours) from user provisioning. Persist these with the user and apply them server-side at refresh. An absolute session lifetime never silently extends through background activity. Only deliberate frontend user interactions update the inactivity timer when the refresh occurs; passive polling does not. Normal logins receive an HttpOnly strict-SameSite cookie sized for their per-user policy. When policies shrink, existing refresh credentials are subject to the stricter rule at their next refresh. Existing 15-minute access JWTs may survive until expiry; this is not immediate token revocation.

## Alternatives considered

- **One very long-lived bearer JWT:** simpler refresh handling but makes stolen bearer credentials more useful, and does nothing about browser crash or unsaved drafts.
- **Treat every failed refresh as revoked:** conflates network availability with identity; particularly harmful to offline-first Aeolus.
- **Autosave unfinished code directly to the server:** would need a new draft publishing/access model and could overwrite working automations or leak incomplete changes to other operators.
- **Silently restore IndexedDB drafts on editor mount:** could replace a newer server revision before anyone realizes it.
- **Perpetual background refresh as evidence of user activity:** leaves abandoned operator sessions active indefinitely.

## Consequences and limitations

- Local drafts live in the browser profile; they are not encrypted against another person with access to that profile. Logging out does not automatically destroy recoverable authored work. Advise shared-computer users accordingly.
- Temporary disconnection preserves the editor but does not mean offline server mutations succeed; drafts handle that gap.
- Inactivity is sampled when refresh occurs, not continuously every keystroke at the server. A session with no refresh requests is rejected when it next refreshes; already-issued JWTs remain valid for their maximum 15 minutes. Frontend activity signalling is a usability-based session idle policy, not strong proof of physical user presence; malicious clients can issue authorized requests.
- Draft recovery does not attempt to merge competing authored code. ADR-0026 adds server revision preconditions so a stale save can be rejected atomically while this ADR keeps the losing browser draft recoverable.
- Changing a session from 7 to 30 days extends **newly issued sessions**, not the absolute expiry already recorded on old refresh credentials. Users should sign out/in to adopt a longer lifetime.
- Local draft writes can fail when IndexedDB is unavailable/quota-limited, so the editor must surface that explicitly.

## Verification

This ADR was accepted on the strength of `e2e/session-drafts.spec.ts`, which drives a real Chromium against the Compose stack. The three conditions this ADR set for acceptance — crash recovery, concurrent editors, offline reconnect — are each covered:

| Claim | How it is established |
|---|---|
| Unsaved authoring survives losing the tab | Edit, wait for the snapshot, reload, and find the draft offered |
| A draft is offered, never applied | After reload the editor still shows the server version until **Restore** is pressed |
| A draft never reaches the server | The project endpoint still returns the server version while a draft exists |
| Discard is durable | The snapshot is gone from IndexedDB and stays gone across a further reload |
| A changed project refuses a save | Another editor's write via the API makes the next save report the conflict and leave their work intact |
| A refused save keeps the local draft | The draft is still offered after reloading the blocked editor |
| An outage ends neither session nor editor | With the API refused, the editor keeps its content, stays signed in, and saves once connectivity returns |
| An unreachable server is not a login screen | A reload with the API refused shows the reconnecting screen, not Create Admin or Sign in, and recovers on focus |
| An admin's session length reaches the cookie | A user provisioned at 1 day receives `Max-Age=86400`, `HttpOnly`, `SameSite=Strict` |

Two qualifications on that evidence. The outage cases refuse API requests at the browser rather than physically interrupting a network, so they exercise the same code path a Pi reboot or Wi-Fi drop reaches, not the physical event. And the per-user session policy is enforced in `token-service.ts`, covered by unit tests for absolute expiry, idle expiry and policy reduction applied to already-issued sessions; the e2e test above establishes only that an administrator's choice reaches the issued cookie.

The original read-before-write limitation led to ADR-0026. This ADR remains about recovery rather than collaboration; its browser verification is still valid independently of the stronger server-side revision protocol.

## Revisit when

Aeolus supports true collaborative authoring, multi-device draft sync, regulated session controls or browser-based encryption. Server-side revision consistency is now handled by ADR-0026.

## Implementation anchors

- `frontend/src/store/auth-store.ts`
- `frontend/src/hooks/useAutomationDraft.ts`
- `frontend/src/lib/automation-drafts.ts`
- `frontend/src/components/AutomationsPage.tsx`
- `frontend/src/components/panes/AutomationPane.tsx`
- `frontend/src/pages/UserManagementPage.tsx`
- `src/auth/token-service.ts`
- `src/auth/user-service.ts`
- `src/api/routes/auth.routes.ts`
- `src/db/migrations/019-session-policies.ts`
- `frontend/src/lib/automation-drafts.test.ts` — the draft store against a real IndexedDB
- `e2e/session-drafts.spec.ts` — the browser verification this ADR's acceptance rests on
- `docs/security/authentication.md`
