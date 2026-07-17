# Set up groups and permissions

Groups decide which dashboard tabs a normal user can see and what they can do there.

## Permission levels

| Level | Allows |
|---|---|
| `read` | View the tab |
| `interact` | Use normal controls and fire actions |
| `write` | Edit writable content such as panes and automation configuration |

The hierarchy is:

```text
write > interact > read
```

## Create a group

1. Log in as the administrator.
2. Open **Security**.
3. Select **Users & Groups**.
4. In the Groups section, choose **Add Group**.
5. Enter a name.
6. Select the tabs the group should see.
7. Set a permission for each selected tab.
8. Save the group.

## Example

| Group | Workshop | House | System |
|---|---|---|---|
| Operators | write | interact | read |
| Guests | read | interact | none |

## Edit or delete a group

Use the controls on the group card.

Deleting a group removes its assignments. Users who belonged to it can still sign in, but they will not receive normal tab access until they are assigned to another group.

## Notes

- Create a group before creating a normal user.
- The administrator bypasses group permissions.
- The Security page itself is admin-only.
- The current model is tab-based, not full tenant or resource isolation. See [Permissions](../security/permissions.md).
