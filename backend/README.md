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
npm test    # auth + security + migrations + catalog + cart/wishlist + orders suites; scratch DBs only (buyoDB_ph2_test / buyoDB_ph3_*)
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
| GET  | `/api/categories` | All categories (public, includes `productCount`) |
| POST | `/api/categories` | Create category — **admin only** |
| PUT  | `/api/categories/:id` | Update category (name/slug/description/taxRate) — **admin only** |
| DELETE | `/api/categories/:id` | Delete category — **admin only** (products survive: FK `SET NULL`, legacy `category` string kept) |
| GET  | `/api/products` | Product list (public) — `?q=` search, `?category=` slug/id/legacy name, `?minPrice=`/`?maxPrice=`, `?inStock=`, `?sort=newest\|oldest\|price_asc\|price_desc\|name_asc\|name_desc`, `?page=`, `?limit=` (max 100); returns `products`, `count`, `pagination` |
| GET  | `/api/products/:identifier` | Single product by numeric id **or slug** (public) |
| POST | `/api/products` | Add product — **admin only** (JWT + DB `role = 'admin'`, `ADMIN_EMAILS` fallback); multipart field `image` |
| PUT  | `/api/products/:id` | Update product (partial) — **admin only** (`categoryId: null` unlinks; legacy `category` string edits re-link by name) |
| DELETE | `/api/products/:id` | Delete product — **admin only** |
| GET  | `/api/cart` | Cart lines + authoritative totals (JWT required); tax preview per category |
| POST | `/api/cart` | Add/increment product (JWT; `productId`, `qty?`); duplicate-safe upsert |
| PUT  | `/api/cart/:id` | Set line quantity (JWT; `qty`) — other users' lines 404 |
| DELETE | `/api/cart/:id` | Remove cart line (JWT) |
| GET  | `/api/wishlist` | Wishlist lines with live product data (JWT) |
| POST | `/api/wishlist` | Add to wishlist (JWT; `productId`) — idempotent, never duplicates |
| POST | `/api/wishlist/toggle` | Toggle membership (JWT; `productId`) |
| GET  | `/api/wishlist/products/:productId` | Membership check (JWT) |
| DELETE | `/api/wishlist/:productId` | Remove from wishlist (JWT) |
| GET  | `/api/addresses` | Own address book (JWT), default first |
| POST | `/api/addresses` | Save address (JWT; validated name/phone/line1/city/state + Indian PIN code); first address (or explicit `isDefault`) becomes the default |
| PUT  | `/api/addresses/:id` | Update own address (JWT) — foreign/missing 404 |
| DELETE | `/api/addresses/:id` | Delete own address (JWT); deleting the default promotes the next-oldest |
| PUT  | `/api/addresses/:id/default` | Set the default address (JWT) |
| GET  | `/api/orders` | Own orders (JWT; `?status=`, `?page=`, `?limit=`) |
| POST | `/api/orders` | **Checkout — Cash on Delivery** (JWT; `addressId`, `idempotencyKey`, `notes?`): server-authoritative prices/tax/stock, single transaction, idempotent (retry returns the same order) |
| GET  | `/api/orders/:id` | Own order detail with items + status history (JWT) |
| GET  | `/api/admin/orders` | All buyers' orders (admin; `?status=`, pagination) |
| GET  | `/api/admin/orders/:id` | Order detail incl. buyer identity (admin) |
| PUT  | `/api/admin/orders/:id/status` | Change status (admin; validated transitions; cancellation restocks exactly once) |

Cart totals are **preview-only**: prices come from the live Products table and
taxes from per-category `taxRate`; checkout recomputes final totals server-side
(guest-cart merge design: `docs/guest-cart-merge.md`).

`POST /api/products` body (JSON or multipart): `name`, `category` (legacy free-text, kept in sync with `categoryId`), `description`, `mrpPrice`, `sellingPrice`, optional `image` (URL) or `image` file upload, `slug` (auto-generated from name when omitted), `stock` (integer ≥ 0, default 0), `imageMeta` `{ alt?, width?, height? }`, `categoryId` (auto-links when the legacy name matches an existing category). Uploaded files land in `backend/uploads/` and are served at `/uploads/<file>`.

Categories support per-category `taxRate` (percent, `DECIMAL(5,2)`) for configurable GST — consumed by checkout in a later phase.

## Security (Phase 2 + Phase 3)

- `requireAuth` verifies the JWT and reloads the user from the DB on every request.
- `requireAdmin` authorizes via the DB `Users.role` column, with the server-side
  `ADMIN_EMAILS` allowlist as a transitional fallback (see `docs/admin-provisioning.md`).
- Request validation whitelists body fields; public signup can never set `role`.
- Helmet security headers; CORS allowlist (local dev origins + the `FRONTEND_URL` origin + `CORS_ALLOWED_ORIGINS`).
- Rate limiting: a global API limiter plus a strict limiter on auth endpoints (see `.env.example` for overrides).
- Request validation on all write endpoints; the centralized error handler never leaks internal details for 5xx responses.
- Password reset links expire after 30 minutes and are single-use (bound to the current password hash); reset responses are enumeration-safe.
