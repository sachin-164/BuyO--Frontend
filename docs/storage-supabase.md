# BuyO — Product Image Storage: Supabase Storage Design (Phase 8)

Status: **DESIGN ONLY — no bucket was created, no file uploaded, no
credentials read, no adapter code merged.** Implementation happens in a
later, separately-approved phase (it cannot be honestly tested without real
credentials; see §8). This document is the implementation contract.

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

## 2. Target design — minimal adapter

New module **`backend/lib/imageStore.js`** with a tiny interface, chosen by env:

```js
// saveImage({ buffer, mimetype, ext }) -> { reference, publicUrl }
// removeImage({ reference })            -> void   (best-effort, logged)
```

- **`local` implementation** = today's behavior (disk in `backend/uploads/`,
  `/uploads/<name>` reference) — stays the DEFAULT so dev and the whole test
  suite keep working unchanged.
- **`supabase` implementation** (added in the approved phase) = uploads to a
  Supabase Storage bucket via `@supabase/supabase-js` using
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (server-side only — never
  exposed to the browser), returns the bucket object path as `reference` and
  the public object URL as `publicUrl`.
- The controller change is one line: `image` = `publicUrl` from the adapter
  instead of the hard-coded `/uploads/` string. Validation (§3) stays in the
  route and runs BEFORE any storage call.

## 3. Validation & filename rules (carried over, tightened for serverless)

- Mimetype allowlist unchanged (`jpeg/png/gif/webp`).
- Magic-byte check moves **before** the upload (buffer-based, same
  signatures) — nothing invalid ever reaches the bucket.
- Server-generated names unchanged (`timestamp-randomhex.ext`); the bucket key
  is `products/<generated-name>` (one flat, collision-free prefix).
- Size: production cap lowered to **4 MB** (under Vercel's ~4.5 MB payload
  cap) — a deliberate policy change to document in the adapter PR; the error
  message updates with it. **Lowering the multer cap alone is NOT a fix** —
  it addresses only one of three independent limits: (a) Vercel's ~4.5 MB
  cap counts the *entire request*, so multipart boundaries/fields eat into
  it and a "4.5 MB" cap would still fail near the ceiling; (b) uploaded bytes
  would still land on **ephemeral disk** (B1) — gone on every restart/redeploy;
  (c) proxying every image through a function adds cold-start latency and
  function-duration cost. The durable answer for the storage phase is
  **direct-to-storage uploads**: the admin client requests a short-lived
  signed upload URL from the API (auth-checked), PUTs the file straight to
  Supabase Storage (no function payload limit applies), then confirms with
  the API, which verifies the object metadata and writes the DB row. The
  4 MB proxy cap remains only as the interim/dev-compatible path.
- `PUT /:id` multipart support stays future work (unchanged this phase).

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

- DB stores the **full public URL** in `Products.image` (what the upload
  response already returns today's equivalent of). No serializer or frontend
  change: every page renders whatever string is in `image`.
  Tradeoff (accepted, documented): if the bucket/domain ever changes, a
  backfill script rewrites the stored URLs — a single UPDATE guided by the
  `reference` column value.
- Local dev keeps `/uploads/<name>` relative references served by Express.

## 6. Existing local images — migration plan (cutover step, not run now)

Planned script `backend/scripts/storage-migrate.js` (guarded like every DB
script — loopback-only, allowlist, `--confirm-local`, plus an explicit target
bucket argument):

1. Read all `Products.image` values starting with `/uploads/`.
2. For each: read the file from `backend/uploads/`, magic-byte re-verify,
   upload to `products/<name>` in the bucket, then UPDATE the row to the full
   public URL — **only after the upload succeeds**.
3. Report: migrated / missing-file / upload-failure lists; never deletes
   local files (they remain as the rollback copy until the next backup cycle).
- Images referenced but missing on disk are reported, never invented.
- Rollback: the same table of old `/uploads/` values is written to a JSON
  report before any UPDATE, so URLs can be restored.

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

## 8. Blockers — why this is a plan and not code

1. **No credentials/bucket may exist yet** — this phase was forbidden from
   creating either; an adapter coded "blind" would ship untested HTTP calls.
2. The Supabase JS SDK is a new production dependency — its addition is part
   of the approved Storage phase (version pinned there, lockfile updated the
   same way `pg` was in Phase 8).
3. The 4 MB cap change (§3) touches the admin upload UX and its error
   message — small, but it needs its own reviewed diff with the security
   tests updated in the same commit.
4. The cutover order matters: adapter + migration script (§6) must land and
   be tested against a scratch bucket before any production image moves.

When that phase is approved, the implementation is: adapter module + one-line
controller change + `storage-migrate.js` + tests (local adapter = existing
suite stays green; supabase adapter = scratch-bucket integration test with
throwaway credentials) + `.env.example` additions.
