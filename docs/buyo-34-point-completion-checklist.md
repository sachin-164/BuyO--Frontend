# BuyO — 34-Point Feature Completion Checklist

> Living document. Status is only advanced when the item has automated tests **and**
> the acceptance criteria in this file are met. "Endpoint exists" is not "done".
>
> Baseline: `9078aae` (`react-migration` == `master` == deployed production commit).
> Production is live at `https://buyo-project-ten.vercel.app` and is **not** modified
> by this work until an approved release.

## Status legend

| Status | Meaning |
| --- | --- |
| `DONE` | Implemented, tested, verified in a real browser against a real backend |
| `IMPLEMENTED` | Code + automated tests pass; real-browser acceptance still pending |
| `PARTIAL` | Some of the capability exists (usually pre-existing) |
| `TODO` | Not started |
| `BLOCKED (owner)` | Capability is built but cannot be enabled with real data/policy without the owner |
| `BLOCKED (creds)` | Needs third-party credentials/services not available locally |
| `GATED` | Requires explicit approval before touching production |

For UI items, `DONE` means the journey was exercised in the 2026-10-22 Chrome
run against real MySQL + Express (see **Real-browser acceptance** below). For
backend-only items (email, storage, aggregate APIs, migrations) `DONE` means the
live code path plus automated tests were exercised; a browser is not applicable.
Anything not covered by real data or credentials is listed in the blocked
register rather than claimed as verified.

## Ground rules applied to every item

1. No invented business policy, reviews, variants, company copy, shipping or return promises.
   Anything content-shaped is either derived from existing data or marked **owner configuration**.
2. Schema changes ship as reviewed, reversible migrations. No destructive migration runs against
   live data without a written plan and explicit confirmation.
3. New endpoints are authorization-tested: unauthenticated, wrong-owner, non-admin, admin.
4. Destructive workflows (cancellation, restock, delete) are tested with isolated test data only.
5. `react-migration` only. No intermediate production deploy.

---

## A. Admin: customers

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 1 | Admin customer directory API | Missing (no `/api/admin/customers`) | GET list w/ search + pagination + per-customer order count/spend; GET detail with addresses + recent orders; admin-only, no password/token fields | — | Non-admin 403; search matches name/email; totals agree with DB aggregate; never returns `password` | `adminReadModels.test.js` | DONE |
| 2 | Admin customer directory UI | Missing | `/admin/customers` list (search, pagination, empty/error/skeleton) + `/admin/customers/:id` detail; nav entry | 1 | Search via URL state; deep-linkable; keyboard accessible; no fabricated data | `customers-pages.test.tsx` | DONE |

## B. Admin: analytics

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 3 | Reliable aggregate analytics API | Missing; dashboard walks capped client pages | `GET /api/admin/analytics/summary`: totals by status, gross/net order value, AOV, 30-day revenue series, top products, low/out-of-stock, new customers — all SQL aggregates | — | Figures equal direct SQL on the same DB; no truncation cap; date range validated | `adminReadModels.test.js` | DONE |
| 4 | Dashboard wired to aggregates | Client-side, capped at 2.5k products / 5k orders, labelled as such | Replace with analytics query; remove truncation copy; keep skeletons/errors | 3 | Dashboard renders in one request; numbers match API; no "truncated" wording left | `dashboard.test.tsx` | DONE |

## C. Admin: orders

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 5 | Admin order free-text search | Status filter + pagination only | `q` matches order number, customer name, customer email; URL-driven; combinable with status | — | Case-insensitive; escapes `%`/`_`; pagination total stays distinct-correct; empty result state | `adminReadModels.test.js` | DONE |

## D. Products: images

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 6 | Secure product image replacement (backend) | `PUT /products/:id` accepts multipart with the same auth/magic-byte/allowlist checks; hosted storage still answers 409 and deletes the file; the replaced local file is deleted only after commit and only when no other product (primary or gallery) references it | Done — an unsupported/silently-skipped file type is now a 400 instead of a product saved without the chosen image | — | Invalid type/signature rejected; non-admin 403; old file removed, new file served; failure leaves the product unchanged; rejected bytes never stay on disk | `productImageReplace.test.js` (9) | DONE |
| 7 | Product image replacement UI | Replace/remove image on `/admin/products/:id/edit`, including local-disk multipart replacement (the old "hosted storage only" block is gone); alt text travels with the upload in one request | Done | 6 | Works for local and authorized hosted flow; preview updates; a11y-labelled; no second request that could fail after the product saved | `product-form.test.tsx` (11) | DONE |

## E. Account

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 8 | Profile update API | `PATCH /api/auth/me` (name only; email immutable, phone is per-address) | Whitelist validator drops unknown fields; returns fresh public user | - | Empty/whitespace/over-long name 400; `role`/`isVerified`/`email` in the body are ignored; no password material returned | `accountSecurity.test.js` | DONE |
| 9 | Profile edit UI | Profile form on the account page | RHF + Zod mirroring the server rule; auth cache replaced from the response | 8 | Client validation blocks empty names; success toast; heading/name update without refetch; discard resets | `account-management.test.tsx` | DONE |
| 10 | Secure password change API | Only token-based reset | `POST /api/auth/change-password`: current-password proof, 8–72 policy, compare-and-swap write, fresh token returned | - | Wrong current password is **400 + `INVALID_CURRENT_PASSWORD`** (not 401 — a 401 would trigger the SPA's global sign-out for a typo); old tokens die; current device keeps working; anonymous 401 | `accountSecurity.test.js` | DONE |
| 11 | Password change UI | Account security card | Current / new / confirm fields with client-side match + difference checks | 10 | Field-level errors; pending state; success clears all fields and stores the replacement token; mismatch never calls the API | `account-management.test.tsx` | DONE |

## F. Orders: cancellation

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 12 | Customer order cancellation API | Admin-only cancellation | `POST /orders/:id/cancel`: owner-scoped, only cancellable statuses, single transaction, exactly-once restock, status event | — | Concurrent double-cancel → one 200 + one 409; stock restored exactly once; other users get 404; terminal states 409 | `orderCancelAndNotifications.test.js` | DONE |
| 13 | Customer cancellation UI | Missing | Cancel action on eligible orders with confirm dialog, disabled/terminal states, cache invalidation | 12 | Refetches order + list; shows new event in the timeline; no action on terminal orders | `orders-pages.test.tsx` | DONE |

## G. Auth: verification

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 14 | Verification resend API | `POST /api/auth/resend-verification` (rate-limited, non-enumerating) | Sends only to unverified accounts; unknown addresses pay a bcrypt cost for timing parity; transport failures swallowed | - | Identical response for unknown/verified/unverified; verified accounts receive nothing; issued link actually verifies; payload validation 400 | `accountSecurity.test.js` | DONE |
| 15 | Verification resend UI | `ResendVerificationForm` on login (after 403) and the no-token verification screen | Prefilled email, 60 s client cooldown, `role="status"` live region, verbatim generic server copy | 14 | Form only appears for a real 403 or a missing token; cooldown disables the button; success copy never implies the account exists | `account-management.test.tsx` | DONE |

## H. Cart: guest

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 16 | Guest cart persistence + merge support | Server cart only | `POST /api/cart/merge` replays `[{productId, qty}]` through the same locked upsert as `POST /api/cart`: duplicate ids summed, qty clamped to stock and 99, deleted/out-of-stock products skipped with a reason, empty payload a no-op | — | Merge is additive and safe to re-submit (stock ceiling never exceeded); deleted products skipped and reported; the whole cart stays scoped to the caller | `cartMerge.test.js` (9) | DONE |
| 17 | Guest cart merge client flow | Missing | localStorage guest cart (`buyo.guestCart.v1`) with the same `CartResponse` shape and preview totals; add/update/remove work signed-out; `AuthProvider` merges on sign-in/boot and clears the local copy only after success; `storage` events keep tabs in sync; cart page asks guests to sign in to check out | 16 | No double-add across tabs; failed merge keeps the guest cart; header count uses the same store; nothing is ordered before authentication | `guest-cart.test.tsx` (11) | DONE |

## I. Notifications

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 18 | Order placed confirmation email | Auth mail only | Send receipt on successful checkout (non-blocking, failure never rolls back the order) | — | Exactly one mail per order, including idempotent replay; totals/items match the order | `orderCancelAndNotifications.test.js` | DONE |
| 19 | Order status / cancellation notifications | Missing | Mail on each admin status change and customer cancellation, in the same transaction's success path | 12 | Sent after commit only; failure logged, not surfaced as order failure; one mail per transition | `orderCancelAndNotifications.test.js` | DONE |

## J. Catalog: variants — **owner-approved 2026-10-22**

Owner decisions recorded before implementation:
- Option types are **size** and **colour** (either or both per variant).
- Every variant has a unique SKU enforced by the database.
- Stock is independent per variant; the legacy `Products.stock` remains the
  aggregate cache for variant-managed products so existing list filters,
  analytics and quick-add checks keep working. A product with no variants is
  unchanged.
- Price is `Products.sellingPrice + variant.priceAdjustment` (optional delta,
  may be negative, but the final unit price must stay positive).
- Variants are deactivated, never hard-deleted; order items snapshot the
  variant id, SKU, size, colour, adjustment and actual unit price.

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 20 | Variant data model + migration | Missing | Additive `ProductVariants` table (size, colour, unique SKU, price delta, stock, active) + `CartItems.variantId` + order-item snapshots. Reversible migrations `010_product_variants.sql` / `.pgsql`; PostgreSQL cart uniqueness moves to `(UserId, productId, variantId)` | — | Migration up/down documented and exercised on a disposable DB; existing products/orders untouched; duplicate SKU rejected by the DB; sync-built and migration-built PostgreSQL schemas stay catalog-identical | `migrations.test.js`, `pgBaseSchema.test.js` | TODO |
| 21 | Variant API + admin editor | Missing | Admin `GET/POST /api/products/:id/variants`, `PUT /api/products/:id/variants/:variantId`; public active variants on product detail; validation of options, SKU, stock, price delta, final price; aggregate stock kept transactional | 20 | Non-admin 403; duplicate SKU 409; negative stock / invalid delta / empty options / missing variant rejected 400; deactivation removes a variant from public sale but preserves order history | `variants.test.js` | TODO |
| 22 | Variant storefront selection | Missing | PDP size/colour selector that resolves a real variant/SKU; price, availability and quantity bound to that variant; cart/checkout/order/cancellation preserve it | 21 | Selector only shows variants that exist; out-of-stock/inactive/stale variants cannot be added or checked out; cart line records variant; guest merge keeps variant identity | `variants-ui.test.tsx`, acceptance run | TODO |

## K. Catalog: reviews — **owner-approved 2026-10-22**

Owner decisions recorded before implementation:
- Any signed-in customer may review any product. **No verified-purchase
  requirement** (explicitly waived by the owner).
- Every new review starts `pending`; only `approved` reviews are public or
  contribute to rating aggregates.
- One review per customer per product, enforced by a database unique index.
- Admins may approve or reject, and may change an already-moderated review;
  moderation records status, timestamp and administrator id.
- Customer sees their own review and moderation status; no customer edit or
  delete endpoint (avoiding unmoderated changes).

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 23 | Review data model + migration | Missing | Additive `ProductReviews` table (rating 1–5, title, body, status, moderatedBy/moderatedAt) + unique `(userId, productId)`. Reversible `011_product_reviews.sql` / `.pgsql` | — | Up/down documented and exercised on a disposable DB; no seeded/fake reviews; pending rows can never be selected by public code paths | `migrations.test.js`, `pgBaseSchema.test.js` | TODO |
| 24 | Review API | Missing | Public approved-only list + live rating aggregate; authenticated create with server validation and forced pending status; own-review endpoint; admin moderation list/update | 23 | Unauth 401; invalid rating/length 400; duplicate 409; status/userId mass assignment ignored; public list/aggregate exclude pending/rejected; non-admin moderation 403; repeated moderation is safe | `reviews.test.js` | TODO |
| 25 | Review UI | Missing | PDP approved-review list, rating summary, signed-in submission form + own pending/rejected status; admin moderation queue with loading/empty/error/success states and approve/reject | 24 | Empty state says "no reviews yet" — never fabricated; pending review is visible only to its author; a11y-labelled form errors; admin actions authorized server-side | `reviews-ui.test.tsx`, acceptance run | TODO |

## L. Catalog: discovery

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 26 | Related products | PDP fetched a category list and filtered out itself in the browser | `GET /api/products/:identifier/related?limit=` (4 default, 12 cap): same `categoryId` (legacy name fallback), self excluded, in-stock siblings first, deterministic newest/id order; PDP renders only what the endpoint returns and hides the section when empty | — | Never invents products; empty state hides the section; bounded query | `productDiscovery.test.js` (5 related), `product-related.test.tsx` (2) | DONE |
| 27 | Search suggestions API | Catalog list only | `GET /products/suggestions?q=` — name-only, case-insensitive on both dialects, LIKE metacharacters literal, <2 chars returns an empty list, max 8 results, only id/slug/name/price/image selected | — | `q` min length; max 8 results; escaped LIKE; no N+1 | `productDiscovery.test.js` (5 suggestions) | DONE |
| 28 | Autocomplete combobox UI | Basic combobox exists | Wired to the suggestions endpoint (250 ms debounce, term-scoped query keys so late responses cannot overwrite newer ones); full ARIA combobox pattern, arrow wrap, Escape, result-count announcement, recent searches, manual Enter still works when suggestions fail | 27 | Full keyboard operation; announces result count; no stale render races | `search-combobox.test.tsx` (6) | DONE |

## M. Catalog: taxonomy

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 29 | Category hierarchy (migration + tree API) | Flat categories | Reversible migration `009_categories_parent.sql` / `.pgsql` (nullable self-FK `ON DELETE SET NULL`); `GET /api/categories` keeps `count` + the flat `categories` array and adds `parentId`, `depth`, `totalProductCount`, `maxDepth` and a server-built `tree`; writes enforce depth 3 from the root and reject self/descendant parents; deleting a parent promotes its children to roots in one transaction | — | Cycle rejected; depth bounded (the moved subtree's full height is validated); flat response stays backward compatible | `categoryTree.test.js` (10), `migrations.test.js`, `pgBaseSchema.test.js`, `pgMigrations.test.js`, `pgTooling.test.js` | DONE |
| 30 | Storefront category navigation | Flat grid | Categories page renders the tree (root cards → children → grandchildren) with honest direct vs rollup counts; shop breadcrumbs include the ancestor chain; the catalog select is tree-ordered and indented; a parent filter shows child links and a child filter links back to its parent | 29 | Deep-linkable `/shop?category=<slug>` URLs; a parent with no direct products shows its children and an honest empty result; keyboard accessible via native links and labelled nav landmarks | `categories-nav.test.tsx` (5) | DONE |
| 31 | Admin category hierarchy UI | Flat CRUD | Parent selector in the form (self + descendants excluded, depth-3 parents disabled), tree-ordered table with a Parent column and depth indentation, server hierarchy errors mapped to the parent field, delete copy explains promoted subcategories | 29 | Cannot set self/descendant as parent; clear cycle/depth/missing-parent errors; no silent data loss on delete | `categories-page.test.tsx` (11) | DONE |

## N. Catalog: media

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 32 | Multi-image product media (data + API) | `ProductImages` table (`url`, `alt`, `position`, FK `ON DELETE CASCADE`) + reversible migrations 008 (MySQL + PostgreSQL); `Products.image` is still the primary and is mirrored from row 0 | Done — `GET /products/:identifier` returns `images`; admin `PUT/POST/DELETE /products/:id/images`; max 8; re-sending stored URLs consumes no new upload authorization | 6 | Ordering stable; first image is primary; deleting a product removes its rows; replacing the legacy `image` keeps row 0 in sync | `productGallery.test.js` (13) | DONE |
| 33 | Gallery UI (storefront + admin) | PDP renders the server gallery in order (falls back to the primary for products without rows); admin editor adds by URL/file, reorders, edits alt, removes — each action returns the refreshed gallery | Done — duplicate sources collapsed; no invented captions; arrow buttons are labelled and disabled at the ends; first image marked "Primary" | 32 | Keyboard reachable; no motion beyond existing transitions (reduced-motion safe); real images only | `product-gallery-editor.test.tsx` (9), `gallery.test.ts` (6) | DONE |

## O. Release

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 34 | Release readiness: migrations, env, rollback, acceptance | Phase 6 docs exist | Evidence complete: migrations `008`/`009` recorded with risk + rollback, no new env vars, risk register, release/rollback plan, and the 2026-10-22 real-browser acceptance run. The production schema migration and backend deploy still need explicit owner approval | 1–33 | Full suite green, production build clean, real-browser journeys pass against a real backend | `npm test` (backend 330: 329 pass, 1 PG-only skip), `npx vitest run` (208/208), `npx tsc --noEmit`, `npm run build`, `docs/acceptance/run.cjs` (25/25) | GATED |

---

## Dependency order for implementation

```
Phase A  1,2,3,4,5            (admin read models — no schema change)
Phase B  12,13,18,19          (order lifecycle + notifications)
Phase C  8,9,10,11,14,15      (account + auth)
Phase D  6,7,32,33            (media)
Phase E  16,17                (guest cart)
Phase F  26,27,28             (discovery)
Phase G  29,30,31             (taxonomy; schema)
Phase H  20,21,22,23,24,25    (variants + reviews; schema; owner-gated)
Phase I  34                   (release evidence)
```

Rationale: read models first (they make later phases observable), then money/stock paths
(cancellation + notifications), then account/security, then schema-bearing catalog work.
Media ships before multi-image so there is one upload path, not two.

## Owner-provided configuration required

| Area | What the owner must supply | Blocks |
| --- | --- | --- |
| Variants | Which option types exist (size/colour/etc.), per-product values, SKUs, stock, price deltas | 20–22 |
| Reviews | Whether reviews are enabled, verified-purchase-only policy, moderation stance | 23–25 |
| Policies | Shipping promise, return window, company legal details | Not fabricated — existing pages already say "owner input required" |
| Catalog content | Real category tree, real product images/alt text | 29–33 data (not code) |

## Blocked / gated register

| Item | Blocker | Unblock action |
| --- | --- | --- |
| Real email delivery (18,19) | No production SMTP credentials available locally | Capture mode for tests; real send verified by the owner post-deploy |
| Hosted image upload (7,33) | Supabase Storage credentials | Local driver verified; hosted path verified with the Supabase mock + owner smoke test |
| Production authenticated journeys | No production test account; creating one is prohibited | Local real-backend browser acceptance; production read-only smoke |
| Any production migration / deploy | Explicit approval required | Present migration + risk + rollback plan (item 34) |

## Migrations waiting for production approval

| Migration | Change | Risk | Rollback |
| --- | --- | --- | --- |
| `008_create_product_images.sql` / `.pgsql` (item 32) | Additive `ProductImages` table (`productId`, `url`, `alt`, `position`) with `ON DELETE CASCADE` FK to `Products` and index `idx_product_images_product_position` | Low: `CREATE TABLE IF NOT EXISTS` only; no existing column, row or index is touched. Old code ignores the table entirely. Runs in a single transaction on PostgreSQL | `DROP TABLE "ProductImages";` (MySQL: ``DROP TABLE `ProductImages`;``) — `Products.image` is untouched by the migration, so the storefront keeps rendering with or without it |
| `009_categories_parent.sql` / `.pgsql` (item 29) | Additive nullable `Categories.parentId` plus self-FK `Categories_parentId_fkey` (`ON UPDATE CASCADE ON DELETE SET NULL`). No backfill: every existing category stays a root | Low: one nullable column + one FK; old code ignores both, and no row or index is rewritten. Deliberately no extra index (matches `sequelize.sync`; MySQL creates its FK index automatically). Guarded/re-runnable; PG runs in one transaction | `ALTER TABLE "Categories" DROP CONSTRAINT "Categories_parentId_fkey"; ALTER TABLE "Categories" DROP COLUMN "parentId";` (MySQL: ``ALTER TABLE `Categories` DROP FOREIGN KEY `Categories_parentId_fkey`; ALTER TABLE `Categories` DROP COLUMN `parentId`;``) — discards hierarchy links only, never rows |

---

## Real-browser acceptance — 2026-10-22

Executed with `docs/acceptance/run.cjs` (recorded output:
`docs/acceptance/report-2026-10-22.json`).

Environment: disposable MySQL `buyoDB_ph2_test`, real Express on `:5000`
(`NODE_ENV=test`, `MAIL_TRANSPORT=json`), real Vite on `:5173`, Google Chrome via
Playwright, desktop 1440×900 + mobile 390×844.

Result: **25/25 steps passed**, 0 browser console errors (excluding the two
intentional 4xx responses from negative tests). Every step asserts the UI *and*
the database (Sequelize models) or the captured mail outbox.

| Area | Steps | Evidence |
| --- | --- | --- |
| Storefront | home; category tree → `/shop?category=bottles`; suggestions combobox; PDP image (naturalWidth > 0), related products | 4 steps |
| Guest cart (16,17) | guest add → header count → `/cart` reachable → `localStorage` line; merge on sign-in into the server cart; local copy emptied | 2 steps |
| Auth (8–11,14,15) | signup → captured verification mail → unverified login 403 → resend mail (2 captured) → verify link → login; profile name persisted; wrong current password field error, then change + re-login; reset link → new password → old token 401 | 5 steps |
| Orders (12,13,18,19) | address create (DB row, default); COD checkout (one order, stock −1, total > 0); history/detail; cancel (status, restock exactly once, 2 events); receipt + cancellation mail captured | 4 steps |
| Admin (1–5) | analytics API equals DB counts/sum/status; dashboard card; customer search → detail; confirm a second order → customer mail; order free-text search is URL-driven; category create with parent | 5 steps |
| Security/errors | anonymous 401; foreign order 404; idempotent replay returns the same order with one row and one receipt; stale stock blocks checkout without creating an order; unsupported upload 400; non-admin upload 403 | 1 step |
| Quality (34) | mobile: no horizontal overflow on 5 routes + mobile nav; a11y: 1 H1, lang, alt text, labelled buttons, main landmark; SEO: title/description/OG + PDP title; perf: DCL < 5 s, main bundle < 800 kB; no console errors | 4 steps |

Defects found and fixed during this run (committed separately):

1. `/cart` was still wrapped in `RequireAuth`, so guests could add items but
   could not open the cart they had just filled (contradicted item 17's
   acceptance). The route is now public; checkout remains guarded.
2. The Vite dev server proxied `/api` but not `/uploads`, so locally stored
   product images 404'd in development. `/uploads` is now proxied (hosted
   deployments use absolute Supabase URLs and are unaffected).
3. `index.html` had no Open Graph/Twitter metadata. OG site/title/description
   and a Twitter card were added.

Honest limits of this run (also in the blocked register): mail is capture-mode
(no SMTP), storage is the local disk driver (no Supabase), the admin account is
seeded locally, and the production dataset (0 categories) cannot exercise the
hierarchy. Gallery *replacement* UI was covered by automated tests, not this
browser run.

---

## Production release plan — awaiting explicit approval

Nothing below has been executed against production. Production is still the
baseline commit `9078aae` (Vercel deployment `dpl_GkpNWj9eoL5Khao7XFos7fjG2GFd`),
with schema migrations `008`/`009` **not** applied.

### Preconditions

1. Owner approval for the schema migration + backend deploy.
2. A current production database backup/snapshot (Supabase PITR or `pg_dump`).
3. Production backend env already includes `STORAGE_DRIVER`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (hosted start refuses local-disk storage) and real
   `EMAIL_USER`/`EMAIL_PASS`, `FRONTEND_URL`, `BACKEND_URL`, `JWT_SECRET`.
   **No new env vars are required by this release.**
4. `react-migration` CI state: backend 330 tests (329 pass, 1 PG-only skip),
   frontend 208/208, `tsc` clean, production build clean, acceptance 25/25.

### Steps (in order)

1. **Schema (Postgres):** run `backend/migrations/008_create_product_images.pgsql`
   then `009_categories_parent.pgsql` in the approved SQL console. Both are
   guarded/re-runnable and PG runs each in a transaction.
2. **Backend:** deploy the approved `react-migration` commit. Old frontend code
   keeps working because both changes are additive.
3. **Frontend:** deploy the same commit to Vercel. `master` stays untouched
   until this is approved; promotion is a deliberate merge/redeploy step.
4. **Smoke (read-only):** `GET /api/products`, `GET /api/categories` (expect
   `tree`/`maxDepth`), `/api/products/suggestions?q=bo`, a PDP's
   `/related`, image URLs, and the storefront routes. There are no production
   orders/accounts, so authenticated admin smoke needs owner credentials.

### Rollback

- **Frontend:** instant rollback in Vercel to `dpl_GkpNWj9eoL5Khao7XFos7fjG2GFd`
  (commit `9078aae`).
- **Backend:** redeploy the previous backend build. Old code ignores
  `ProductImages` and `Categories.parentId`.
- **Schema (only if a rollback requires it):** run the DOWN statements in the
  migration table above, `009` before `008`. No rows are deleted by either.
- **Data:** no backfill happened; existing categories remain roots and products
  keep `image`. Orders/stock are unaffected by the schema rollback.

### Risk register

| Risk | Mitigation |
| --- | --- |
| Hierarchy UI before migration → SQL error on `parentId` | Apply `009` before deploying the backend/frontend; flat API fields remain |
| Hosted storage misconfigured → image uploads 503 | Fail-fast config check before deploy; local driver never used on hosted |
| Email delivery failure | Sends happen after commit and are logged/swallowed; orders never roll back; exactly one receipt per checkout via idempotency |
| Double checkout / double restock | Server idempotency key + row lock + single transaction (covered by tests and the live replay step) |
| Guest cart data leak | Cart is client-local until sign-in merge; merge is scoped to the caller |
| Migration rollback data loss | Both migrations only add objects; DOWN removes objects, never rows |


