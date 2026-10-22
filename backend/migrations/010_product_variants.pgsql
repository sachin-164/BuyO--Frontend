-- 010_product_variants.pgsql
-- PostgreSQL mirror of 010_product_variants.sql (checklist items 20-22).
-- Additive — applied inside one transaction by the PG runner.
--
-- PostgreSQL cart uniqueness moves from (UserId, productId) to
-- (UserId, productId, COALESCE(variantId, 0)): one base line and one line per
-- variant, while legacy NULL base rows are still de-duplicated by the database.
-- MySQL keeps its transactional app-level dedup.
--
-- Rollback (reviewed + manual):
--   DROP TABLE "ProductVariants" CASCADE (drops its FKs and the cart/order
--   snapshot columns' FK constraints but NOT the columns)
--   ALTER TABLE "CartItems" DROP COLUMN "variantId"
--   ALTER TABLE "OrderItems" DROP COLUMN "variantId", DROP COLUMN "variantSku",
--     DROP COLUMN "variantSize", DROP COLUMN "variantColor",
--     DROP COLUMN "variantPriceAdjustment"
--   DROP INDEX IF EXISTS "uq_cartitems_user_product_variant"
-- Historical Orders/OrderItems rows are never modified by this migration.

CREATE TABLE IF NOT EXISTS "ProductVariants" (
  "id" serial NOT NULL,
  "productId" integer NOT NULL,
  "sku" varchar(64) NOT NULL,
  "size" varchar(40),
  "color" varchar(40),
  "priceAdjustment" numeric(10,2) NOT NULL DEFAULT 0,
  "stock" integer NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "ProductVariants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductVariants_sku_key" UNIQUE ("sku"),
  CONSTRAINT "ProductVariants_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Products" ("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_product_variants_product"
  ON "ProductVariants" ("productId", "isActive");

ALTER TABLE "CartItems" ADD COLUMN IF NOT EXISTS "variantId" integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CartItems_variantId_fkey') THEN
    ALTER TABLE "CartItems" ADD CONSTRAINT "CartItems_variantId_fkey"
      FOREIGN KEY ("variantId") REFERENCES "ProductVariants" ("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS "uq_cartitems_user_product";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cartitems_user_product_variant"
  ON "CartItems" ("UserId", "productId", COALESCE("variantId", 0));

ALTER TABLE "OrderItems" ADD COLUMN IF NOT EXISTS "variantId" integer;
ALTER TABLE "OrderItems" ADD COLUMN IF NOT EXISTS "variantSku" varchar(64);
ALTER TABLE "OrderItems" ADD COLUMN IF NOT EXISTS "variantSize" varchar(40);
ALTER TABLE "OrderItems" ADD COLUMN IF NOT EXISTS "variantColor" varchar(40);
ALTER TABLE "OrderItems" ADD COLUMN IF NOT EXISTS "variantPriceAdjustment" numeric(10,2);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderItems_variantId_fkey') THEN
    ALTER TABLE "OrderItems" ADD CONSTRAINT "OrderItems_variantId_fkey"
      FOREIGN KEY ("variantId") REFERENCES "ProductVariants" ("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- verify: variant table, cart/order columns, cart variant uniqueness and FKs
SELECT (
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ProductVariants') = 1
  AND (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CartItems' AND column_name = 'variantId') = 1
  AND (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'OrderItems' AND column_name IN ('variantId','variantSku','variantSize','variantColor','variantPriceAdjustment')) = 5
  AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_cartitems_user_product_variant')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductVariants_productId_fkey')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CartItems_variantId_fkey')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderItems_variantId_fkey')
) AS ok;
