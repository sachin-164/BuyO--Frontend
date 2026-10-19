# BuyO — Product Image Storage: Supabase Storage Design & Implementation (Phase 8 design; Phase 12 code)

Status (Phase 12): **adapter + direct-to-storage upload flow + guarded
migration utility IMPLEMENTED and tested — every remote behavior tested
against a MOCKED `@supabase/supabase-js` client. No bucket was created, no
file uploaded, no remote service contacted, no credentials read.** Real
end-to-end upload against a Supabase project remains unverified (§8). This
document is the implementation contract + the record of what Phase 12 built;
the phase record with test evidence is `docs/storage-phase12.md`.

## 1. Current pipeline (audited, unchanged)

All in `backend/routes/productRoutes.js` + `backend/app.js`:

- **Entry:** admin-only `POST /api/products` accepts multipart field `image`
  (`PUT /:id` is JSON-only today — multipart image replacement is future work).
- **Limits:** 5 MB (`multer` `limits.fileSize`); mimetype allowlist
  `image/jpeg|png|gif|webp` — anything else is silently ignored (file never
  stored, product still created from the JSON fields).
- **Naming:** server-generated only — `<timestamp>-<8 random bytes hex><ext>`,
  extension derived from the allowlisted mimetype, never the client name.
- **Content check:** magic-byte verification (`verifyImageFile`) after
  staging; mismatch → synchronous delete + 400.
- **Persistence:** `multer.diskStorage` into `backend/uploads/` (git-ignored);
  DB stores the relative reference `Products.image = "/uploads/<filename>"`
  (a full URL string is also accepted via JSON).
- **Serving:** `app.use("/uploads", globalLimiter, express.static(...))`.
- **Pinned by tests** (`backend/test/security.test.js`): server-generated
  names, traversal impossible, disguised content rejected and deleted,
  non-allowlisted mimetypes never stored.

**Serverless problem:** on Vercel, `backend/uploads/` is ephemeral (§4 blocker
B1) and the 5 MB cap exceeds the ~4.5 MB function payload cap (B2). Local disk
cannot be the production store.

## 2. Implemented adapter (Phase 12) — `backend/lib/imageStore.js`

One interface, two drivers, chosen by env (`resolveStorageDriver`):

- **`local`** = today's behavior (disk in `backend/uploads/`,
  `/uploads/<name>` reference) — stays the DEFAULT so dev and the whole test
  suite keep working unchanged.
- **`supabase`** = `@supabase/supabase-js` (pinned `^2.118.0`, production
  dependency, **lazy-loaded only when selected**) with
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (server-side only — never
  exposed to the browser, responses, or error messages).

Interface actually shipped:

```js
// createSignedUpload({ objectPath })  -> { signedUrl, token, path }   (short-lived, single path)
// verifyStoredObject({ path, expected }) -> { size, mimetype }        (info + download + magic bytes)
// removeImage({ path })               -> boolean                      (best-effort, logged)
// uploadBuffer({ objectPath, buffer, contentType, sha256Base64 })    (migration tool)
// downloadBuffer({ objectPath }) -> Buffer                            (migration tool: integrity check)
// publicUrlFor(objectPath) / isOwnReference(value) / objectPathFromOwnReference(value)
```

**No-fallback rules (tested):** hosted environments (`VERCEL` set or
`NODE_ENV=production`) refuse to run without an explicit `STORAGE_DRIVER`;
`supabase` without URL/key throws on first use (503, never a disk write);
multipart image bytes are rejected with 409 `multipart-disabled` (and deleted)
whenever the driver is not `local`; the controller never invents `/uploads/`
references in hosted mode. Configuration errors surface at first storage use
(503), never as a boot crash, and never echo configured values.

- The controller integration is `resolveProductImageValue()`: local driver =
  byte-identical passthrough; supabase driver = verify-then-save (§5).

## 3. Validation & filename rules (carried over, tightened for serverless)

- Mimetype allowlist unchanged (`jpeg/png/gif/webp`).
- **Content verification for direct uploads happens SERVER-SIDE at
  save time, not client-side before upload:** the server never sees the bytes
  before storage, so `verifyStoredObject` downloads the stored object and
  checks (a) storage-recorded mimetype == the AUTHORIZED type, (b)
  storage-recorded size == the AUTHORIZED size, (c) magic bytes of the actual
  bytes match that type. Spoofed content is deleted and refused with 400
  (tested with MOCKED storage). The local multipart path keeps its
  pre-storage disk check unchanged.
- Server-generated names unchanged (`timestamp-randomhex.ext`); the bucket key
  is `products/<generated-name>` (one flat, collision-free prefix). Object
  paths are validated by shape (`products/<safe-segment>`, no traversal).
- Size limit is **configurable** (`MAX_IMAGE_BYTES`, default kept at the
  historical 5 MB, clamp 1 KB–25 MB). The direct-to-storage flow removes the
  Vercel ~4.5 MB *function* payload concern entirely (bytes never traverse
  the function); lowering the default to 4 MB is deliberately left as a
  cutover decision (it touches admin UX copy) and is no longer required for
  correctness. Direct upload is refused outright in local mode (409
  `local-storage`) so the dev path stays byte-identical.
- `PUT /:id` multipart support stays future work (unchanged); `PUT /:id`
  accepts a verified pending upload path in JSON (same verify-then-save).

## 4. Bucket, access policy & credentials

- **Bucket:** one bucket, name `product-images`, **public-read objects,
  writes only via the service-role key** (clients can never write; the bucket
  is not listed publicly). Product images are public catalog data — signed
  URLs would add expiry management for zero privacy gain. (Alternative,
  private bucket + signed URLs, is supported by the same interface if
  requirements change; it would need a URL-refresh path in the frontend.)
- **Credentials:** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` as API env
  vars (Vercel secret manager only). The key is full-privilege: it must never
  appear in responses, logs, git, or client code (see
  `docs/environment-variables.md`).
- **Serving:** public object URLs
  `https://<project>.supabase.co/storage/v1/object/public/product-images/products/<name>`.
  Images load cross-origin from the frontend → the storage origin must be
  allowed in the image `CSP`/CORS story (Supabase serves permissive CORS for
  storage by default; verify in the deploy smoke test).

## 5. How image URLs are stored and served

- DB stores the **full public URL** in `Products.image`. No serializer or
  frontend change: every page renders whatever string is in `image`.
  Tradeoff (accepted, documented): if the bucket/domain ever changes, a
  backfill script rewrites the stored URLs — a single UPDATE guided by the
  `reference` column value.
- Local dev keeps `/uploads/<name>` relative references served by Express.

### 5.1 Direct-to-storage upload flow (implemented, Phase 12)

1. Admin client (create form, file mode) calls
   **`POST /api/uploads/authorize`** (auth + admin required) with
   `{ contentType, size, filename }`.
2. Server validates (allowlist type, `MAX_IMAGE_BYTES`, safe original
   filename), generates the object path, records a **single-use, TTL-bound
   upload authorization** (`backend/lib/uploadLedger.js`, in-memory —
   per-process limitation documented like the rate limiter) and returns
   `{ objectPath, signedUploadUrl, publicUrl, expiresAt }`. The service-role
   key never leaves the server; the signed URL is scoped to exactly that path.
3. Admin client **PUTs the bytes directly to storage** (`admin/js/
   storage-upload.js`; never through the API function — no payload cap).
4. Client creates the product with `image: <objectPath>`; the server
   **verifies then saves**: consume the authorization (single-use, admin-
   bound, expiry-checked) → `verifyStoredObject` (metadata equality +
   magic bytes) → only then write the row with the durable public URL.
5. Failures: verification failure → 400 (+ object deleted when content is
   invalid); storage outage → 502 (object left alone); DB write failure after
   verification → best-effort object removal (compensation) — all pinned by
   MOCKED tests in `backend/test/storageUpload.test.js`.
6. `admin/js/product-form.js` falls back to the existing multipart path
   byte-for-byte whenever the API answers 409 `local-storage` (local mode).

## 6. Existing local images — migration utility (implemented Phase 12; NOT executed)

`backend/scripts/storage-migrate.js` (`npm run migrate:storage`) is guarded
like every DB script and refuses BEFORE any connection or SDK construction:

- **`--dry-run --confirm-local --source-db <db>`** — reads the local loopback
  MySQL source (allowlist `STORAGE_MIGRATE_ALLOWED_DATABASES`, default
  `buyoDB_ph12_storage`), classifies every `Products.image` starting with
  `/uploads/` (ready / missing-file / invalid-content / unsafe-reference),
  writes a credential-free JSON report to `backend/backups/`. No storage
  client is constructed, nothing is uploaded, no row is modified.
- **`--apply --bucket <name> --confirm-remote --confirm-local --source-db
  <db>`** additionally requires: `STORAGE_MIGRATION_APPROVED` equal to the
  approval token `phase-cutover-approval`, `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY`, `NODE_ENV != production`, and **`DATABASE_URL`
  unset** (same tripwire posture as `docs/migration-remote.md`; the tool
  never reads it). The `--bucket` flag is the authoritative target.
- Apply flow per ready file: upload to `products/<name>` (sha-256 checksum
  passed to storage) → **download the object back and compare sha-256 with
  the local file** → only after integrity is proven,
  `UPDATE Products SET image = ? WHERE id = ? AND image = ?` (optimistic: a
  row changed since inventory becomes `skipped-changed`, never overwritten).
  Mismatch → object removed, row untouched, counted as failed, exit 1.
  Local files are **never deleted** (they are the rollback copy).
- Images referenced but missing on disk are reported, never invented.
- Safe to re-run: already-migrated rows drop out of the `/uploads/` selection.

**Recovery procedure (§6.4):** every apply run writes
`backups/storage-migrate-apply-<timestamp>.json` with per-row `before` (the
old `/uploads/` value), `after`, `sha256` and status. To revert a migrated
row, restore `before` with a direct operator-run UPDATE against the source
database; the local files still exist, so the site returns to its
pre-migration state byte-for-byte. To redo a run, fix the reported rows and
re-run `--apply` (idempotent).

Test evidence (`backend/test/storageMigrate.test.js`, MOCKED remote):
refusals without approval trip before any SDK construction; dry-run touches
nothing; apply migrates only ready rows, verifies checksums, updates the DB
only after verified upload, removes tampered objects, and never deletes
source files.

## 7. Failure handling

- Invalid file (type/size/magic bytes) → 400 before any storage call (as today).
- Storage upload fails → 500 with the standard safe error body; nothing in DB.
- Upload succeeds but the DB write fails → best-effort `removeImage()` of the
  just-uploaded object in the same request (compensation); if the process
  dies between the two, a periodic orphan sweep (objects older than 24 h with
  no matching DB row) is the safety net — documented, run manually at first.
- Serving failures are Supabase's availability story; the site degrades to
  broken `<img>` icons, never broken pages (frontend already renders
  image-less cards).

## 8. Remaining work before cutover (post-Phase 12)

Implemented and locally verified (mocked): adapter, no-fallback rules,
authorize endpoint, verify-then-save controller integration, orphan
compensation, admin client flow, migration utility + recovery report.

Still unverified / to do in the approved storage-activation phase:

1. **Real bucket + real credentials** — create `product-images` (public-read,
   service-role-only writes, 4 MB–ish policy configurable via
   `MAX_IMAGE_BYTES`), set `STORAGE_DRIVER=supabase` + `SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY` on the platform, then run ONE real sandbox
   upload end-to-end. Every remote behavior in this document is currently
   MOCK-tested only (`backend/test/mockSupabaseStorage.js`).
2. **First real `migrate:storage --apply`** against a scratch/sandbox bucket
   (approval token + `--confirm-remote` + `--bucket` + `DATABASE_URL` unset),
   following §6; production `buyoDB` migration happens at the approved cutover
   with the documented dry-run → apply → verify sequence.
3. **Multi-instance upload ledger** — the in-memory single-use ledger works
   per process; a multi-instance deployment needs a shared store (same class
   as the in-memory rate limiter; both are cutover decisions).
4. Browser CORS for the direct PUT to the storage origin + deploy smoke of
   cross-origin image loading (verify in the deploy smoke test, §4).
5. The 4 MB default cap change (§3) remains an optional, separately reviewed
   UX decision — not required for correctness.
