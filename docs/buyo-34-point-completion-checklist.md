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
| 1 | Admin customer directory API | Missing (no `/api/admin/customers`) | GET list w/ search + pagination + per-customer order count/spend; GET detail with addresses + recent orders; admin-only, no password/token fields | — | Non-admin 403; search matches name/email; totals agree with DB aggregate; never returns `password` | `adminReadModels.test.js` | IMPLEMENTED |
| 2 | Admin customer directory UI | Missing | `/admin/customers` list (search, pagination, empty/error/skeleton) + `/admin/customers/:id` detail; nav entry | 1 | Search via URL state; deep-linkable; keyboard accessible; no fabricated data | `customers-pages.test.tsx` | IMPLEMENTED |

## B. Admin: analytics

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 3 | Reliable aggregate analytics API | Missing; dashboard walks capped client pages | `GET /api/admin/analytics/summary`: totals by status, gross/net order value, AOV, 30-day revenue series, top products, low/out-of-stock, new customers — all SQL aggregates | — | Figures equal direct SQL on the same DB; no truncation cap; date range validated | `adminReadModels.test.js` | IMPLEMENTED |
| 4 | Dashboard wired to aggregates | Client-side, capped at 2.5k products / 5k orders, labelled as such | Replace with analytics query; remove truncation copy; keep skeletons/errors | 3 | Dashboard renders in one request; numbers match API; no "truncated" wording left | `dashboard.test.tsx` | IMPLEMENTED |

## C. Admin: orders

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 5 | Admin order free-text search | Status filter + pagination only | `q` matches order number, customer name, customer email; URL-driven; combinable with status | — | Case-insensitive; escapes `%`/`_`; pagination total stays distinct-correct; empty result state | `adminReadModels.test.js` | IMPLEMENTED |

## D. Products: images

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 6 | Secure product image replacement (backend) | `PUT /products/:id` is JSON-only | Accept multipart on update with the same auth/magic-byte/allowlist checks; reject hosted-storage multipart; delete the replaced local file only after a successful commit | — | Invalid type/signature rejected; non-admin 403; old file removed, new file served; failure leaves the product unchanged | `productImageReplace.test.js` | TODO |
| 7 | Product image replacement UI | Create-only upload | Replace/remove image on `/admin/products/:id/edit` with progress + error states | 6 | Works for local and authorized hosted flow; preview updates; a11y-labelled | `product-form.test.tsx` | TODO |

## E. Account

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 8 | Profile update API | Read-only `/auth/me` | `PATCH /auth/me` for name (+ optional phone if column added by migration); email immutable in this phase | — | Empty body 400; length limits; cannot change `role`/`isVerified`; returns fresh public user | `profile.test.js` | TODO |
| 9 | Profile edit UI | Read-only account page | Inline edit form with RHF + Zod mirroring server rules | 8 | Validation parity with server; success/error toasts; optimistic cache update | `account-page.test.tsx` | TODO |
| 10 | Secure password change API | Only token-based reset | `POST /auth/change-password` requiring current password, new-password policy, re-hash; fails closed on wrong current password | — | Wrong current password 401; policy enforced; rate-limited; no password material in response/logs | `passwordChange.test.js` | TODO |
| 11 | Password change UI | Missing | Account security section with current/new/confirm | 10 | Inline errors; disables while pending; success clears fields | `account-security.test.tsx` | TODO |

## F. Orders: cancellation

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 12 | Customer order cancellation API | Admin-only cancellation | `POST /orders/:id/cancel`: owner-scoped, only cancellable statuses, single transaction, exactly-once restock, status event | — | Concurrent double-cancel → one 200 + one 409; stock restored exactly once; other users get 404; terminal states 409 | `orderCancel.test.js` | TODO |
| 13 | Customer cancellation UI | Missing | Cancel action on eligible orders with confirm dialog, disabled/terminal states, cache invalidation | 12 | Refetches order + list; shows new event in the timeline; no action on terminal orders | `orders-cancel.test.tsx` | TODO |

## G. Auth: verification

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 14 | Verification resend API | Missing (documented dead end) | `POST /auth/resend-verification`, rate-limited, non-enumerating response, no-op for verified accounts | — | Same response for unknown/verified/unverified; mail captured in tests; limiter applies | `resendVerification.test.js` | TODO |
| 15 | Verification resend UI | Missing | Resend control on login (unverified 403) and verification-failure screen | 14 | Cooldown timer; a11y live region; generic success copy | `verify-resend.test.tsx` | TODO |

## H. Cart: guest

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 16 | Guest cart persistence + merge support | Server cart only | Guest cart in `localStorage`; `POST /cart/merge` accepting `[{productId, qty}]`, clamping to stock, summing with the server cart | — | Merge is idempotent on re-submit after clear; deleted products skipped and reported; stock clamped, never exceeded | `cartMerge.test.js` | TODO |
| 17 | Guest cart merge client flow | Missing | Hydrate guest cart on boot, merge on login/signup, clear local copy on success | 16 | No double-add across tabs; failed merge keeps the guest cart; header count correct | `guest-cart.test.tsx` | TODO |

## I. Notifications

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 18 | Order placed confirmation email | Auth mail only | Send receipt on successful checkout (non-blocking, failure never rolls back the order) | — | Exactly one mail per order, including idempotent replay; totals/items match the order | `orderEmails.test.js` | TODO |
| 19 | Order status / cancellation notifications | Missing | Mail on each admin status change and customer cancellation, in the same transaction's success path | 12 | Sent after commit only; failure logged, not surfaced as order failure; one mail per transition | `orderStatusEmails.test.js` | TODO |

## J. Catalog: variants — **owner-gated**

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 20 | Variant data model + migration | Missing | Reversible migration: `product_variants` (sku, name, option values, price delta, stock, active) + indexes | Owner confirms which option types exist | Migration up/down both tested; existing products untouched | `migrations.test.js` | TODO |
| 21 | Variant API + admin editor | Missing | CRUD under `/products/:id/variants` (admin), public read on PDP; validation; stock/price integrity | 20 | Non-admin 403; cannot orphan a variant; pricing derives from base + delta | `variants.test.js` | TODO |
| 22 | Variant storefront selection | Missing | PDP option selector that maps to a real variant/SKU; no fabricated options | 21 + owner content | Selector only shows variants that exist; cart line records the variant; out-of-stock variant blocked | `variants-ui.test.tsx` | BLOCKED (owner) |

## K. Catalog: reviews — **owner-gated**

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 23 | Review data model + migration | Missing | Reversible migration: `product_reviews` (rating 1–5, title, body, verified purchase, status) + unique (user, product) | Owner confirms review policy + moderation stance | Up/down tested; no seeded/fake reviews | `migrations.test.js` | TODO |
| 24 | Review API | Missing | Public list w/ pagination + rating summary; authenticated create (verified purchase only); admin moderation | 23 + owner policy | One review per user/product; rating aggregate is computed, never stored stale; unverified buyers rejected per policy | `reviews.test.js` | BLOCKED (owner) |
| 25 | Review UI | Missing | PDP rating summary + list + form; admin moderation queue | 24 | Empty state says "no reviews yet" — never fabricated; a11y form errors | `reviews-ui.test.tsx` | BLOCKED (owner) |

## L. Catalog: discovery

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 26 | Related products | Missing | Same-category siblings, deterministic order, exclude self, exclude out-of-stock optionally | — | Never invents products; empty state hides the section; bounded query | `related.test.js` | TODO |
| 27 | Search suggestions API | Catalog list only | `GET /products/suggestions?q=` — bounded, prefix/contains over name, returns id/slug/name/price/image | — | `q` min length; max 8 results; escaped LIKE; no N+1 | `suggestions.test.js` | TODO |
| 28 | Autocomplete combobox UI | Basic combobox exists | Wire to suggestions with debounce, keyboard nav, ARIA combobox semantics, recent searches | 27 | Full keyboard operation; announces result count; no stale render races | `search-combobox.test.tsx` | TODO |

## M. Catalog: taxonomy

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 29 | Category hierarchy (migration + tree API) | Flat categories | Reversible migration `parentId` + cycle prevention; tree in `GET /categories` | — | Cycle rejected; depth bounded; flat response stays backward compatible | `categoryTree.test.js` | TODO |
| 30 | Storefront category navigation | Flat grid | Parent/child nav + breadcrumbs + filtered shop links | 29 | Deep-linkable; empty parent handled; keyboard accessible | `categories-nav.test.tsx` | TODO |
| 31 | Admin category hierarchy UI | Flat CRUD | Parent selector + tree table + move validation | 29 | Cannot set self/descendant as parent; clear errors | `categories-page.test.tsx` | TODO |

## N. Catalog: media

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 32 | Multi-image product media (data + API) | Single `image` string | Reversible migration `product_images` (url, alt, position) + API; `image` remains the primary for compatibility | 6 | Ordering stable; first image is primary; deleting a product removes its rows | `productImages.test.js` | TODO |
| 33 | Gallery UI (storefront + admin) | Single image | PDP gallery from real images only; admin add/reorder/alt editor | 32 | Keyboard/swipe; reduced-motion safe; no placeholder invented captions | `product-gallery.test.tsx` | TODO |

## O. Release

| # | Requirement | Current | Remaining work | Depends on | Acceptance criteria | Tests | Status |
|---|---|---|---|---|---|---|---|
| 34 | Release readiness: migrations, env, rollback, acceptance | Phase 6 docs exist | Consolidated migration record, env-var delta, risk register, rollback procedure, full automated + real-browser acceptance evidence | 1–33 | Full suite green, production build clean, real-browser journeys pass against a real backend | `npm test` (backend + frontend), e2e log | GATED |

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
