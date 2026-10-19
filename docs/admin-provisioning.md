# BuyO — Admin Provisioning (Phase 3, fallback removed in Phase 11)

Admin access is **database-backed** (`Users.role = 'admin'`) and granted
exclusively through the audited `admin:role` script. Nothing in the public API
can create an admin (`POST /api/auth/signup` always writes `role = 'customer'`;
unknown body fields are dropped by the validation whitelist).

> **Phase 11 change:** the Phase 2 `ADMIN_EMAILS` environment fallback has been
> **removed**. `utils/roles.isAdminUser` now trusts only `Users.role = 'admin'`.
> Setting `ADMIN_EMAILS` in `.env` has no effect. Rationale: an env-var edit
> granted admin with no audit trail, and by Phase 11 every intended admin could
> be (and the real database was verified to require) provisioning through the
> audited script. If you relied on `ADMIN_EMAILS`, grant the role explicitly:
>
> ```bash
> npm run admin:role -- --email you@example.com --role admin --confirm-local
> ```
>
> **Lockout safety (verified before removal):** the real `buyoDB` contained no
> `role='admin'` users and the real `.env` did not define `ADMIN_EMAILS`, so no
> legitimate admin lost access. Admin routes fail closed (403) for every
> account without the DB role; the admin UI redirects to its login page.

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
- **Dual-dialect since Migration Phase 7:** the guards and the audit line are
  identical on both databases. MySQL targets come from `MYSQL_*` env vars;
  PostgreSQL targets (`DB_DIALECT=postgres`) come from `PG_*` env vars only —
  never `DATABASE_URL`, loopback-only. The PostgreSQL CLI path is pinned by
  `npm run test:pg:tooling` (see migration-phase7.md).
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

## Admin authorization mechanics (current, post-Phase 11)

On every request to an admin route, `requireAuth` reloads the user fresh from
the database, then `requireAdmin` checks BOTH:

1. `user.isVerified === true` (an unverified account is refused with 403 even
   if it has `role = 'admin'`), and
2. `isAdminUser(user)`: `user.role === 'admin'` — the **sole** source of truth
   since Phase 11 (the `ADMIN_EMAILS` env fallback has been removed; setting
   that variable has no effect).

Everything fails closed: no JWT → 401; missing/unverified user → 401/403; a
role miss → 403. Client input can never grant admin (signup whitelists `role`
away; role changes only via the audited `admin:role` script). This behavior is
pinned by tests in `test/orders.test.js` ("admin order endpoints fail closed")
and `test/security.test.js` ("DB-backed admin role grants/revokes API access").

**Access-token session binding (Phase 11).** Access tokens carry a `pwv`
(password-version) claim; `requireAuth` rejects any token whose `pwv` no longer
matches the stored password hash. A password reset therefore immediately
invalidates every previously issued session token, not just outstanding reset
links.
