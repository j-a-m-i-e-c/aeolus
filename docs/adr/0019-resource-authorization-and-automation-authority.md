# ADR-0019: Server-resolved resource authorization and automation authority

- **Status:** Accepted (retrospective)
- **Date:** 2026-09-30

## Context

Aeolus has user groups with `read`, `interact`, and `write` rights on dashboard tabs. Devices and automations can appear on more than one tab, and code written by non-admins can issue real physical commands. Neither a client-supplied tab ID nor the ability to open an editor establishes authority over an underlying device. A static authorization snapshot would also become stale when a tab, pane, or resource assignment changes.

## Decision

The backend resolves the tabs **actually exposing a resource**, using resource ownership and live device exposure. A user's effective permission is the highest permitted level on those tabs; API handlers enforce the required level using this server-derived mapping. The request cannot nominate an unrelated privileged tab to increase access. The list/filter path uses the same resolver instead of returning every resource then relying on the UI to hide rows. Administrative bypass is explicit at call sites.

Non-admin-authored automations bind to an owning tab and receive a **runtime-scoped** set of exposed devices and collections. The scope is re-resolved from current ownership/exposure at command and data boundaries. Unknown rules and scoped automations whose owning tab has disappeared resolve to empty scopes, never to unrestricted authority. Admin-authored or explicitly legacy unrestricted rules are represented as a distinct `unrestricted` scope, not as an accidentally empty restriction. Restricted automations do not gain raw MQTT publish or shared-bucket access merely because their UI can display those features.

## Alternatives considered

- **Trust `tabId` in each request:** simpler queries, but a caller could claim whichever tab has the strongest rights, and a pane's visibility could be misrepresented as permission.
- **Authorize only at UI/editor entry:** can't protect other API clients, later automation executions, or internal command paths.
- **Capture permanent permissions when a rule is created:** easier dispatch, but deleted or reassigned resources would leave stale authority.
- **Treat missing ownership as unrestricted:** convenient compatibility fallback, unacceptable as a default failure mode.

## Consequences

The backend must maintain accurate tab/resource exposure and invoke authorization at every relevant boundary. Changes to dashboard layout or ownership may intentionally remove an automation's ability to command hardware immediately. Authorization and presentation have separate responsibilities. Legacy unrestricted rows remain an explicit migration/compatibility concern; they must not silently become the default for new non-admin authored rules.

This ADR concerns **resource authority**, not the command result's proof tier (ADR-0006) or the custom UI's iframe boundary (ADR-0005). All three remain necessary.

## Revisit when

If Aeolus introduces multiple tenants, automation package grants, fleet-wide delegation, or long-running jobs with stable capability snapshots, explicitly design the corresponding authorization boundary instead of inferring it from current tabs.

## Implementation anchors

- `src/auth/permission-resolver.ts`
- `src/auth/device-exposure-resolver.ts`
- `src/auth/resource-ownership-store.ts`
- `src/automations/automation-scope-resolver.ts`
- `src/automations/command-service.ts`
- `docs/security/permissions.md`
- [ADR-0005](0005-opaque-origin-ui-sandbox.md), [ADR-0006](0006-truthful-command-lifecycle.md)
