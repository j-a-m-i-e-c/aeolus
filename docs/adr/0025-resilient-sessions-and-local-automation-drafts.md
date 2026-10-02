# ADR-0025: Resilient sessions, bounded administrator policies and local draft recovery

- **Status:** Proposed — implementation in Build 60 patch; acceptance requires CI and Pi/browser verification
- **Date:** 2026-09-30

## Context

Aeolus targets local, intermittently connected networks. Access JWTs expire every 15 minutes, renewed using a refresh cookie. A refresh request that throws because a Pi is restarting or Wi-Fi disconnects is not evidence of revoked credentials. Logging out on that signal can discard an editor's unsaved Automation Project. Increasing the JWT lifetime alone does not protect against tab reloads, crashes, browser restarts, conflicting edits or expired sessions. Administrators also need different overall session policies for different operator accounts without keeping long-lived bearer access JWTs.

## Decision

**Recovery versus rejection.** Keep the 15-minute access JWT in memory. On refresh HTTP `401/403`, clear auth; on network failures/5xx, keep existing state and retry periodically and on regained connectivity/focus. On initial load when the Pi cannot be reached, show an offline/reconnecting screen rather than incorrectly claiming the site is unconfigured or the cookie is invalid. A session is considered authenticated for UI continuity while temporarily offline, but protected API calls still depend on server validation; stale access tokens confer no offline authority.

**Local drafts.** Save unsaved automation metadata and the complete multi-file Project in origin-local IndexedDB, namespaced by logged-in user and automation/editor location. Writes are debounced, and a stored draft is *offered*, never applied automatically, after reopening. Mark when the loaded server version differs from the draft's original baseline. A pre-save project re-read detects a server change and blocks a naive overwrite of an already-changed project. Local snapshots are for recovery only, not authoritative server revisions and not a cross-device sync feature. Do not store credentials or tokens in them. A real server-side atomic revision/precondition is still needed if simultaneous multi-editor changes become important; read-before-write has an acknowledged race.

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
- A pre-save project re-read catches common concurrent changes but cannot guarantee an atomic compare-and-swap with the subsequent PUT. Introduce server revision IDs/`If-Match` before advertising full collaborative conflict safety.
- Changing a session from 7 to 30 days extends **newly issued sessions**, not the absolute expiry already recorded on old refresh credentials. Users should sign out/in to adopt a longer lifetime.
- Local draft writes can fail when IndexedDB is unavailable/quota-limited, so the editor must surface that explicitly.

## Revisit when

Aeolus supports true collaborative authoring, multi-device draft sync, regulated session controls, browser-based encryption or a server-side revision API. Validate drafts in the browser, including offline reconnect, crash recovery and concurrent editors, before marking this ADR Accepted.

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
- `docs/security/authentication.md`
