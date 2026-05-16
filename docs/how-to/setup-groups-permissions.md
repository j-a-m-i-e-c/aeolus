# Set Up Groups & Permissions

Groups control what tabs each user can see and what they can do on those tabs.

## How it works

1. You create a **group** (e.g., "Family", "Guests", "Kids")
2. You assign **tabs** to that group with a permission level per tab
3. You assign **users** to the group

Each user belongs to exactly one group. The admin bypasses all group restrictions.

## Permission levels

| Level | Icon | What it allows |
|-------|------|---------------|
| Read | 👁 Eye | View only — all controls disabled, pure observation |
| Interact | 🖱 Pointer | Toggle devices, fire automations, use buttons — but can't edit code or manage panes |
| Write | ✏️ Pen | Full control — edit automation code, add/remove panes, configure connectors |

## Create a group

1. Go to the **System** tab
2. Scroll to the **Groups** section
3. Click **Add Group**
4. Enter a **group name** (e.g., "Family")
5. In the **Tab Assignments** section:
   - Check the tabs you want this group to access
   - For each checked tab, click the permission level button (Read / Interact / Write)
6. Click **Create**

## Example setup

**Scenario:** You have tabs for Living Room, Kitchen, and Bedroom.

| Group | Living Room | Kitchen | Bedroom |
|-------|-------------|---------|---------|
| Family | Write | Write | Write |
| Guests | Interact | Interact | — |
| Kids | Interact | Read | Interact |

- Family members can do everything on all three tabs
- Guests can control devices in Living Room and Kitchen, but can't see Bedroom at all
- Kids can control devices in Living Room and Bedroom, but can only observe the Kitchen

## Edit a group

1. Click the **pencil icon** on the group card
2. Change the name or tab assignments
3. Click **Save Changes**

Changes take effect on users' next token refresh (within 15 minutes).

## Delete a group

1. Click the **trash icon** on the group card
2. If the group has users assigned, you'll see a warning
3. Confirm deletion

Users in a deleted group lose all tab access until you reassign them to a new group.

## Tips

- Create groups before creating users — you need a group to assign during user creation
- The three system tabs (System, Connectors, Data) can be assigned to groups like any other tab
- Admin-only actions (user/group management, tab creation, MQTT credentials) are never controlled by groups — only the admin can do those regardless
