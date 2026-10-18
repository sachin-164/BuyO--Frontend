# BuyO Backend

Express + MySQL (Sequelize) API for the BuyO shopping PWA.

## Install

```bash
cd backend
npm install
```

## Configure

Copy `.env.example` to `.env` and fill in your MySQL, JWT and Gmail SMTP values:

```bash
cp .env.example .env
```

## Run

```bash
npm start        # production
npm run dev      # nodemon watch mode (requires nodemon: npm install -D nodemon)
```

Server listens on `PORT` (default 5000). The schema is **not** synced automatically at boot. Set it up explicitly for local dev:

```bash
npm run db:sync -- --confirm-local      # create missing tables (fresh local DB)
npm run db:migrate -- --confirm-local   # apply pending schema migrations
```

## Schema & migrations (Phase 3)

The schema is versioned in `backend/migrations/NNN_*.sql` and applied with `db:migrate`
(bookkeeping + checksums in the `schema_migrations` table). See `docs/schema-v1.md` for the
full schema reference, rollback/recovery strategy, and the variants/specs plan.

```bash
npm run db:migrate -- --confirm-local --status   # list applied/pending migrations
npm run db:backup                                # JSON backup (backend/backups/, git-ignored)
npm run db:restore -- --target buyoDB_scratch_check --confirm-local   # drill/verify restore
```

All of these tools are local-only: they refuse non-loopback hosts, `NODE_ENV=production`
and a missing `--confirm-local` flag. `sequelize.sync({ alter: true })` is never used for
schema evolution (`db:sync --alter` is refused).

## Admin provisioning

Admins are DB-backed (`Users.role`) and granted only through the audited script:

```bash
npm run admin:role -- --email you@example.com --role admin --confirm-local
npm run admin:role -- --list --confirm-local
```

See `docs/admin-provisioning.md`. Public signup always creates `role = 'customer'`;
`ADMIN_EMAILS` remains as a transitional fallback in `utils/roles.js`.

## Tests

```bash
npm test    # auth + security + migrations suites; scratch DBs only (buyoDB_ph2_test / buyoDB_ph3_*)
```

## API

| Method | Route | Description |
|---|---|---|
| GET  | `/api/auth/verify?token=...` | Email verification link target |
| POST | `/api/auth/signup` | Create user + send verification email |
| POST | `/api/auth/login` | Returns JWT (requires verified email) |
| POST | `/api/auth/forgot-password` | Emails a single-use reset link (generic response) |
| POST | `/api/auth/reset-password` | Resets password via emailed token |
| GET  | `/api/auth/me` | Current user (JWT required) |
| GET  | `/api/products` | All products |
| GET  | `/api/products/:id` | Single product |
| POST | `/api/products` | Add product — **admin only** (JWT + DB `role = 'admin'`, `ADMIN_EMAILS` fallback); multipart field `image` |
| GET  | `/api/cart` | Cart items *(stub — real logic pending)* |
| POST | `/api/cart` | Add to cart *(stub)* |
| DELETE | `/api/cart/:id` | Remove from cart *(stub)* |
| GET/POST/DELETE | `/api/wishlist`, `/api/wishlist/:id` | Wishlist *(stub)* |

`POST /api/products` body (JSON or multipart): `name`, `category`, `description`, `mrpPrice`, `sellingPrice`, optional `image` (URL) or `image` file upload. Uploaded files land in `backend/uploads/` and are served at `/uploads/<file>`.

## Security (Phase 2 + Phase 3)

- `requireAuth` verifies the JWT and reloads the user from the DB on every request.
- `requireAdmin` authorizes via the DB `Users.role` column, with the server-side
  `ADMIN_EMAILS` allowlist as a transitional fallback (see `docs/admin-provisioning.md`).
- Request validation whitelists body fields; public signup can never set `role`.
- Helmet security headers; CORS allowlist (local dev origins + the `FRONTEND_URL` origin + `CORS_ALLOWED_ORIGINS`).
- Rate limiting: a global API limiter plus a strict limiter on auth endpoints (see `.env.example` for overrides).
- Request validation on all write endpoints; the centralized error handler never leaks internal details for 5xx responses.
- Password reset links expire after 30 minutes and are single-use (bound to the current password hash); reset responses are enumeration-safe.
