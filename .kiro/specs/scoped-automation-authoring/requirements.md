# Requirements Document

## Introduction

Aeolus is a local-first IoT/automation platform for small, mostly-trusted deployments. A prior feature (`resource-level-authorization`) made direct device and automation control routes authorize against the target resource's server-side ownership. However, one authorization boundary is still broken: **authored automation Logic executes with system-wide authority regardless of who authored it.**

A non-admin who holds `write` on one tab can create a script or form automation whose Logic then acts across the entire installation. The reasons are structural:

- The automation create route (`POST /api/automations`) trusts a caller-supplied `tabId`, and nothing binds the created automation to a scope.
- When an automation runs, the sandbox injects **all** devices (`deviceRegistry.getAll()`) and its host callbacks (`devices.action`, `mqtt.publish`, `db.*`, `http`) dispatch through the system-wide `CommandService`, which takes no principal or scope. Form rules can target arbitrary action targets, including webhooks.

This feature closes the escalation by giving every automation an explicit **authorization scope** that is carried into the runtime and enforced at dispatch. It does **not** simply lock authoring to admins; instead it lets a non-admin author safely, confined to the resources their owning tab already exposes. The model is a hybrid:

- **Admin-authored automations are unrestricted** — they run with system-wide authority, exactly as today (admins are already trusted).
- **Non-admin-authored automations are scoped** to a single owning tab chosen at creation. Their Logic may only act on the devices that tab exposes and the Data Store collections that tab surfaces; they may not publish raw MQTT; their outbound HTTP is limited to the sandbox's existing SSRF policy.

Scope is enforced at two layers (defense in depth): the sandbox injects only the in-scope device inventory and Data Store surface, and the `CommandService`/host callbacks re-check every dispatch against the scope so a script that fabricates an out-of-scope identifier is still refused.

Because a non-admin cannot edit the dashboard layout (that is admin-only), the **owning tab also acts as an exposing tab** for its automations. This lets a scoped author see, fire, and edit their own automation through the already-shipped resource-level guards without needing anyone to place a pane for them.

**Threat model context:** Small local-first deployments with a handful of mostly-trusted users. The goal is that the advertised permission model actually holds: `write` on a tab grants authority only over that tab's resources, whether exercised directly or through authored Logic. Priorities are correctness of the advertised model first, hardening against determined insiders second.

**In scope:**
- A persisted authorization scope per automation: an `authored_unrestricted` flag and an `owner_tab_id`.
- Binding scope at creation: admin → unrestricted; non-admin → scoped to a tab they hold `write` on.
- Making the owning tab an exposing tab for its automations (so scoped authors retain resource-level access).
- Runtime enforcement in the sandbox and `CommandService`: scoped device access, scoped Data Store access, denied raw MQTT publish, SSRF-only HTTP.
- Immutability of an automation's scope across non-admin updates.
- Fail-closed behaviour when a scoped automation has no resolvable owning tab.
- A migration adding the columns and backfilling existing automations as unrestricted.
- Frontend: let non-admin authors create/edit automations bound to an owning tab they control, show the effective scope, and keep admin authoring unchanged.

**Out of scope (future work / separate backlog items):**
- Per-automation MQTT publish namespaces (e.g. `aeolus/automations/{ruleId}/...`) that would let scoped automations publish safely. This feature denies scoped MQTT publish; the namespace model is a later enhancement.
- Consolidating outbound HTTP (script `http` and form-rule webhooks) behind one bounded, SSRF-checked host service. This feature keeps the existing sandbox SSRF policy and denies form-rule webhooks from scoped automations until that consolidation lands.
- Multi-tab-spanning non-admin automations. A scoped automation has exactly one owning tab; broader spans require an admin (unrestricted) author.
- Letting non-admins edit the dashboard layout or add panes.
- Any change to the group/tab permission model or the `read`/`interact`/`write` levels.

## Glossary

- **Aeolus**: The local-first IoT/automation platform being secured.
- **Permission_Level**: One of `read`, `interact`, `write`, ordered `read` < `interact` < `write`.
- **User**: An authenticated principal with a role (`admin` or `user`) and an optional group.
- **Admin**: A User whose role is `admin`.
- **Non_Admin_User**: A User whose role is `user`.
- **Automation**: A rule (row in `automation_rules`) identified by its rule id. A **Form_Automation** is declarative; a **Script_Automation** runs authored Logic in the sandbox. Either may carry a paired custom UI.
- **Authoring_Operation**: Creating, updating, or deleting an Automation.
- **Owning_Tab**: The single Tab to which a scoped Automation is bound at creation. Source of the Automation's runtime authority and an exposing tab for it.
- **Authorization_Scope**: The set of resources an Automation's runtime may act upon. Either **Unrestricted** (all devices, any MQTT topic, all Data Store, HTTP per SSRF policy) or **Scoped** to an Owning_Tab.
- **Unrestricted_Automation**: An Automation with `authored_unrestricted = 1`; runs with system-wide authority. Admin-authored automations and pre-upgrade automations are unrestricted.
- **Scoped_Automation**: An Automation with `authored_unrestricted = 0` and an Owning_Tab; runs confined to its Owning_Tab's exposed resources.
- **Tab_Device_Set**: The set of Devices a Tab exposes, computed live by the Device_Exposure_Resolver (the devices matched by that Tab's purposeful device panes against the current inventory).
- **Tab_Collection_Set**: The set of Data Store collections a Tab surfaces, from `collection_tab_assignments`.
- **Sandbox**: The isolated V8 runtime executing a Script_Automation's compiled Logic.
- **Host_Callback**: A sandbox-exposed capability that reaches the host — `devices.action`, `mqtt.publish`, `db.*`, `http`.
- **Command_Service**: The system-wide command dispatcher (`src/automations/command-service.ts`) through which device actions, form-rule actions, and sandbox MQTT publishes are dispatched.
- **Scope_Resolver**: The server-side component that maps an Automation rule id to its Authorization_Scope.
- **Resource_Guard**: The `requireAutomationPermission(level)` middleware from `resource-level-authorization`.
- **Migration_Backfill**: The one-time process that populates the new scope columns for existing automations.

## Requirements

### Requirement 1: Persisted authorization scope per automation

**User Story:** As a security reviewer, I want each automation to carry an explicit, server-side authorization scope, so that runtime authority is a property of the automation rather than an accident of the sandbox.

#### Acceptance Criteria

1. THE Aeolus data model SHALL store, per Automation, an `authored_unrestricted` flag and a nullable `owner_tab_id`.
2. WHEN `authored_unrestricted` is `1`, THE Automation SHALL be treated as an Unrestricted_Automation regardless of `owner_tab_id`.
3. WHEN `authored_unrestricted` is `0`, THE Automation SHALL be treated as a Scoped_Automation whose Owning_Tab is `owner_tab_id`.
4. WHEN a Tab referenced by `owner_tab_id` is deleted, THE Aeolus data model SHALL set that Automation's `owner_tab_id` to null without changing `authored_unrestricted`.
5. THE migration adding these columns SHALL preserve existing behaviour by setting `authored_unrestricted = 1` and `owner_tab_id = null` for every Automation that exists at upgrade time.

### Requirement 2: Scope binding at automation creation

**User Story:** As a non-admin author, I want to create an automation bound to a tab I control, so that I can build automations without being able to reach resources outside that tab.

#### Acceptance Criteria

1. WHEN an Admin creates an Automation, THE Aeolus API SHALL create it as an Unrestricted_Automation (`authored_unrestricted = 1`, `owner_tab_id = null`).
2. WHEN a Non_Admin_User creates an Automation, THE Aeolus API SHALL require a target tab identifier and SHALL require that the user's group holds `write` on that tab; on success it SHALL create a Scoped_Automation with `authored_unrestricted = 0` and `owner_tab_id` set to that tab.
3. IF a Non_Admin_User creates an Automation without a target tab identifier, THEN THE Aeolus API SHALL reject the request with HTTP status 403 and SHALL NOT create an Automation.
4. IF a Non_Admin_User creates an Automation naming a tab on which the user's group does not hold `write`, THEN THE Aeolus API SHALL reject the request with HTTP status 403 and SHALL NOT create an Automation.
5. THE Aeolus API SHALL derive whether a creation is admin or non-admin from the authenticated user's server-side role, never from the request body.

### Requirement 3: The owning tab exposes its automations

**User Story:** As a non-admin author, I want to see, fire, and edit the automation I created without needing an admin to place it on my dashboard, so that scoped authoring is usable on its own.

#### Acceptance Criteria

1. WHEN the exposing tabs of an Automation are resolved, THE Aeolus API SHALL include the Automation's `owner_tab_id` (when non-null) in addition to the tabs derived from panes referencing the Automation.
2. WHEN a Non_Admin_User whose group holds at least `read` on a Scoped_Automation's Owning_Tab lists automations, THE Aeolus API SHALL include that Automation in the result.
3. WHEN a Non_Admin_User whose group holds at least `write` on a Scoped_Automation's Owning_Tab updates or deletes that Automation, THE Resource_Guard SHALL authorize the request.
4. WHEN a Non_Admin_User whose group holds at least `interact` on a Scoped_Automation's Owning_Tab fires or toggles that Automation, THE Resource_Guard SHALL authorize the request.
5. THE inclusion of the owning tab as an exposing tab SHALL survive dashboard layout saves, because it derives from `owner_tab_id` rather than from panes.

### Requirement 4: Scope is immutable across non-admin updates

**User Story:** As a security reviewer, I want a non-admin to be unable to widen an automation's scope, so that authoring authority cannot be escalated after creation.

#### Acceptance Criteria

1. WHEN a Non_Admin_User updates an Automation, THE Aeolus API SHALL NOT change that Automation's `authored_unrestricted` or `owner_tab_id`.
2. IF an update request from a Non_Admin_User carries scope fields (an unrestricted flag or an owner tab), THEN THE Aeolus API SHALL ignore those fields and leave the stored scope unchanged.
3. WHEN an Admin updates an Automation, THE Aeolus API MAY change the Automation's scope, and any such change SHALL be derived only from an explicit admin action.

### Requirement 5: Scoped device authority

**User Story:** As a security reviewer, I want a scoped automation to act only on devices its owning tab exposes, so that authored Logic cannot operate unrelated devices.

#### Acceptance Criteria

1. WHEN the Sandbox executes a Scoped_Automation, THE Sandbox SHALL inject only the devices in the Owning_Tab's Tab_Device_Set (not the full inventory) as the automation's device list and device map.
2. WHEN a Scoped_Automation dispatches a device action or toggle through the Command_Service, IF the target device is not in the Owning_Tab's Tab_Device_Set, THEN THE Command_Service SHALL refuse the dispatch with a terminal failure and SHALL NOT execute it.
3. WHEN an Unrestricted_Automation executes, THE Sandbox SHALL inject the full device inventory and THE Command_Service SHALL apply no device-scope restriction, as today.
4. THE device-scope check at dispatch SHALL be evaluated against the Owning_Tab's Tab_Device_Set as it exists at dispatch time.
5. WHEN a Scoped_Automation's device action is refused for being out of scope, THE Aeolus API SHALL record a log entry identifying the rule id and the refused device id.

### Requirement 6: Denied raw MQTT publish for scoped automations

**User Story:** As a security reviewer, I want a scoped automation to be unable to publish arbitrary MQTT, so that it cannot drive devices or systems outside its tab through the message bus.

#### Acceptance Criteria

1. WHEN a Scoped_Automation attempts to publish an MQTT message (via the sandbox `mqtt.publish` callback or a form-rule publish action), THE Command_Service SHALL refuse the publish with a terminal failure and SHALL NOT publish.
2. WHEN an Unrestricted_Automation publishes an MQTT message, THE Command_Service SHALL publish it, as today.
3. WHEN a Scoped_Automation's publish is refused, THE Aeolus API SHALL record a log entry identifying the rule id.

### Requirement 7: Scoped Data Store authority

**User Story:** As a security reviewer, I want a scoped automation to read and write only the Data Store collections its owning tab surfaces, so that it cannot access unrelated stored data.

#### Acceptance Criteria

1. WHEN the Sandbox wires Data Store callbacks for a Scoped_Automation, THE Sandbox SHALL permit collection reads and writes (`db.write`, `db.query`) only for collections in the Owning_Tab's Tab_Collection_Set.
2. IF a Scoped_Automation performs a Data Store collection operation on a collection outside its Tab_Collection_Set, THEN THE Sandbox SHALL refuse the operation and SHALL NOT perform it.
3. WHEN a Scoped_Automation lists collections (`db.collections`), THE Sandbox SHALL return only collections in the Owning_Tab's Tab_Collection_Set.
4. WHEN a Scoped_Automation uses the shared key-value bucket operations (`db.get`, `db.set`, `db.delete`), THE Sandbox SHALL refuse those operations, because shared buckets have no per-tab ownership model.
5. WHEN an Unrestricted_Automation uses the Data Store, THE Sandbox SHALL apply no collection or bucket restriction, as today.

### Requirement 8: Scoped outbound HTTP

**User Story:** As a security reviewer, I want a scoped automation's outbound HTTP confined to the platform's existing safety policy, so that it cannot be used to reach internal network targets.

#### Acceptance Criteria

1. WHEN a Scoped_Automation performs an outbound HTTP request through the sandbox `http` callback, THE Sandbox SHALL apply the existing SSRF address policy, as it does for all sandbox HTTP today.
2. WHEN a Scoped_Automation (as a Form_Automation) uses a webhook action, THE Command_Service SHALL refuse the webhook, because form-rule webhooks currently bypass the sandbox SSRF policy.
3. WHEN an Unrestricted_Automation performs outbound HTTP or a webhook action, THE Aeolus API SHALL apply current behaviour unchanged.

### Requirement 9: Fail-closed when a scoped automation has no owning tab

**User Story:** As a security reviewer, I want a scoped automation whose owning tab is gone to be able to do nothing, so that losing a tab can never silently widen authority.

#### Acceptance Criteria

1. WHEN a Scoped_Automation has a null `owner_tab_id` (for example after its Owning_Tab was deleted), THE Scope_Resolver SHALL resolve an empty Authorization_Scope: an empty Tab_Device_Set, an empty Tab_Collection_Set, no MQTT publish, and no shared-bucket access.
2. WHEN a Scoped_Automation with a null `owner_tab_id` executes, THE Sandbox SHALL inject an empty device list and THE Command_Service SHALL refuse every device action and publish it attempts.
3. A Scoped_Automation with a null `owner_tab_id` SHALL NOT be treated as an Unrestricted_Automation under any circumstance.

### Requirement 10: Unrestricted automations retain full authority

**User Story:** As an admin author, I want my automations to keep working with full authority, so that adding scoping does not weaken legitimate admin-authored logic.

#### Acceptance Criteria

1. WHEN an Unrestricted_Automation executes, THE Sandbox and Command_Service SHALL apply no device, MQTT, Data Store, or webhook scope restriction introduced by this feature.
2. THE Migration_Backfill SHALL leave every pre-upgrade Automation executable with the same authority it had before the upgrade, by marking it unrestricted.
3. WHEN an Admin creates or (per Requirement 4.3) reclassifies an Automation as unrestricted, THE Automation SHALL execute with full authority.

### Requirement 11: Frontend scoped authoring

**User Story:** As a non-admin author, I want the dashboard to let me create and edit automations bound to a tab I control and to show me what that automation can touch, so that scoped authoring is understandable and does not present actions that will fail.

#### Acceptance Criteria

1. WHEN a Non_Admin_User authors a new Automation in the UI, THE frontend SHALL require the user to choose an Owning_Tab from the tabs on which the user holds `write`, and SHALL send that tab identifier with the create request.
2. IF a Non_Admin_User holds `write` on no tab, THEN THE frontend SHALL not offer automation authoring and SHALL explain that authoring requires write access to a tab.
3. WHEN a Non_Admin_User views or edits a Scoped_Automation, THE frontend SHALL indicate the automation's Owning_Tab and that its authority is limited to that tab's devices and collections.
4. WHEN an Admin authors an Automation, THE frontend SHALL behave as today and SHALL create an Unrestricted_Automation.
5. WHEN a Non_Admin_User edits a Scoped_Automation, THE frontend SHALL NOT present controls that purport to change the automation's Owning_Tab or unrestricted status.

### Requirement 12: No regression for existing behaviour

**User Story:** As an existing user, I want current automations and admin flows to keep working, so that introducing scope does not break the platform.

#### Acceptance Criteria

1. THE feature SHALL leave every existing Automation registered and executable after upgrade, with unchanged authority (unrestricted).
2. WHEN an Admin performs any Authoring_Operation, THE Aeolus API SHALL authorize it regardless of tab assignments, as today.
3. WHEN a Non_Admin_User performs an in-scope control operation (fire/toggle/state) on an Automation exposed to them, THE Aeolus API SHALL authorize it, as established by `resource-level-authorization`.
4. THE feature SHALL NOT change the authorization of device routes, the layout route, or the group/user management routes.
