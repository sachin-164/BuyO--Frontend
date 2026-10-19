-- 005_pg_cart_items_user_product_unique.pgsql
-- Migration Phase 6 (PostgreSQL-only): at most ONE cart line per (user, product).
--
-- Physical schema — verified against pg_catalog on the local scratch harness
-- (test/pgSuite.js + test/helpers.js), not assumed from model properties:
--   table  "CartItems"
--   column "UserId"    integer NOT NULL — FK to "Users".id (ON DELETE CASCADE)
--   column "productId" integer NULL    — NULL means the server cannot resolve
--                     the product (legacy/local-cart rows). PostgreSQL treats
--                     NULLs as DISTINCT in btree unique indexes, so multiple
--                     NULL-product rows remain allowed exactly as before.
--
-- MySQL is UNCHANGED by this file: the MySQL runner only reads NNN_*.sql files
-- (this file ends in .pgsql), and MySQL dedup stays transactional/app-level
-- as it is today. Case/collation behavior is untouched on both dialects.
--
-- File policy: statements must never contain a semicolon inside a string
-- literal — the runner splits on semicolons. Directives (see the runner in
-- scripts/migrate.js): a statement preceded by a comment line of the form
-- "precheck: <label>" must return ZERO rows or the migration aborts, and a
-- statement preceded by a comment line of the form "verify: <label>" must
-- return exactly one row with ok = true or the migration aborts. The whole
-- file runs in one transaction.

-- precheck: CartItems duplicate (UserId, productId) rows — ids and counts only
SELECT "UserId", "productId", COUNT(*) AS duplicates
FROM "CartItems"
WHERE "productId" IS NOT NULL
GROUP BY "UserId", "productId"
HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cartitems_user_product
  ON "CartItems" ("UserId", "productId");

-- verify: uq_cartitems_user_product is present, UNIQUE, valid and covers ("UserId", "productId")
SELECT EXISTS (
  SELECT 1
  FROM pg_index i
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN pg_class ix ON ix.oid = i.indexrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname = current_schema()
    AND tbl.relname = 'CartItems'
    AND ix.relname = 'uq_cartitems_user_product'
    AND i.indisunique
    AND i.indisvalid
    AND pg_get_indexdef(i.indexrelid) LIKE '%("UserId", "productId")%'
) AS ok;
