# BuyO — MySQL → PostgreSQL Data Migration: Source Audit, Design and Rehearsal (Phase 11)

Status: **design + local rehearsal complete; no data was moved out of any
real database, no Supabase connection was made.** This document is the
approved plan's basis for the eventual (explicitly approved) row migration at
cutover.

Companion docs:

- `docs/migration-remote.md` — approval gate, sandbox runbook, and §6
  Supabase target prerequisites (dashboard confirmations required first).
- `docs/storage-supabase.md` — product image files → Supabase Storage
  (separate phase; rows carry references only).
- `docs/migration-phase11.md` — what changed, tests, evidence.

---

## 1. What the tool is (and is not)

`backend/scripts/migrate-data.js` (`npm run migrate:data`) copies **rows** of
the nine business tables from a **local MySQL** database into an **already
initialized PostgreSQL** database:

- **Schema never comes from this tool.** The PostgreSQL side is always
  `sequelize.sync()` from the models + the numbered `.pgsql` migrations
  (see §4). The tool refuses to run if a target table does not exist.
- **It is not a replication or sync tool.** One-shot import into an *empty*
  target, with validation first, one transaction, and verification after.
- **It has no unguarded route.** The same guards as every other remote-capable
  script run before any connection (§3.3): non-loopback target → full
  approval gate; loopback target → `--confirm-local` + allowlist; source must
  be loopback MySQL; `DB_DIALECT` must be `postgres`; `DATABASE_URL` is never
  read.

CLI:

```
npm run migrate:data -- --source-db <mysql-db> --target-db <pg-db> --confirm-local [--dry-run]
```

Exit `0` = validated/imported/verified; exit `1` = refused (usage, guards,
validation violations, previously-imported target, verification failure).
All output is credential-free: table names, counts, row ids, check names —
never emails, passwords, hashes, hosts or URLs.

---

## 2. Source database audit (read-only, local `buyoDB`)

Inspected via `information_schema` + exact `COUNT(*)` (read-only; the real
`buyoDB` was not modified — no backup dump of it was produced in this phase,
see §7).

### 2.1 Tables and row counts (actual, at audit time)

| Table | Rows | Contains |
|---|---|---|
| `users` | **2** | user accounts (ids, name, email, password hash, isVerified, role, timestamps) |
| `categories` | 0 | taxonomy (name, slug, description, taxRate) |
| `addresses` | 0 | per-user shipping addresses |
| `products` | 0 | catalog (incl. legacy free-text `category`, `slug`, `stock`, `imageMeta`, `categoryId`) |
| `orders` | 0 | COD orders (totals, JSON snapshots, idempotency key) |
| `orderitems` | 0 | per-line purchase snapshots (history) |
| `orderstatusevents` | 0 | append-only order status history |
| `cartitems` | 0 | cart lines (`UserId`, `productId`, name, price, image, qty) |
| `wishlistitems` | 0 | wishlist lines |
| `schema_migrations` | 4 | MySQL bookkeeping (applied `NNN_*.sql` 001–004) — **not portable, excluded from migration** |

**Honest interpretation:** this local database is a *development* database
with two accounts — it is **not** assumed to equal the live website's data.
The row migration rehearsal therefore uses synthetic fixtures (§5), and the
real source rows are handled only in an approved cutover phase.

### 2.2 Keys, constraints, enums, JSON, auto-increment

- **Primary keys:** `id INT AUTO_INCREMENT` on all nine business tables.
- **Foreign keys (9):** `addresses.userId→users` (CASCADE),
  `cartitems.UserId→users` (CASCADE), `wishlistitems.UserId→users` (CASCADE),
  `orders.userId→users` (CASCADE), `orders.addressId→addresses` (SET NULL),
  `orderitems.orderId→orders` (CASCADE), `orderitems.productId→products`
  (SET NULL), `products.categoryId→categories` (SET NULL),
  `orderstatusevents.orderId→orders` (CASCADE).
- **Unique constraints:** `users.email` (two redundant indexes: `email`,
  `email_2`), `categories.name`, `categories.slug`, `products.slug`,
  `orders.orderNumber`, `orders(userId, idempotencyKey)`.
  **No unique on `cartitems`/`wishlistitems`** — MySQL *permits* duplicate
  (user, product) cart/wishlist lines; PostgreSQL migration 005/006 forbids
  them. This asymmetry is the main real-world duplicate risk (§6).
- **Indexes:** model indexes (`idx_addresses_user`, `idx_orders_user`,
  `idx_orders_status`, `idx_orders_address`, `idx_order_items_order`,
  `idx_order_items_product`, `idx_status_events_order`) + the FK/unique
  indexes above.
- **ENUM columns:** `orders.status`
  (`placed|confirmed|shipped|delivered|cancelled`), `orders.paymentMethod`
  (`cod`), `orderstatusevents.fromStatus`/`toStatus` (status set),
  `users.role` (`customer|admin`).
- **JSON columns:** `orders.taxBreakdown`, `orders.shippingAddress`,
  `products.imageMeta`.
- **Auto-increment:** every `id` above; PostgreSQL sequences must be
  re-aligned after preserving ids (§4.6).

### 2.3 Duplicate / integrity aggregates (values never printed)

All zero at audit time: duplicate `LOWER(email)` groups `0`, duplicate
`LOWER(category name)` groups `0`, duplicate cart `(user, product)` groups
`0`, duplicate wishlist `(user, product)` groups `0`, cart/wishlist rows with
`productId` pointing at no product `0`.

### 2.4 Image references

Columns holding image references: `products.image`, `cartitems.image`,
`orderitems.image`, `wishlistitems.image` (plus JSON `products.imageMeta`).
At audit time: **0 non-empty references**, and `backend/uploads/` contains
**0 files**. Reference format is `/uploads/<server-generated-filename>` or an
external URL. File bytes are *not* database data — see §4.8.

### 2.5 Source-side observations that shaped the plan

1. **Naming casing:** Windows MySQL folds table names to lowercase
   (`users`, `cartitems`, …) while the models' physical PostgreSQL names are
   capitalized (`"Users"`, `"CartItems"`, `"Addresses"`, `"Orders"`, …,
   verified by migrations 005/007 headers and the scratch run). The tool
   therefore resolves source tables **case-insensitively** and target tables
   **via `Model.getTableName()`** (never guessed).
2. **Snapshot consistency of the existing backup tool:** `db:backup` reads
   each table with its own `SELECT *` (no
   `START TRANSACTION WITH CONSISTENT SNAPSHOT`), so under concurrent writes
   a dump is not a single point-in-time image. For cutover: take the MySQL
   backup while writes are quiesced (or use the row tool, which *does* read
   everything inside one consistent snapshot — §3.1).
3. **Restorability:** backup→restore roundtrips are already proven on
   scratch databases by `test/migrations.test.js` (MySQL, Phase 3) and
   `test/pgTooling.test.js` (PostgreSQL, Phase 7). A dump of the *real*
   `buyoDB` was deliberately not produced this phase (it would embed account
   data in a file); producing it is an operator step at cutover, per
   `docs/migration-remote.md` §5.4.

---

## 3. Design of the data migration

### 3.1 Source read: one consistent, read-only snapshot

The tool opens the MySQL source with
`SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ` +
`START TRANSACTION WITH CONSISTENT SNAPSHOT`, then reads every table in that
single snapshot and rolls back at the end. All source access is `SELECT`.
Non-loopback source host → hard refusal (no remote sources, ever).

### 3.2 Table order and column mapping

Rows are read with `ORDER BY id` and inserted in FK-dependency order
(every table after its non-null parents):

| # | Model | PG table (exact) | MySQL source (matched case-insensitively) |
|---|---|---|---|
| 1 | User | `"Users"` | `users` |
| 2 | Category | `"Categories"` | `categories` |
| 3 | Address | `"Addresses"` | `addresses` |
| 4 | Product | `"Products"` | `products` |
| 5 | Order | `"Orders"` | `orders` |
| 6 | OrderItem | `"OrderItems"` | `orderitems` |
| 7 | OrderStatusEvent | `"OrderStatusEvents"` | `orderstatusevents` |
| 8 | CartItem | `"CartItems"` | `cartitems` |
| 9 | WishlistItem | `"WishlistItems"` | `wishlistitems` |

`schema_migrations` is **excluded**: PostgreSQL has its own bookkeeping for
the `.pgsql` files; copying MySQL's 001–004 rows would be meaningless.

**Column mapping is 1:1 by name** — both schemas are generated from the same
Sequelize models, so column names match (`userId` on addresses/orders,
capital `UserId` on cart/wishlist, as in both physical schemas). The tool
compares the columns of each source row against the target's
`information_schema` and **refuses on drift** (a source column missing on
the target). Target-only columns (future additions) are simply not written
and take their default — never the reverse.

### 3.3 Value conversion (MySQL → PostgreSQL)

Verified empirically on the scratch target (TYPEMAP recorded by
`test/dataMigration.test.js`):

| MySQL source | PG target | Conversion in tool |
|---|---|---|
| `int` (PK, FK) | `integer` (+ sequence) | exact id preserved; sequence re-set (§4.6) |
| `varchar(n)`, `text` | `character varying(n)`, `text` | as-is |
| `float` | `double precision` | mysql2 returns a JS number → passed through (source `FLOAT` widens to 64-bit; no loss for values that fit the source type) |
| `decimal(p,s)` | `numeric(p,s)` | mysql2 returns **strings** → passed through as strings → exact, scale preserved (`1999.00` stays `1999.00`) |
| `datetime` (precision 0) | `timestamp with time zone` | mysql2 returns a JS `Date` → passed as `Date`. Source has no fractional seconds and no zone (session-TZ assumption documented in §7) |
| `tinyint(1)` (`isVerified`, `isDefault`) | `boolean` | `1/true → true`, `0 → false` |
| `enum(...)` (role, statuses, paymentMethod) | native PG enum (`enum_Users_role`, `enum_Orders_status`, …) | label string passed as-is; **validated against `pg_enum` labels first** |
| `json` | `json` | mysql2 object → `JSON.stringify` for the driver |
| `auto_increment` values | `serial` values | explicit ids inserted, never renumbered |

**Primary/foreign keys:** ids are copied verbatim; insert order plus
validation (§3.4) guarantees every non-null FK value resolves. Nullable FK
history semantics survive unchanged: deleted products leave `NULL`
(`ON DELETE SET NULL` both sides), `orders.addressId` may be `NULL`,
`cartitems/WishlistItems.productId` has **no FK** on either side — legacy
rows pointing at missing products (or `NULL`) are legal and move as-is
(deliberately *not* "cleaned up": that would be silent data rewriting).

**Null values:** passed through as SQL `NULL`. NOT-NULL-without-default
target columns are validated before writing (a null there = refusal).

**Unique constraints:** discovered *from the target* (all simple unique
indexes from `pg_index`, constraints included), so the checks track schema
evolution rather than a hardcoded list. Validation replicates PostgreSQL
`NULLS DISTINCT`: rows where any unique member is `NULL` are exempt (matches
005's "NULL-product rows stay allowed").

### 3.4 Validation before writing (refuse, never fix)

Everything below runs **before any write**. If any check finds violations,
the tool prints a credential-free report — check name, count, **row ids
only** — and exits 1 having written nothing:

1. column drift (§3.2);
2. `NOT NULL` target columns without a default: source value must exist;
3. every simple unique set: duplicate groups *within the source batch*;
4. **case-insensitive uniqueness**: `lower(email)` on users and
   `lower(name)` on categories — mirroring migration 007, whose expression
   indexes are invisible to index-column discovery (expression indexes are
   explicitly excluded from check 3 and handled here);
5. FK parents: every non-null child value must exist among the imported
   parent rows;
6. enum membership: source value ∈ target `pg_enum` labels.

**Duplicate policy (binding):** rows are never silently discarded, merged or
"auto-resolved". A duplicate (exact or case-variant email/category name, or
a repeated cart/wishlist `(user, product)` line) *refuses the whole run* with
the offending ids so the operator resolves it **in the source first** (per
business rule: keep which line? that is a product decision, not a script's),
then re-runs. `--dry-run` runs the identical validation and exits without
writing.

### 3.5 Import: one transaction

Tables are inserted in §3.2 order with chunked multi-row `INSERT`s, each
table's sequence is `setval`'d, and everything commits **in a single
PostgreSQL transaction**. `setval` is transactional in PostgreSQL, so:

- any failure → full rollback → target back to empty → **rerun is safe**;
- success → rows + sequence state commit together.

### 3.6 Previously-imported target = explicit refusal

Before writing, the tool counts rows in each destination table; any existing
row → refusal (naming table + count). Combined with §3.5, an empty target
always means "failed run or fresh start — safe to rerun", and a non-empty
target always means "already imported — use a fresh scratch (or an approved
cleanup), never a blind second import that would double data or trip
uniques".

### 3.7 Guards (no alternate unguarded route)

Run *before any connection*, identical for CLI and library use:

1. `DB_DIALECT` must be `postgres` (target side), else refusal;
2. source host must be loopback, else refusal (no remote MySQL sources);
3. target non-loopback → the **existing full remote approval gate**
   (`enforceRemoteGateOrExit`: token + `--confirm-remote` + non-production +
   shape + allowlists + `DATABASE_URL` tripwire — unchanged contract);
4. target loopback → the **existing local guard**
   (`collectLocalGuardReasons`: `--confirm-local` + non-production +
   loopback + `DB_DATA_MIGRATE_ALLOWED_DATABASES`, default
   `["buyoDB_ph11_import"]` — the documented rehearsal scratch name).

### 3.8 Verification (after commit)

Independently re-queried on the target, then summarized credential-free:

- per-table row counts vs source;
- exact **id-set equality** (sorted ids, both sides);
- FK orphan check: all 9 relationships re-joined on the target → 0 orphans;
- sequences: `last_value == MAX(id)` per table (next insert = `MAX(id)+1`);
- the test suite additionally re-verifies source↔target from *outside* the
  tool (§5) so the evidence does not rely on the tool grading itself.

---

## 4. PostgreSQL schema validation (fresh local scratch)

Schema bootstrap = `test/pgSchemaFor.js`:
`sequelize.sync()` (models; never `--alter`) + the numbered `.pgsql`
migrations (005, 006, 007). Verified on a fresh scratch database by
`test/dataMigration.test.js`:

- all nine tables + `schema_migrations` present;
- `schema_migrations` has exactly 3 applied rows (005, 006, 007);
- the four migration indexes exist (`uq_cartitems_user_product`,
  `uq_wishlistitems_user_product`, `uq_users_email_lower`,
  `uq_categories_name_lower`) plus model indexes (`idx_orders_user`,
  `idx_status_events_order`, `idx_addresses_user`);
- exactly 9 foreign keys;
- key types: `Users.role` native enum, `Users.isVerified` boolean,
  `Orders.subtotal` numeric, `Orders.createdAt` timestamp with time zone,
  `Orders.shippingAddress`/`Products.imageMeta` json;
- model read/write after import: counts match, an insert gets
  `MAX(id)+1` (sequence correctness, §4.6), default `role='customer'`;
- the migration runner still refuses a hosted target unless the approval
  contract is satisfied (re-proven in the same suite).

**Emptiness caveat:** numbered PG migrations run against an *empty* schema in
this phase, so their data prechecks pass trivially; the pgMigrations suite
separately proves they behave against populated scratch data.

### 4.6 Sequence reset after preserved ids

`setval(pg_get_serial_sequence(table,'id'), MAX(id), hasRows)` per table
inside the import transaction: non-empty table → next id `MAX(id)+1`; empty
→ next id `1` (`is_called=false`). Verified twice: `last_value == MAX(id)`
query, and a real model insert landing at `MAX(id)+1`.

### 4.8 Product-image references vs files (Storage phase boundary)

Rows carry references only (`/uploads/<file>` or external URL; 0 present at
audit). The row migration copies references **byte-identical** and never
touches files. `backend/uploads` file bytes → Supabase Storage is a separate
approved phase per `docs/storage-supabase.md`; its verification (every
referenced file exists in the bucket) happens there — a missing file must
not block row migration, it is *reported* as an image-reference inventory
(not silently "fixed" by clearing the column).

---

## 5. The local rehearsal (how it works, what it proved)

Run: `npm run test:pg:data` (embedded PostgreSQL via `test/pgSuite.js`,
data dir in OS temp, removed afterwards).

Fixtures (synthetic, dropped/recreated by the suite — **the real `buyoDB` is
never a test target**):

- `buyoDB_ph11_src` — faithful schema subset (column types, PKs, uniques,
  FKs) + 22 rows exercising: non-contiguous preserved ids (users `2,5,42`,
  products `1,6,11`, …), mixed-case email that must *pass* `lower(email)`,
  JSON documents, enum labels, decimals as strings, booleans, `NULL`
  addressId/productId/categoryId, a cart row referencing a missing product
  (legal), timestamps.
- `buyoDB_ph11_src_dup` — violation staging: case-variant emails (source
  column given a case-sensitive collation as a staging device), exact
  duplicate cart line, cart row with missing `UserId` (source session
  `FOREIGN_KEY_CHECKS=0`). Note: the case-duplicate scenario mirrors why
  migration 007 exists (legacy data with different collation) — it cannot
  arise from this MySQL's default `ci` collation, so the fixture forces it.
- target `buyoDB_ph11_import` — created fresh, schema built (§4), then
  imported into.

Nine tests (all passing):

1. fresh-scratch schema: tables, migration indexes, 9 FKs, key types;
2. guard refusals before any connection: missing flags, missing
   `--confirm-local`, allowlist miss, `NODE_ENV=production`, wrong dialect,
   remote source, remote target without approval — each with exit 1 and
   **no connection attempt** in output;
3. violations refused with ids (`lower(email)` ids 1,2; `unique (UserId,
   productId)` ids 1,2; FK-missing id 3), **no emails/hashes in output**,
   every target table still empty;
4. `--dry-run`: full validation passes, target still empty;
5. import: counts match, ids preserved, 0 FK orphans, sequences 9/9,
   credential-free summary;
6. independent source↔target verification from the test process: sorted id
   equality per table, 9 FK join counts, decimal `'1999.00'`, enum label,
   JSON presence, boolean count, timestamp ordering, `last_value == MAX(id)`;
7. application models read migrated rows and write at `MAX(id)+1`;
8. rerun on the imported target explicitly refused; counts unchanged
   (probe row cleaned up);
9. numbered migration runner still refuses hosted targets (contract intact).

---

## 6. Duplicate handling — operational note for the real run

Validation refusal is *by design* the first step of the real migration. When
the actual source shows violations (the risk list: case-variant emails /
category names blocked by 007's lower-uniques, repeated cart/wishlist lines
blocked by 005/006 — all of which MySQL *allows*):

1. run `--dry-run` against the real source (read-only) to get the id report;
2. resolve each group **in MySQL** per business decision (e.g. keep the
   older cart line; merge wishlist duplicates; resolve account duplicates by
   owner outreach — never by picking a survivor automatically);
3. re-run dry-run until clean, then run the import in the approved phase.

---

## 7. Limitations and untested assumptions (honest list)

- **Nothing was migrated from the real `buyoDB`** (2 users; rehearsal is
  synthetic by design) and **no Supabase/hosted target was contacted**.
- **Zone handling:** MySQL `datetime` has no timezone; mysql2 interprets it
  in the session timezone and the value lands as `timestamptz`. Exact
  wall-clock preservation assumes source and tool run in one timezone (true
  locally; revisit if the cutover source ever runs elsewhere).
- **No fractional seconds** exist in the source (`datetime` precision 0) —
  nothing to preserve, but PG timestamps will show `.000`.
- **`FLOAT` columns widen** to `double precision` (values pass through JS
  doubles — no loss for in-range MySQL `float` values).
- **Not covered by the tool:** file bytes (Storage phase, §4.8),
  `schema_migrations` (excluded), sessions/tokens (none stored),
  idempotency keys beyond row copy (behaviour re-tested by suites).
- **Backup snapshot gap** for `db:backup` (§2.5 #2) remains as documented —
  quiesce writes at cutover or rely on the tool's own snapshot read.
- **`--dry-run` on a non-empty target still refuses** (previously-imported
  rule) — use a fresh scratch for rehearsals.
- **Library mode** (`runDataMigration`) with a non-loopback target ends via
  the shared gate's process-exit refusal (fail-closed); only loopback
  rehearsals use the library path.

## 8. What requires explicit approval before the first Supabase connection

Everything in `docs/migration-remote.md` §6 (project/region identity,
pooler-vs-direct decisions, emptiness, backups/PITR, privileges, extensions),
plus the §2 approval token flow for any non-loopback run of `db:migrate`,
`db:backup`, `db:restore`, `admin:role` **or `migrate:data`**. Phase 11
created no remote resources and made no remote connection; the first one is
a separate, explicitly approved phase.
