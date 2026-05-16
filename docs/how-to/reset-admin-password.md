# Reset Admin Password

Emergency recovery when you're locked out of the admin account.

## Option 1: Use another admin account

If you have multiple admin accounts, log in with the other one and reset the password via the Users section.

## Option 2: Database reset (nuclear option)

If you're completely locked out:

1. **Stop Aeolus**
   ```bash
   docker compose down
   # or Ctrl+C if running directly
   ```

2. **Open the SQLite database**
   ```bash
   sqlite3 data/aeolus.db
   ```

3. **Delete all users and tokens**
   ```sql
   DELETE FROM refresh_tokens;
   DELETE FROM users;
   .quit
   ```

4. **Restart Aeolus**
   ```bash
   docker compose up -d
   # or npm run dev
   ```

5. **Open the dashboard** — you'll see the Setup Page again. Create a new admin account.

## What you lose

- All user accounts are deleted
- All refresh tokens are invalidated
- Groups and their tab assignments are **preserved**
- Tabs, panes, automations, devices, connectors — all **preserved**
- MQTT credentials — **preserved**

After creating the new admin, you'll need to recreate any non-admin user accounts and reassign them to groups.

## Prevention

- Use a password manager
- Consider setting the `JWT_SECRET` environment variable so you have a known value (though this doesn't help with forgotten passwords directly)
