# BuyO — Admin Provisioning (Phase 3)

Admin access is **database-backed** (`Users.role = 'admin'`) and granted
exclusively through the audited `admin:role` script. Nothing in the public API
can create an admin (`POST /api/auth/signup` always writes `role = 'customer'`;
unknown body fields are dropped by the validation whitelist).

## Procedure (local dev)

```bash
# 1. The account must exist (sign up + verify email in the app first).
# 2. Grant admin (prints a timestamped audit line):
npm run admin:role -- --email you@example.com --role admin --confirm-local

# List current admins:
npm run admin:role -- --list --confirm-local

# Revoke:
npm run admin:role -- --email you@example.com --role customer --confirm-local
```

- The script refuses non-loopback hosts, `NODE_ENV=production` and a missing
  `--confirm-local` flag; the database must be listed in
  `DB_ADMIN_ALLOWED_DATABASES` (default: `buyoDB`).
- Role changes take effect on the next API request — `requireAuth` reloads the
  user from the database on every request.
- Unverified accounts can be granted ahead of time, but `requireAdmin` also
  requires a verified email, so they cannot use admin APIs until verified.
- Keep the printed `ADMIN ROLE CHANGE [...]` line in your deployment notes;
  the `Users.role` column is the single source of truth and can be audited with
  `SELECT email, role FROM Users WHERE role = 'admin'`.

## Hosted environments (later phase)

When the backend is hosted, run the same script against the hosted database in a
controlled maintenance step (explicit `--allow-remote`-style gate will be added
with the release-phase procedure). Do **not** hand-edit roles with ad-hoc SQL in
production.

## Transitional note (ADMIN_EMAILS)

`utils/roles.js` still accepts the Phase 2 `ADMIN_EMAILS` env allowlist as a
fallback so no existing admin loses access during the schema transition.
Sunset plan:

1. Grant `role = 'admin'` to every intended admin via this script.
2. Verify each with `GET /api/auth/me` (`isAdmin: true`).
3. Remove `ADMIN_EMAILS` from `.env` and delete the fallback from
   `utils/roles.js` in a later phase (breaking change will be noted in the
   phase report).
