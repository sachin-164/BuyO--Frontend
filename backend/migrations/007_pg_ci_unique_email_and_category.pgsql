-- 007_pg_ci_unique_email_and_category.pgsql
-- Migration Phase 6 (PostgreSQL-only): case-insensitive uniqueness for
-- Users.email and Categories.name.
--
-- Physical schema — verified against pg_catalog on the local scratch harness:
--   table  "Users"       column "email" varchar NOT NULL
--   table  "Categories"  column "name"  varchar NOT NULL
--
-- Why this is needed: on MySQL both columns are covered by the table charset's
-- case-insensitive collation (utf8mb4_*_ci) — "A@x" and "a@x" collide there.
-- On PostgreSQL the sync-created unique indexes (Users_email_key,
-- Categories_name_key) compare case-SENSITIVELY, so only application-level
-- normalisation (validate.js lowercases emails) stood between the data and
-- duplicate rows. These functional indexes make the database itself enforce
-- the same rule on both dialects.
--
-- MySQL is UNCHANGED (the MySQL runner never reads .pgsql files).
--
-- File policy: no semicolons inside string literals. Directives (see
-- scripts/migrate.js): precheck statements must return ZERO rows and verify
-- statements exactly one row with ok = true. The first precheck deliberately
-- selects only user ids — emails are NEVER printed in diagnostics. Everything
-- runs in one transaction: if a precheck fails, neither index is created.

-- precheck: Users duplicate LOWER(email) — affected ids only, emails never printed
SELECT u.id
FROM "Users" u
WHERE EXISTS (
  SELECT 1
  FROM "Users" u2
  WHERE u2.id <> u.id AND LOWER(u2."email") = LOWER(u."email")
)
ORDER BY u.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON "Users" (LOWER(email));

-- precheck: Categories duplicate LOWER(name) — id and catalog name (not user data)
SELECT c.id, c.name
FROM "Categories" c
WHERE EXISTS (
  SELECT 1
  FROM "Categories" c2
  WHERE c2.id <> c.id AND LOWER(c2."name") = LOWER(c."name")
)
ORDER BY c.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_name_lower
  ON "Categories" (LOWER(name));

-- verify: uq_users_email_lower is present, UNIQUE, valid and functional on LOWER(email)
SELECT EXISTS (
  SELECT 1
  FROM pg_index i
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN pg_class ix ON ix.oid = i.indexrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname = current_schema()
    AND tbl.relname = 'Users'
    AND ix.relname = 'uq_users_email_lower'
    AND i.indisunique
    AND i.indisvalid
    AND i.indexprs IS NOT NULL
    AND pg_get_indexdef(i.indexrelid) LIKE '%lower(%email%)%'
) AS ok;

-- verify: uq_categories_name_lower is present, UNIQUE, valid and functional on LOWER(name)
SELECT EXISTS (
  SELECT 1
  FROM pg_index i
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN pg_class ix ON ix.oid = i.indexrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname = current_schema()
    AND tbl.relname = 'Categories'
    AND ix.relname = 'uq_categories_name_lower'
    AND i.indisunique
    AND i.indisvalid
    AND i.indexprs IS NOT NULL
    AND pg_get_indexdef(i.indexrelid) LIKE '%lower(%name%)%'
) AS ok;
