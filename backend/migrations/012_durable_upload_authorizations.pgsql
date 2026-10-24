-- 012_durable_upload_authorizations.pgsql
-- Replaces the process-local upload-authorization ledger with a durable,
-- database-backed one so Vercel's multiple instances share the same
-- single-use state.
--
-- Each row authorizes exactly one server-generated object path for one admin,
-- with the validated mimetype/size and an expiry. Consumption deletes the row
-- inside a transaction (SELECT ... FOR UPDATE + DELETE), so a path can never
-- be replayed, used by another admin, or used after expiry.
--
-- Additive only: no existing table or row is modified.
-- Rollback (reviewed + manual): DROP TABLE "UploadAuthorizations";
-- Pending authorizations are short-lived (10 minutes by default), so losing
-- them at rollback only forces the admin to upload again.

CREATE TABLE IF NOT EXISTS "UploadAuthorizations" (
  "id" serial NOT NULL,
  "objectPath" varchar(255) NOT NULL,
  "adminId" integer NOT NULL,
  "mimetype" varchar(100) NOT NULL,
  "size" integer NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "UploadAuthorizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UploadAuthorizations_adminId_fkey" FOREIGN KEY ("adminId")
    REFERENCES "Users" ("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_upload_authorizations_object_path"
  ON "UploadAuthorizations" ("objectPath");

CREATE INDEX IF NOT EXISTS "idx_upload_authorizations_expires"
  ON "UploadAuthorizations" ("expiresAt");

-- verify: table, unique path index, expiry index, admin FK
SELECT (
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'UploadAuthorizations') = 1
  AND EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uq_upload_authorizations_object_path')
  AND EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_upload_authorizations_expires')
  AND EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'UploadAuthorizations_adminId_fkey')
) AS ok;
