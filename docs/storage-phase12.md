# BuyO — Phase 12 record: Supabase Storage adapter & persistent product images

Scope as approved: implement the storage integration for Vercel readiness and
test it locally with mocks / a local adapter. **This phase did not connect to
Supabase, create a bucket, upload a remote file, migrate production images,
read credentials, or deploy.**

## 1. What was built

### Storage adapter (`backend/lib/imageStore.js`, new)

- Driver selection (`STORAGE_DRIVER`): `local` (default off-hosted; existing
  `/uploads` disk behavior byte-identical) or `supabase`.
- **Hosted no-fallback:** `VERCEL` set or `NODE_ENV=production` refuses to run
  without an explicit `STORAGE_DRIVER` (no silent ephemeral disk);
  `supabase` without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` throws at
  first use (503, never a disk write); multipart image bytes in hosted mode →
  409 `multipart-disabled` + synchronous file deletion.
- Supabase driver: `@supabase/supabase-js` `^2.118.0` added as a production
  dependency, **lazy-loaded only when selected** (local dev/tests never load
  it); service-role key stays server-side only (never in responses/logs/errors
  — errors name variables, never values).
- `verifyStoredObject`: server-side verification of STORED objects (storage-
  recorded mimetype+size must equal the AUTHORIZED values; magic bytes of the
  downloaded content must match the authorized type).
- Shared image constants/signatures now live here; `productRoutes.js` imports
  them (single source of truth, behavior unchanged).

### Single-use upload ledger (`backend/lib/uploadLedger.js`, new)

In-memory, TTL-bound, single-use authorizations bound to the authorizing
admin. take() is atomic and consumes on every outcome (replay/foreign/expired
are all dead ends). Cap = 500 entries (refuse, don't grow). Documented
per-process limitation (same class as the in-memory rate limiter).

### Direct-to-storage upload endpoints (`backend/routes/uploadRoutes.js`, new)

`POST /api/uploads/authorize` (auth+admin): validates content type
(allowlist), size (`MAX_IMAGE_BYTES`), original filename (control chars /
path separators rejected; never used for naming — names stay server-
generated), mints a signed upload URL for exactly one `products/<...>` path,
records the ledger entry, returns
`{ objectPath, signedUploadUrl, uploadToken, publicUrl, expiresAt, maxBytes }`.
409 `code:"local-storage"` in local mode (clients keep multipart).

### Controller verify-then-save (`backend/controllers/productController.js`)

`resolveProductImageValue()` runs in `addProduct`/`updateProduct` immediately
before the DB write (cheap validations happen first, so a slug conflict never
consumes an upload). Local driver = passthrough. Supabase driver: pending
path / own bucket URL → ledger consume → verify → durable public URL written;
`/uploads/` NEW references refused; external http(s) URLs pass through
(existing feature); re-sending the product's unchanged image is a no-op.
DB failure after verification → best-effort object removal (compensation).

### Admin client (`admin/js/storage-upload.js`, new; `admin/js/product-form.js`)

Create-with-file now: authorize → PUT bytes directly to storage (never
through the API function) → product JSON create with `image=objectPath`.
409 `local-storage` → the existing multipart path runs byte-for-byte.
Product-form.html loads the new script.

### Guarded migration utility (`backend/scripts/storage-migrate.js`, new)

`npm run migrate:storage` — see `docs/storage-supabase.md` §6. Dry-run
(classify `/uploads/` references, JSON report, zero writes/SDK) and `--apply`
(approval token + `--confirm-remote` + explicit `--bucket` +
`DATABASE_URL`-unset tripwire; upload → download → sha-256 verify →
optimistic UPDATE; source files never deleted; recovery = `before` values in
the report). Refusals happen before any connection or SDK construction.
**Not executed against any real data this phase.**

## 2. Configuration (all documented in `.env.example` + `docs/environment-variables.md`)

`STORAGE_DRIVER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_STORAGE_BUCKET` (default `product-images`), `MAX_IMAGE_BYTES`
(default 5 MB, clamp 1 KB–25 MB — default preserved on purpose),
`UPLOAD_AUTH_TTL_MS` (default 10 min, clamp 1 s–1 h),
`STORAGE_MIGRATION_APPROVED`, `STORAGE_MIGRATE_ALLOWED_DATABASES`.

## 3. Test evidence (this commit)

MySQL (`npm test`): **222 tests — 221 pass, 0 fail, 1 skip** (the skip is the
pre-existing Phase 3 PG-only savepoint case). New files:

| Suite | Tests | What it covers |
|---|---|---|
| `test/storageAdapter.test.js` | 16 | driver/hosted refusal rules, config clamps, signatures, pending-path shape, local adapter (save/remove/traversal confinement), ledger semantics, MOCKED supabase resolution + failure classes |
| `test/storageUpload.test.js` | 19 | authorize authz/validation, full authorize→upload→create flow, storage failure before save, MIME spoof through storage, size mismatch, expiry, replay, foreign admin, invalid paths, DB-failure orphan compensation, hosted multipart rejection, `/uploads/` preservation, external URLs, update flow, **real SDK never constructed** |
| `test/storageMigrate.test.js` | 7 | refusal without approval (zero SDK constructions), `DATABASE_URL` tripwire, dry-run classification without side effects, MOCKED apply (checksum-verified update, missing/invalid rows untouched, no source deletion), tamper → removal + no DB update, CLI wiring refusals |
| `test/adminUploadFlow.test.js` | 6 | client orchestration with MOCKED network: multipart fallback, sequence order, error paths never upload/create |
| `security.test.js` (+3) | — | local-mode authorize 409, `/uploads/` reference compat, static `/uploads/` serving |

PostgreSQL: `test:pg` 5/5, `catalog` 18/18, `orders` 22/22, `auth` 16/16,
`cart` 15/15, `security` 23/23, `migrations` 14/14, `tooling` 8/8, `data` 9/9,
**`storage` 19/19** (new `test:pg:storage` — the upload API verified under the
PG dialect too). All green, no test weakened or skipped.

## 4. Locally verified vs mocked vs unverified

- **Verified locally (real):** local storage behavior (byte-identical, existing
  suite green), all refusal/no-fallback rules, ledger semantics, controller
  verify-then-save + orphan compensation (fault-injected), migration-tool
  guards/classification/reporting against a scratch MySQL database, client
  orchestration logic.
- **MOCKED (clearly labeled in tests; `backend/test/mockSupabaseStorage.js`):**
  every Supabase Storage call — signed upload URLs, object metadata, download,
  removal, checksum upload/download. The real `createClient` was never
  constructed in any test (asserted).
- **Unverified:** real bucket creation/policy, real signed-URL upload from a
  browser, real CORS, real object metadata shapes end-to-end, real
  `migrate:storage --apply`, cross-origin image loading in production.

## 5. Known limitations / deferred decisions

- Upload ledger is per-process (multi-instance → shared store at cutover).
- 4 MB default cap change deliberately deferred (configurable already).
- Legacy `admin/add-product.html` remains a local-multipart page; hosted admin
  uses `admin/product-form.html`.
- Orphan sweep (24 h safety net) documented, not automated.
- Real `buyoDB` `/uploads/` inventory not run this phase (dry-run is a
  cutover step; requires `STORAGE_MIGRATE_ALLOWED_DATABASES` override).

## 6. Next-phase recommendation

Storage activation (approved separately): create the sandbox bucket, set the
supabase driver env on a non-production target, run ONE real end-to-end upload
+ a real `migrate:storage --dry-run` (and sandbox `--apply`), verify CORS and
image loading — i.e. turn the MOCK-labeled rows of §4 into verified ones.
Alternative next phase: the long-planned Supabase project/sandbox first-contact
for the database side (`docs/migration-remote.md` §5–§6).
