-- 000_pg_base_schema.pgsql
-- Base schema bootstrap for PostgreSQL — creates the nine application tables
-- that sequelize.sync() historically produced, so a completely EMPTY target
-- can be initialized by the numbered migrations alone.
--
-- WHY THIS FILE EXISTS
--   The .pgsql namespace previously began at 005, and 005/006/007 all
--   presuppose base tables (Users, Categories, Products, CartItems,
--   WishlistItems, Addresses, Orders, OrderItems, OrderStatusEvents) that
--   only sequelize.sync() had ever created. Hosted schema comes ONLY from
--   numbered migrations (db:sync is local-only by design, see its header),
--   so a fresh target had no code path to a working schema at all. This
--   file closes that gap.
--
-- PROVENANCE (do not redesign)
--   Every column type, nullability, default, ordinal position, primary key,
--   unique constraint, foreign key and index below was captured from
--   pg_catalog on a sequelize.sync() build of the SAME models on the local
--   scratch harness (test/pgSuite.js, embedded loopback PostgreSQL), so a
--   migration-built database is catalog-identical to a sync-built dev
--   database. That identity is pinned by test/pgBaseSchema.test.js
--   (columns incl. ordinals, types, defaults, nullability, constraint
--   definitions, index definitions, enum labels and sequences).
--
-- PROPERTIES
--   * Idempotent — CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS
--     and exception-guarded CREATE TYPE make this a complete no-op on a
--     database that sync already built (the runner then just records it
--     once), and a full bootstrap on an empty one.
--   * Additive only — nothing is dropped, altered or rewritten, no rows are
--     touched, no backfills run.
--   * File order — sorts before 005/006/007 in filename order, so their
--     prechecks and verifies find their tables on a fresh target.
--   * MySQL is untouched — the MySQL runner only reads NNN_*.sql files.
--
-- FILE POLICY (runner: scripts/migrate.js, directives: docs/migration-phase6.md)
--   * Statements split on the semicolon OUTSIDE dollar-quoted bodies only,
--     so the DO blocks below keep the semicolons plpgsql requires. Keep the
--     semicolon character out of comment prose and out of plain string
--     literals, and keep dollar signs out of comment prose entirely.
--   * Each statement preceded by a comment line of the form
--     "verify: <label>" must return exactly one row whose boolean column ok
--     is true, otherwise the whole file aborts and rolls back — the file
--     can never claim success without proving its own result. Five such
--     checks follow the DDL.
--   * One transaction covers the whole file (PostgreSQL DDL is
--     transactional), so a failure applies nothing and records nothing.
--
-- ROLLBACK (manual, review first — only ever appropriate on a FRESH
-- bootstrap where the initialized schema carries no wanted data, it drops
-- every table created here). Run each statement separately, then delete the
-- bookkeeping row so a later run starts clean:
--     DROP TABLE IF EXISTS "OrderStatusEvents", "OrderItems", "Orders",
--       "Addresses", "WishlistItems", "CartItems", "Products",
--       "Categories", "Users"
--     DROP TYPE IF EXISTS "enum_OrderStatusEvents_fromStatus",
--       "enum_OrderStatusEvents_toStatus", "enum_Orders_status",
--       "enum_Orders_paymentMethod", "enum_Users_role"
--     DELETE FROM "schema_migrations" WHERE id = '000_pg_base_schema.pgsql'
--   On a non-empty target prefer the pre-run backup restore instead
--   (docs/migration-remote.md section 5.4, npm run db:restore).
--

-- Enum types. Guarded: if the type already exists (sync-built database) the
-- duplicate_object exception makes the statement a silent no-op.
DO $$
BEGIN
  CREATE TYPE "enum_Users_role" AS ENUM ('customer', 'admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "enum_Orders_status" AS ENUM ('placed', 'confirmed', 'shipped', 'delivered', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "enum_Orders_paymentMethod" AS ENUM ('cod');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "enum_OrderStatusEvents_fromStatus" AS ENUM ('placed', 'confirmed', 'shipped', 'delivered', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "enum_OrderStatusEvents_toStatus" AS ENUM ('placed', 'confirmed', 'shipped', 'delivered', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Tables, in FK dependency order. Definitions mirror the sync-built catalog
-- exactly (column order, types, defaults, nullability, constraint names and
-- FK actions). serial produces the integer id sequence and nextval default
-- that sync produces.

CREATE TABLE IF NOT EXISTS "Users" (
  "id" serial NOT NULL,
  "name" varchar(255) NOT NULL,
  "email" varchar(255) NOT NULL,
  "password" varchar(255) NOT NULL,
  "isVerified" boolean DEFAULT false,
  "role" "enum_Users_role" NOT NULL DEFAULT 'customer'::"enum_Users_role",
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "Users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Users_email_key" UNIQUE ("email")
);

CREATE TABLE IF NOT EXISTS "Categories" (
  "id" serial NOT NULL,
  "name" varchar(100) NOT NULL,
  "slug" varchar(160) NOT NULL,
  "description" text,
  "taxRate" numeric(5,2) NOT NULL DEFAULT 0,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "Categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Categories_name_key" UNIQUE ("name"),
  CONSTRAINT "Categories_slug_key" UNIQUE ("slug")
);

CREATE TABLE IF NOT EXISTS "Products" (
  "id" serial NOT NULL,
  "name" varchar(255) NOT NULL,
  "category" varchar(255) NOT NULL,
  "description" text,
  "mrpPrice" double precision NOT NULL,
  "sellingPrice" double precision NOT NULL,
  "image" varchar(255),
  "slug" varchar(160) NOT NULL,
  "stock" integer NOT NULL DEFAULT 0,
  "imageMeta" json,
  "categoryId" integer,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "Products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Products_slug_key" UNIQUE ("slug"),
  CONSTRAINT "Products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Categories" ("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "CartItems" (
  "id" serial NOT NULL,
  "productId" integer,
  "name" varchar(255) NOT NULL,
  "price" double precision DEFAULT '0'::double precision,
  "image" varchar(255),
  "qty" integer DEFAULT 1,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  "UserId" integer NOT NULL,
  CONSTRAINT "CartItems_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CartItems_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "Users" ("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "WishlistItems" (
  "id" serial NOT NULL,
  "productId" integer,
  "name" varchar(255) NOT NULL,
  "price" double precision DEFAULT '0'::double precision,
  "image" varchar(255),
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  "UserId" integer NOT NULL,
  CONSTRAINT "WishlistItems_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WishlistItems_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "Users" ("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Addresses" (
  "id" serial NOT NULL,
  "label" varchar(50),
  "fullName" varchar(100) NOT NULL,
  "phone" varchar(15) NOT NULL,
  "line1" varchar(255) NOT NULL,
  "line2" varchar(255),
  "city" varchar(100) NOT NULL,
  "state" varchar(100) NOT NULL,
  "pincode" varchar(10) NOT NULL,
  "isDefault" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  "userId" integer NOT NULL,
  CONSTRAINT "Addresses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Orders" (
  "id" serial NOT NULL,
  "orderNumber" varchar(20) NOT NULL,
  "idempotencyKey" varchar(64) NOT NULL,
  "status" "enum_Orders_status" NOT NULL DEFAULT 'placed'::"enum_Orders_status",
  "paymentMethod" "enum_Orders_paymentMethod" NOT NULL DEFAULT 'cod'::"enum_Orders_paymentMethod",
  "subtotal" numeric(12,2) NOT NULL,
  "taxTotal" numeric(12,2) NOT NULL DEFAULT 0,
  "grandTotal" numeric(12,2) NOT NULL,
  "taxBreakdown" json,
  "shippingAddress" json NOT NULL,
  "addressId" integer,
  "notes" varchar(500),
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  "userId" integer NOT NULL,
  CONSTRAINT "Orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "Orders_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Addresses" ("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "OrderItems" (
  "id" serial NOT NULL,
  "productId" integer,
  "name" varchar(200) NOT NULL,
  "image" varchar(500),
  "unitPrice" numeric(10,2) NOT NULL,
  "qty" integer NOT NULL,
  "lineTotal" numeric(12,2) NOT NULL,
  "taxRate" numeric(5,2) NOT NULL DEFAULT 0,
  "taxAmount" numeric(12,2) NOT NULL DEFAULT 0,
  "categoryName" varchar(100),
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  "orderId" integer NOT NULL,
  CONSTRAINT "OrderItems_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderItems_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "OrderItems_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products" ("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "OrderStatusEvents" (
  "id" serial NOT NULL,
  "fromStatus" "enum_OrderStatusEvents_fromStatus",
  "toStatus" "enum_OrderStatusEvents_toStatus" NOT NULL,
  "note" varchar(500),
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  "orderId" integer NOT NULL,
  CONSTRAINT "OrderStatusEvents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderStatusEvents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders" ("id") ON UPDATE CASCADE ON DELETE CASCADE
);

-- Model-level indexes (attribute-level unique constraints already produced
-- their backing indexes above as part of CREATE TABLE).

CREATE INDEX IF NOT EXISTS idx_addresses_user ON "Addresses" ("userId");

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_number ON "Orders" ("orderNumber");

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_user_idem ON "Orders" ("userId", "idempotencyKey");

CREATE INDEX IF NOT EXISTS idx_orders_user ON "Orders" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS idx_orders_status ON "Orders" (status);

CREATE INDEX IF NOT EXISTS idx_orders_address ON "Orders" ("addressId");

CREATE INDEX IF NOT EXISTS idx_order_items_order ON "OrderItems" ("orderId");

CREATE INDEX IF NOT EXISTS idx_order_items_product ON "OrderItems" ("productId");

CREATE INDEX IF NOT EXISTS idx_status_events_order ON "OrderStatusEvents" ("orderId", "createdAt");

-- Verifies. Each must return exactly one row with ok = true or the whole
-- file aborts and rolls back. On a sync-built database they must ALSO pass
-- (this file then no-ops), on an empty database they prove the bootstrap
-- completed, and on a partially broken target they refuse partial success.

-- verify: all nine base tables exist
SELECT (
  SELECT count(*)
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = current_schema()
    AND c.relkind = 'r'
    AND c.relname IN ('Users', 'Categories', 'Products', 'CartItems', 'WishlistItems', 'Addresses', 'Orders', 'OrderItems', 'OrderStatusEvents')
) = 9 AS ok;

-- verify: every base table has at least its expected base columns
SELECT (
  SELECT count(*)
  FROM (
    SELECT 'Users' AS tbl, 8 AS n
    UNION ALL SELECT 'Categories', 7
    UNION ALL SELECT 'Products', 13
    UNION ALL SELECT 'CartItems', 9
    UNION ALL SELECT 'WishlistItems', 8
    UNION ALL SELECT 'Addresses', 13
    UNION ALL SELECT 'Orders', 15
    UNION ALL SELECT 'OrderItems', 13
    UNION ALL SELECT 'OrderStatusEvents', 7
  ) expected
  JOIN (
    SELECT c.relname AS tbl, count(*) AS n
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = current_schema()
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND c.relname IN ('Users', 'Categories', 'Products', 'CartItems', 'WishlistItems', 'Addresses', 'Orders', 'OrderItems', 'OrderStatusEvents')
    GROUP BY c.relname
  ) actual ON actual.tbl = expected.tbl AND actual.n >= expected.n
) = 9 AS ok;

-- verify: the five enum types carry exactly the expected labels, in order
SELECT (
  EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace ns ON ns.oid = t.typnamespace
    WHERE ns.nspname = current_schema() AND t.typname = 'enum_Users_role'
    GROUP BY t.typname
    HAVING string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) = 'customer,admin'
  )
  AND EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace ns ON ns.oid = t.typnamespace
    WHERE ns.nspname = current_schema() AND t.typname = 'enum_Orders_status'
    GROUP BY t.typname
    HAVING string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) = 'placed,confirmed,shipped,delivered,cancelled'
  )
  AND EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace ns ON ns.oid = t.typnamespace
    WHERE ns.nspname = current_schema() AND t.typname = 'enum_Orders_paymentMethod'
    GROUP BY t.typname
    HAVING string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) = 'cod'
  )
  AND EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace ns ON ns.oid = t.typnamespace
    WHERE ns.nspname = current_schema() AND t.typname = 'enum_OrderStatusEvents_fromStatus'
    GROUP BY t.typname
    HAVING string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) = 'placed,confirmed,shipped,delivered,cancelled'
  )
  AND EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace ns ON ns.oid = t.typnamespace
    WHERE ns.nspname = current_schema() AND t.typname = 'enum_OrderStatusEvents_toStatus'
    GROUP BY t.typname
    HAVING string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) = 'placed,confirmed,shipped,delivered,cancelled'
  )
) AS ok;

-- verify: nine primary keys, four unique constraints, at least nine FKs
SELECT (
  SELECT count(*) FILTER (WHERE con.contype = 'p') = 9
     AND count(*) FILTER (WHERE con.contype = 'u') = 4
     AND count(*) FILTER (WHERE con.contype = 'f') >= 9
  FROM pg_constraint con
  JOIN pg_namespace ns ON ns.oid = con.connamespace
  WHERE ns.nspname = current_schema()
    AND con.contype IN ('p', 'u', 'f')
    AND con.conrelid IN (
      SELECT c.oid FROM pg_class c
      JOIN pg_namespace n2 ON n2.oid = c.relnamespace
      WHERE n2.nspname = current_schema()
        AND c.relkind = 'r'
        AND c.relname IN ('Users', 'Categories', 'Products', 'CartItems', 'WishlistItems', 'Addresses', 'Orders', 'OrderItems', 'OrderStatusEvents')
    )
) AS ok;

-- verify: the nine model-level indexes exist
SELECT (
  SELECT count(*)
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname IN ('idx_addresses_user', 'uq_orders_number', 'uq_orders_user_idem', 'idx_orders_user', 'idx_orders_status', 'idx_orders_address', 'idx_order_items_order', 'idx_order_items_product', 'idx_status_events_order')
) = 9 AS ok;
