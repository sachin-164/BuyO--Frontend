-- 006_pg_wishlist_items_user_product_unique.pgsql
-- Migration Phase 6 (PostgreSQL-only): at most ONE wishlist row per (user, product).
--
-- Physical schema — verified against pg_catalog on the local scratch harness:
--   table  "WishlistItems"
--   column "UserId"    integer NOT NULL — FK to "Users".id (ON DELETE CASCADE)
--   column "productId" integer NULL    — NULLs are DISTINCT in unique indexes,
--                     so multiple NULL-product rows stay allowed as today.
--
-- MySQL is UNCHANGED (the MySQL runner never reads .pgsql files).
--
-- File policy: no semicolons inside string literals — the runner splits on
-- semicolons. Directives (see scripts/migrate.js): a statement preceded by a
-- comment line of the form "precheck: <label>" must return ZERO rows or the
-- migration aborts. A statement preceded by a comment line of the form
-- "verify: <label>" must return exactly one row with ok = true or the
-- migration aborts. One transaction covers the whole file.

-- precheck: WishlistItems duplicate (UserId, productId) rows — ids and counts only
SELECT "UserId", "productId", COUNT(*) AS duplicates
FROM "WishlistItems"
WHERE "productId" IS NOT NULL
GROUP BY "UserId", "productId"
HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wishlistitems_user_product
  ON "WishlistItems" ("UserId", "productId");

-- verify: uq_wishlistitems_user_product is present, UNIQUE, valid and covers ("UserId", "productId")
SELECT EXISTS (
  SELECT 1
  FROM pg_index i
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN pg_class ix ON ix.oid = i.indexrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname = current_schema()
    AND tbl.relname = 'WishlistItems'
    AND ix.relname = 'uq_wishlistitems_user_product'
    AND i.indisunique
    AND i.indisvalid
    AND pg_get_indexdef(i.indexrelid) LIKE '%("UserId", "productId")%'
) AS ok;
