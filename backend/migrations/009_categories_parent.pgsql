-- 009_categories_parent.pgsql
-- PostgreSQL mirror of 009_categories_parent.sql (Phase G, item 29).
-- Additive + guarded; one transaction is applied by the PG runner.
-- Rollback (reviewed + manual; discards hierarchy links only):
--   ALTER TABLE "Categories" DROP CONSTRAINT "Categories_parentId_fkey";
--   ALTER TABLE "Categories" DROP COLUMN "parentId";

ALTER TABLE "Categories" ADD COLUMN IF NOT EXISTS "parentId" integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Categories_parentId_fkey') THEN
    ALTER TABLE "Categories" ADD CONSTRAINT "Categories_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "Categories" ("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- verify: Categories.parentId and its self-referencing FK exist
SELECT (
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Categories' AND column_name = 'parentId') = 1
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Categories_parentId_fkey')
) AS ok;
