# Temporary test account — local login testing

Purpose: log into the real storefront **without email verification working yet**,
using one temporary customer account. Nothing here touches other users, the
schema, or email-verification behaviour for anyone else.

Script: `backend/scripts/test-user.js` (run via `npm run test:user`).

## What it does (and does not do)

- Creates ONE account in the **existing** `Users` table with the **same**
  password hashing as normal signup (bcrypt, cost 10) and the same email
  (lowercased, format-checked) and password (8–72 chars) rules.
- Always `role = customer`. Never grants admin.
- Marked with the name `BuyO Test Account (temporary)` — this is how the script
  recognises its own account later.
- With the explicit `--verified` flag, sets **only that account's**
  `isVerified = 1`. Everyone else's verification state is untouched; the login
  page keeps enforcing verification for all other users.
- **Idempotent:** re-running never creates a duplicate and NEVER changes the
  password after creation. If the email belongs to a pre-existing user (not
  created by this script), the script refuses to modify it.
- Credentials are read from environment variables or an interactive prompt —
  never from command-line flags, never printed, never stored in git.

## 1. Create the account (interactive — recommended)

```powershell
cd backend
npm run test:user -- --verified --confirm-local
# prompts: email  ->  password (echo hidden)
```

Non-interactive alternative (e.g. PowerShell before a scripted run):

```powershell
cd backend
$env:TEST_USER_EMAIL = "you@gmail.com"
$env:TEST_USER_PASSWORD = "your-strong-password"   # 8-72 chars, same rule as signup
npm run test:user -- --verified --confirm-local
Remove-Item Env:TEST_USER_EMAIL, Env:TEST_USER_PASSWORD   # clear from the session
```

The same two variable names can instead be placed in `backend/.env`
(git-ignored) — never in any tracked file.

Omit `--verified` if you want a normal *unverified* account (login will be
refused with the usual "Email not verified" message — useful for testing that
the gate still works). Re-run later with `--verified` to flip only this account.

Guards: the script refuses to run without `--confirm-local`, when
`NODE_ENV=production`, or against a non-loopback host — exactly like the other
local DB tools.

## 2. Test login

1. Start the backend (`npm start` in `backend/`) and open the site
   (e.g. `http://127.0.0.1:5503/login.html`).
2. Sign in with the email + password you just set.
3. Expected: successful login, header shows the account, and the API returns
   `role: "customer"` (open `/api/auth/me` from the browser devtools — it must
   say `isAdmin: false`).

Quick negative checks (optional):
- Wrong password → "Invalid email or password." (401)
- A second account created *without* `--verified` → "Email not verified" (403)

## 3. Remove the account when done

```powershell
cd backend
npm run test:user -- --delete --confirm-local    # prompts for the email only
```

Deletes only marker-named test accounts; the account's cart, wishlist,
addresses and orders cascade with it. Pre-existing users are refused.

To reset instead of delete: run `--delete`, then create again with `--verified`
and a fresh password (re-runs deliberately never overwrite an existing
password).
