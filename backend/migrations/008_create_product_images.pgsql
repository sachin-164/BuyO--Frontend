-- 008_create_product_images.pgsql
-- PostgreSQL mirror of 008_create_product_images.sql (Phase D, item 32).
-- Additive + guarded; one transaction is applied by the PG runner.
-- Rollback (reviewed + manual): DROP TABLE "ProductImages";

CREATE TABLE IF NOT EXISTS "ProductImages" (
  "id" serial NOT NULL,
  "productId" integer NOT NULL,
  "url" varchar(500) NOT NULL,
  "alt" varchar(255),
  "position" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "ProductImages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductImages_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Products" ("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_product_images_product_position"
  ON "ProductImages" ("productId", "position");
