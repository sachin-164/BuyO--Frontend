-- 011_product_reviews.pgsql
-- PostgreSQL mirror of 011_product_reviews.sql (checklist items 23-25).
-- Additive — applied inside one transaction by the PG runner.
--
-- Rollback (reviewed + manual):
--   DROP TABLE "ProductReviews"
--   DROP TYPE "enum_ProductReviews_status"
-- No existing table or row is touched by this migration.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_ProductReviews_status') THEN
    CREATE TYPE "enum_ProductReviews_status" AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ProductReviews" (
  "id" serial NOT NULL,
  "productId" integer NOT NULL,
  "userId" integer NOT NULL,
  "rating" smallint NOT NULL,
  "title" varchar(120),
  "body" text NOT NULL,
  "status" "enum_ProductReviews_status" NOT NULL DEFAULT 'pending',
  "moderatedBy" integer,
  "moderatedAt" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "ProductReviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductReviews_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Products" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "ProductReviews_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "Users" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "ProductReviews_moderatedBy_fkey" FOREIGN KEY ("moderatedBy")
    REFERENCES "Users" ("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_reviews_user_product"
  ON "ProductReviews" ("userId", "productId");
CREATE INDEX IF NOT EXISTS "idx_product_reviews_product_status"
  ON "ProductReviews" ("productId", "status", "createdAt");

-- verify: table, enum labels, unique index and FKs
SELECT (
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ProductReviews') = 1
  AND (SELECT COUNT(*) FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'enum_ProductReviews_status') = 3
  AND EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uq_product_reviews_user_product')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductReviews_userId_fkey')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductReviews_moderatedBy_fkey')
) AS ok;
