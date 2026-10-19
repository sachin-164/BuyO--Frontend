# BuyO — Database Schema v1 (Phase 3)

This document is the reference for the Phase 3 schema change: what was added, why,
how it is applied, and how to recover if something goes wrong. The schema
evolves exclusively through the numbered migrations in `backend/migrations/` —
never through `sequelize.sync({ alter: true })`. This document describes the
**MySQL** v1 schema (the `NNN_*.sql` files, the default dialect); the
PostgreSQL migration harness applies its own numbered `NNN_*.pgsql` files
(see [migration-phase6.md](migration-phase6.md) and
[migration-phase7.md](migration-phase7.md)).

## 1. What v1 adds (all additive — nothing is dropped or renamed)

### 1.1 `Users.role` — database-backed authorization

| column | type | notes |
|---|---|---|
| `role` | `ENUM('customer','admin') NOT NULL DEFAULT 'customer'` | migration `001` |

- Public signup can **never** grant admin: the API whitelists request fields and
  the controller writes `role: 'customer'` explicitly.
- Admin access is granted **only** by the audited provisioning script
  (`npm run admin:role`) — see [admin-provisioning.md](./admin-provisioning.md).
- **Phase 11:** the transitional `ADMIN_EMAILS` env allowlist was **removed**
  (see [admin-provisioning.md](./admin-provisioning.md)); `Users.role` is the
  sole source of truth. `requireAdmin` = verified user **and** `role = 'admin'`.

### 1.2 `Categories` — canonical taxonomy + configurable tax

| column | type | notes |
|---|---|---|
| `id` | `INT PK AUTO_INCREMENT` | |
| `name` | `VARCHAR(100) NOT NULL UNIQUE` | |
| `slug` | `VARCHAR(160) NOT NULL UNIQUE` | |
| `description` | `TEXT NULL` | |
| `taxRate` | `DECIMAL(5,2) NOT NULL DEFAULT 0.00` | **configurable per category** (e.g. GST %) |

- No GST rate is hardcoded anywhere; the admin sets `taxRate` per category.
- Migration `002` creates the table; migration `003` backfills one Category per
  distinct legacy `Products.category` string (trimmed).

### 1.3 `Products` — catalog fields

| column | type | notes |
|---|---|---|
| `slug` | `VARCHAR(160) NOT NULL UNIQUE` | API sets clean slugs; legacy rows are backfilled as `<base>-p<id>` (collision-free: the `-p<id>` suffix can only be produced by that same row) |
| `stock` | `INT NOT NULL DEFAULT 0` | product-level inventory for v1 |
| `imageMeta` | `JSON NULL` | documented shape `{"alt", "width", "height"}` for the primary image |
| `categoryId` | `INT NULL` FK → `Categories.id` | `ON DELETE SET NULL ON UPDATE CASCADE` |

- The legacy free-text `Products.category` column is **kept untouched** (the
  storefront keeps working); `categoryId` is backfilled from it where a matching
  Category exists. A later phase can drop the legacy column.
- Deleting a category never deletes products — it only clears the link
  (`SET NULL`), which the migration test suite verifies.

### 1.4 Deliberately deferred (accounted for, not invented yet)

- **Variants** (size/color): will arrive as a separate `ProductVariants` table
  (`productId` FK, `sku`, option values JSON, per-variant price/stock) when the
  cart/order phases need them. Nothing in v1 blocks this: `slug` is
  product-level, and per-variant stock simply supersedes `stock` in that phase
  via a new migration.
- **Product specifications**: will be added as an ordered `specs` JSON column
  (or key/value table) when the product-detail/admin UI actually needs it. No
  speculative fields are added now.

## 2. Migrations

| # | file | summary |
|---|---|---|
| 001 | `001_add_users_role.sql` | `Users.role` enum + default |
| 002 | `002_create_categories.sql` | `Categories` table |
| 003 | `003_products_catalog_fields.sql` | `Products.slug/stock/imageMeta/categoryId`, Category backfill, FK |

Properties:

- **Numbered + versioned**: files are `NNN_lower_snake.sql`, applied in order.
  The runner refuses filenames that don't match the pattern.
- **Bookkeeping**: applied migrations are recorded in `schema_migrations`
  (`id`, sha256 `checksum`, `appliedAt`, `executionMs`). Editing an
  *applied* file is refused (create a new migration instead).
- **Guarded**: every statement checks `information_schema` first, so a
  migration is safe to re-run after a partial failure. MySQL DDL is **not**
  transactional — this guard pattern is the mitigation.
- **Policy**: one statement per `;` — no semicolons inside string literals;
  comments on their own `--` lines (the runner's splitter is intentionally simple).
- `sequelize.sync({ alter: true })` is disabled for schema evolution; `db:sync`
  only creates missing tables for fresh local databases and refuses `--alter`.

### Commands (local only — all scripts refuse non-loopback hosts, `NODE_ENV=production` and missing `--confirm-local`)

```bash
npm run db:migrate -- --confirm-local            # apply pending migrations
npm run db:migrate -- --confirm-local --status   # list applied/pending
```

Fresh local database: `npm run db:sync -- --confirm-local` (tables) followed by
`npm run db:migrate -- --confirm-local` (records the baseline; everything is a
no-op because plain sync already creates the v1 columns from the models).

## 3. Rollback / recovery strategy

MySQL 8/9 DDL auto-commits, so migrations are **forward-only**. Recovery options,
in order of preference:

1. **Fix forward**: migrations are guarded — correct the data/statement and
   re-run `db:migrate`. The failed migration isn't recorded until it completes.
2. **Restore a backup** (drill-verified in Phase 3): take a pre-migration backup
   with `npm run db:backup`, then restore it into a fresh scratch database with
   `npm run db:restore -- --target <buyoDB_scratch> --confirm-local` and verify.
3. **Manual rollback SQL** (review first; comments in each migration file list
   the exact reverse statements, e.g. dropping `Products.categoryId`/FK,
   `Categories`, `Users.role`).

Environment policy: local development only in Phase 3. Hosted/production
migrations will run in the release phase with an explicit, reviewed procedure —
never automatically at boot.

## 4. Verification performed (Phase 3)

- Realistic legacy-schema fixture (pre-v1 tables + 2 users, 3 products,
  cart/wishlist rows) migrated: roles default to `customer`, Categories created
  from distinct legacy strings (trimmed), products backfilled + linked, legacy
  `category` strings preserved.
- Constraints enforced: unique slugs, unique category name/slug, FK
  `SET NULL` behavior, role enum, `slug NOT NULL`.
- Idempotency: second run applies nothing; a guarded migration re-runs safely
  after a simulated partial failure (deleted bookkeeping row).
- Checksum tamper protection verified.
- Recovery rehearsal: pre-migration backup restored into a scratch DB with
  matching row counts and pre-v1 shape.
- Schema equivalence: a fresh `sequelize.sync()`-built DB and the
  migration-built DB produce identical column signatures after migrations.
- Real local `buyoDB`: backup taken and drill-restored first, then migrated
  (001–003 applied, existing user row intact, app boots, `GET /api/products` 200).
