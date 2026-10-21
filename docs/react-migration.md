# BuyO — React Migration: Audit, Architecture, and Plan

Status: **Phases 1–6 verified locally** (audit, React foundation, storefront,
commerce, admin, release readiness). The deployed static frontend and Express API
are **untouched** by this migration until the Phase 6 cutover is explicitly
approved. Isolated preview and cutover remain blocked pending approval; see
`docs/react-phase-6-release-readiness.md`.

Firm decision: the entire frontend (storefront + admin) moves to one React +
TypeScript + Vite application. The Express/PostgreSQL/Supabase backend is reused.

---

## 1. Guardrails

- No database schema changes, no migrations, no credential changes.
- No destructive production changes. The current deployment stays live until the
  replacement passes verification.
- API contracts (`/api/...`) and production URLs are preserved.
- Authorization stays server-side (`requireAuth` / `requireAdmin`); hiding
  routes in the SPA is never treated as security.
- No secrets in the bundle: only `VITE_*` public values; the Supabase
  service-role key remains a server-only environment variable.
- Art direction follows the approved tokens in `docs/design-system.md` (teal
  `#064E4A`, amber `#F59E0B`, warm `#F7F7F5` background, serif display type).

---

## 2. Current system audit (verified from the repository)

### 2.1 Hosting and routing

- Vercel project `buyo-project`; production alias
  `buyo-project-ten.vercel.app`.
- `vercel.json` rewrites `/api/:path*` → `/api/app` (the Express app in
  `api/app.js`) and otherwise serves static files from the repository root.
- The customer site is 20 root HTML files / 19 plain-JS modules.
  The admin panel is 7 HTML files / 9 JS modules under `admin/`.
- Auth token is stored in `localStorage` under the key `token`
  (`js/api.js`). Preserve this key at cutover so sessions survive.
- Checkout idempotency keys are held in `sessionStorage` per checkout attempt
  (`js/checkout.js`); the React checkout must keep that behaviour.

### 2.2 API contract (all under `/api`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/signup` | public | email verification required before login |
| GET | `/auth/verify` | public | verification link target |
| POST | `/auth/login` | public | 403 until verified; returns `token` + `user` |
| POST | `/auth/forgot-password` | public | |
| POST | `/auth/reset-password` | public | |
| GET | `/auth/me` | user | fresh DB reload; password-version binding |
| GET | `/categories` | public | `{ categories: [...], count }`, includes `productCount` |
| POST/PUT/DELETE | `/categories[/:id]` | admin | create/update/delete |
| GET | `/products` | public | list; `page`, `limit`, `q`, `category`, `minPrice`, `maxPrice`, `inStock`, `sort`; returns `pagination` |
| GET | `/products/:idOrSlug` | public | detail |
| POST | `/products` | admin | JSON or multipart `image` (create only) |
| PUT | `/products/:id` | admin | **JSON only today** (no image replacement) |
| DELETE | `/products/:id` | admin | |
| GET/POST/PUT/DELETE | `/cart[/:id]` | user | server cart; add/set quantity/remove |
| GET/POST | `/wishlist`, `/wishlist/toggle` | user | membership + toggle |
| GET | `/wishlist/products/:productId` | user | membership check |
| DELETE | `/wishlist/:productId` | user | |
| GET/POST | `/addresses` | user | list/create |
| PUT | `/addresses/:id`, `/addresses/:id/default` | user | update / set default |
| DELETE | `/addresses/:id` | user | |
| GET/POST | `/orders` | user | own list; POST = COD checkout (`addressId`, `idempotencyKey`) |
| GET | `/orders/:id` | user | own detail |
| GET | `/admin/orders`, `/admin/orders/:id` | admin | all orders |
| PUT | `/admin/orders/:id/status` | admin | placed→confirmed→shipped→delivered; cancellation rules |
| POST | `/uploads/authorize` | admin | mints Supabase signed upload; 503 if storage unconfigured |
| GET | `/health`, `/health/ready` | public | liveness / bounded DB readiness |

Models: `User`, `Product`, `Category`, `CartItem`, `WishlistItem`, `Address`,
`Order`, `OrderItem`, `OrderStatusEvent`.

### 2.3 Existing workflows

Catalog discovery (search/filter/sort/pagination, product galleries, discount
and stock states) · auth with email verification and password reset · server
cart · wishlist · address book with default address · COD checkout with stock
decrement and idempotency · order history with status events · admin product
CRUD with image upload · admin category CRUD · admin order list/detail and
status transitions · admin role gate via DB role.

---

## 3. Migration map

| Legacy page / area | React route | Phase |
|---|---|---|
| `index.html` | `/` | 2 (shell), 3 (full) |
| `products.html` | `/shop` | 3 |
| `product-details.html?id=` | `/product/:slug` (id fallback) | 3 |
| `categories.html` | `/categories` | 3 |
| search on all catalog pages | `/search?q=` | 3 |
| `about.html`, `contact.html`, `services.html` | `/about`, `/contact`, `/services` | 3 |
| `cart.html` | `/cart` | 4 |
| `wishlist.html` | `/wishlist` | 4 |
| `login.html`, `signup.html`, `verify.html` | `/login`, `/signup`, `/verify` | 4 |
| `forgot-password.html`, `reset-password.html` | `/forgot-password`, `/reset-password` | 4 |
| `profile.html` | `/account` | 4 |
| address book | `/account/addresses` | 4 |
| `checkout.html` | `/checkout` | 4 |
| order history / detail | `/orders`, `/orders/:id` | 4 |
| `admin/dashboard.html` | `/admin` | 5 |
| `admin/products.html` | `/admin/products` | 5 |
| `admin/product-form.html`, `admin/add-product.html` | `/admin/products/new`, `/admin/products/:id/edit` | 5 |
| `admin/categories.html` | `/admin/categories` | 5 |
| `admin/orders.html` | `/admin/orders` | 5 |
| `admin/order-detail.html` | `/admin/orders/:id` | 5 |
| legacy `*.html` entry points | redirects (keep query strings where meaningful) | 6 |

---

## 4. Feature-gap matrix

“Legacy” = present but partial. Gaps are implemented in the phase shown.

| Capability | Legacy | Gap to close | Phase |
|---|---|---|---|
| URL-driven catalog state | Legacy partial | search/filter/sort/page in URL; back/forward safe | 3 |
| Search UX | Legacy basic | debounce, suggestions, clear, no-result recovery | 3 |
| Catalog states | Legacy partial | skeletons, retry, empty states, image fallback | 3 |
| Product gallery | Legacy basic | multi-image-ready gallery, keyboard/swipe, zoom-safe layout | 3 |
| Auth guards | Legacy per-page JS | route guard + return-to + cross-tab session sync | 4 |
| Session expiry | Legacy 401 handling | central query cache clear + sign-in prompt + toast | 4 |
| Cart/wishlist | Legacy refetch | optimistic update with rollback; shared counts in header | 4 |
| Checkout | Legacy form | RHF + Zod mirroring server validation; inline address create | 4 |
| Order tracking | Legacy text | accessible status timeline from `OrderStatusEvent` | 4 |
| Admin dashboard | Legacy counts | counts + recent orders + explicit empty/error states | 5 |
| Admin product image replace | **Missing in backend** | `PUT /products/:id` accepts JSON only; needs backend change → **blocked pending approval** | 5/6 |
| Admin list pagination | Legacy partial | URL pagination, filters, consistent tables | 5 |
| Notifications | Legacy toasts | single accessible toast system for both apps | 2/4 |
| A11y | Legacy partial | focus management on route change, reduced motion, labelled controls | 2/6 |
| SEO/meta | Legacy static | per-route title/description (SPA-safe) | 6 |
| Error handling | Legacy partial | route error boundary + API error normalization | 2 |

No backend rewrite is planned. Only the image-replacement gap may require a
small, separately approved backend change.

---

## 5. Target architecture

```
frontend/                      # new, isolated SPA (production untouched)
  src/
    components/ui/             # shadcn-style primitives (CVA + Tailwind tokens)
    components/layout/         # storefront shell, header, footer, admin shell (P5)
    components/product/        # product card, gallery, price (P3)
    features/                  # feature modules: catalog, cart, auth, orders, admin
    lib/                       # api client, query client, utils, motion
    pages/                     # route components
    test/                      # Vitest setup
    routes.tsx                 # route map, lazy loading, guards (P4)
    App.tsx / main.tsx
```

Libraries: React 18 + TypeScript, Vite, React Router, Tailwind CSS,
shadcn/ui conventions (CVA + Radix primitives), TanStack Query, React Hook
Form + Zod, Framer Motion, Lucide icons.

Data flow:

- `lib/api.ts` — one typed `fetch` wrapper, same-origin `/api`, bearer token
  from `localStorage["token"]`, normalized `ApiError`, one 401 event.
- TanStack Query — server state only; query keys per resource; mutations
  invalidate the affected keys. No duplicated server state in context.
- Auth context (P4) — holds the `me` query result, never the password; guards
  read it, server remains authoritative.
- Forms — RHF + Zod client validation; server validation errors mapped back to
  fields.
- Uploads (P5) — browser → `/api/uploads/authorize` (admin) → signed PUT to
  Supabase Storage → create product with the object path. No service-role key
  in the browser.
- Design system — semantic Tailwind tokens mirroring `css/tokens.css`;
  serif display headings; 4px spacing; AA contrast; focus-visible rings.
- Motion — Framer Motion only for hierarchy/feedback; `MotionConfig
  reducedMotion="user"` plus a CSS kill-switch.
- A11y — skip link, landmarks, labelled controls, visible focus, route-change
  focus reset, live regions for async status.

---

## 6. Deployment plan and constraints

Current production constraint: the repository root is the published static
site, and `/api/*` rewrites to `api/app.js`. Adding SPA rewrites now would
break live pages, so **Phases 2–6 build and verify locally/CI only until the
approved cutover**.

Cutover (Phase 6, requires explicit approval):

1. Install frontend dependencies in CI (workspace or
   `npm ci --prefix frontend --include=dev`).
2. Build `frontend/dist`.
3. Set Vercel build settings to publish that directory while keeping the
   existing `api/app.js` function and `/api/:path*` rewrite. The exact candidate
   `vercel.json` is in `docs/react-phase-6-release-readiness.md` and is **not**
   applied yet.
4. Add SPA fallback (`/(.*)` → `/index.html`) **after** static asset and API
   routes; keep `admin` deep links working.
5. Verify: health/readiness, catalog, auth, cart, checkout, admin order flow,
   storage upload, legacy redirects, 404, security headers.
6. Roll back by reverting `vercel.json`/build settings to the previous
   deployment (static frontend remains in git, untouched), or use the recorded
   Vercel rollback deployment in `docs/react-phase-6-release-readiness.md`.

Environment:

- Same-origin API, so no new frontend secrets.
- Optional `VITE_API_BASE_URL` for local/preview only; default empty.
- Supabase service-role key stays in Vercel Production (server-only), already
  configured for the storage adapter.
- Do not change production environment variables during Phases 2–5.

---

## 7. Phase checklist

- [x] **Phase 1 — audit, migration map, gap matrix, architecture, deployment plan**
- [x] **Phase 2 — Vite/React/TS foundation + shared design system + shell**
  - [x] Isolated `frontend/` workspace with build, typecheck, and tests
  - [x] Tailwind tokens mirroring the approved design system
  - [x] UI primitives (button, input, label, card, badge, alert, skeleton,
        spinner, empty state)
  - [x] API client, query client, error boundary
  - [x] Responsive storefront shell (header, mobile nav, footer, skip link)
  - [x] Route map with lazy loading + honest placeholders for later phases
  - [x] Home page backed by live catalog APIs (proves the data layer)
  - [x] 404 page
  - [x] Verified: `tsc --noEmit` clean, Vite production build succeeds, 9/9
        Vitest tests pass (API client, button composition, full app shell)
- [x] **Phase 3 — storefront and discovery**
  - [x] URL-driven shop/search state (`q`, `category`, `minPrice`,
        `maxPrice`, `inStock`, `sort`, `page`); defaults omitted, invalid values
        fall back safely, browser back/forward and reload restore the view
  - [x] Live catalog results with sort, category, price, stock filters, active
        filter chips, clear-all, counts, skeleton/error/empty states, retry, and
        accessible URL pagination (12 per page)
  - [x] Debounced search combobox (250 ms) backed by real product results,
        keyboard listbox navigation, mobile search dialog, device-local recent
        searches, and a search landing page
  - [x] Category index, category-aware shop heading/breadcrumb, and an honest
        empty state when no Category records are published
  - [x] Product page with stock-aware quantity (max `min(99, stock)`),
        cart/wishlist actions using existing APIs, auth/error/success feedback,
        single-image gallery with keyboard-accessible lightbox/zoom, breadcrumbs,
        not-found/error/loading states, and category-based related products
  - [x] Footer Help/Shipping/Returns/Privacy/Terms links; About, Contact,
        Services, Help, Shipping, Returns, Privacy, Terms pages
  - [x] Owner-input notices and draft labels on every page that would otherwise
        require invented company, contact, delivery, return, or legal details
  - [x] Motion: opacity-only route transition, product-card hover/focus,
        dialog/menu transitions, reduced-motion respected via CSS and
        `MotionConfig`; no parallax, scroll hijacking, or stagger delays
  - [x] Mobile baseline: tap-highlight removal, `touch-action: manipulation`,
        16 px form controls on coarse pointers, safe-area viewport, hover gated
        to supporting devices
  - [x] Verified: `tsc --noEmit` clean, production build succeeds, 32/32 Vitest
        tests pass (URL state, recent searches, combobox keyboard flow, catalog
        states, product actions, info notices)
  - [x] Verified against live read-only API response shapes and at 390/768/1440
        viewports; local preview serves `/shop`, `/product/:id`, `/search`,
        `/privacy`, and `/categories` directly with the SPA fallback
- [x] **Phase 4 — cart, wishlist, accounts, addresses, checkout, orders**
  - [x] Live cart page backed by `GET/POST /api/cart` and
        `PUT/DELETE /api/cart/:id`; optimistic line updates with rollback, server
        totals/`totalsNotice` always authoritative, stock/unavailable states,
        keyboard-accessible quantity controls, and an explicit sign-in prompt for
        anonymous visitors (no guest cart exists in the API)
  - [x] Wishlist page and product-card quick add/toggle using the existing
        list/add/check/remove endpoints; links resolve products by id because the
        API does not return slugs
  - [x] Auth flows: login, signup, email verification (server redirect),
        forgot/reset password, session hydration via `GET /api/auth/me`, token key
        `token` preserved, 401 clearing private query caches
  - [x] Route guards: `RequireAuth` redirects to `/login?next=` with the original
        path; `RequireAdmin` gates `/admin/*` and shows the 403 page for customers
  - [x] Account overview and address book: CRUD plus
        `PUT /api/addresses/:id/default`, validation mirrors the server (PIN
        `^[1-9][0-9]{5}$`, 10–15 digit phone, server field limits), editing the
        active default keeps the checkbox locked, and deletion is confirmed while
        past orders keep their address snapshot
  - [x] COD checkout: address selection, optional gift note, server-authoritative
        totals, 409 stock conflict list with per-line fixes, and legacy
        idempotency (`buyo:checkout:idempotencyKey`) reused across retries and
        cleared only after the server accepts the order
  - [x] Order confirmation, paginated order history with status filter, and order
        detail with item/tax/address snapshots and the real recorded
        `statusEvents` timeline (no invented future steps)
  - [x] Existing URL contracts preserved, including legacy `*.html` redirects
        already mapped in `routes.tsx`
  - [x] Documented API gaps instead of inventing UI: no profile-edit or
        password-change endpoint, no customer-facing order cancellation, no guest
        cart/persistence, and no resend-verification endpoint (see risks below)
  - [x] Verified: `tsc --noEmit` clean, production build succeeds, 96/96 Vitest
        tests pass (cart, wishlist, auth guards, address validation, checkout
        idempotency, conflicts, orders list/detail, protected-route 401 handling)
- [x] **Phase 5 — complete admin panel**
  - [x] Responsive admin shell: sidebar, mobile navigation drawer, sticky header,
        account menu, breadcrumbs, skip link, route-change focus, and consistent
        page headers; `/admin/*` stays behind `RequireAdmin`
  - [x] Dashboard backed entirely by existing endpoints: catalog, category and
        order totals, status breakdown, non-cancelled COD value, recent orders,
        low-stock list and out-of-stock count. Page-through collection is capped
        at 2,500 products / 5,000 orders and every capped figure is labelled; no
        analytics endpoint or invented metric was added
  - [x] Product list with URL-driven search, category, stock, price, sort and
        server pagination; desktop table and mobile cards; delete confirmation
        and explicit empty/error/forbidden/loading states
  - [x] Product create/edit forms mirror server validation, support existing or
        free-text categories, prevent duplicate submits, map server field errors,
        and handle image URL/alt text. Hosted uploads use
        `POST /api/uploads/authorize` → signed direct PUT → object path; the app
        session header is never sent to storage
  - [x] Category CRUD dialog with GST/tax rate, client filtering (the API returns
        the complete list), product counts, and a delete warning explaining that
        linked products are unlinked but never deleted
  - [x] Admin order queue with server status filter/pagination, responsive rows,
        and detail view with real customer/address/items/tax snapshots and
        recorded `statusEvents`. Status actions mirror `ALLOWED_TRANSITIONS`
        exactly; server re-validates every transition and cancellation restocks
        in one transaction
  - [x] Legacy admin URLs redirect with ids preserved
        (`product-form.html?id=`, `order-detail.html?id=`); `token` key and API
        contracts unchanged
  - [x] Documented unsupported areas instead of inventing UI: customer
        management (no customer list/detail endpoint), free-text admin order
        search, aggregate analytics, and file replacement in local storage mode
  - [x] Verified: `tsc --noEmit` clean, production build succeeds, 143/143
        Vitest tests pass across 24 files (route guards, admin shell, dashboard,
        product and category flows, order filters/detail/transitions, upload
        authorization and failure modes, empty/error states, pagination)
- [x] **Phase 6 — local release verification and hardening**
  - [x] Full TypeScript, 143/143 Vitest, production build, secret and whitespace
        gates clean; bundle and dependency/security review recorded
  - [x] 30/30 browser checks against the production bundle: customer, auth,
        admin, error/empty states, responsive layouts, keyboard/focus, reduced
        motion, deep-route refresh, legacy redirects and console/request sweep
  - [x] Per-route document titles completed across customer, auth and error pages
  - [x] Production source maps disabled; no `.map` files shipped
  - [x] Production API inspected read-only; zero Category rows and a transient
        readiness cold start recorded honestly
  - [x] Isolated preview requirements, candidate config, cutover and rollback
        runbook written in `docs/react-phase-6-release-readiness.md`
  - [ ] **Isolated preview acceptance** — blocked pending approval for a test
        database/project and Vercel preview resources
  - [ ] **Production cutover** — deliberately unexecuted; requires explicit
        approval after preview acceptance

---

## 8. Risks / open questions

1. **Admin image replacement depends on storage mode**: hosted storage supports
   replacement through the signed-upload flow plus JSON
   `PUT /api/products/:id` with the object path. The local-storage adapter's
   update route is JSON-only, so the React admin explains the limitation and
   offers an image URL/remove instead of silently changing backend behaviour. A
   multipart update remains a separate backend change requiring approval.
2. **Cutover is atomic**: while both frontends exist, only one can own `/`.
   A separate preview Vercel project would allow browser review before cutover
   and needs approval (new project, no production impact).
3. **Session compatibility**: token key `token` is preserved; password-version
   binding and 401 semantics must match `backend/middleware/auth.js`.
4. **SEO**: per-route document titles are set; the meta description remains the
   static index description and no server rendering is planned. Route-specific
   descriptions would need prerendering or SSR.
5. **Legacy deep links**: `*.html` URLs must redirect at cutover to avoid
   breaking bookmarks and search results.
6. **Category records are unpublished**: the read-only API currently returns
   zero Category records, while published products carry legacy category names
   and `categoryId: null`. Filtering by a legacy name works, and product pages
   link to it, but the category index honestly shows an empty state. Publishing
   Category records and assigning products is an owner data decision (not changed
   in Phase 3 or 6).
7. **Single product image**: the API exposes one `image` (`imageMeta` optional)
   and no image array. The gallery component supports multiple thumbnails, but
   today renders one image plus the lightbox. Multi-image support requires a
   backend change and approval.
8. **No suggestion/facet endpoint**: search suggestions reuse
   `GET /api/products?q=&limit=5`, recent searches stay in local storage, and
   filters only use documented catalog parameters. No new endpoint was added.
9. **No profile-edit or password-change endpoint**: the account page shows the
   signed-in profile read-only and links to the existing forgot-password flow.
   Adding edit/change-password UI would require a backend contract first
   (including current-password confirmation and session invalidation rules).
10. **No customer order cancellation endpoint**: order detail renders the real
   lifecycle (`placed → confirmed → shipped → delivered`, cancelled shown when
   recorded) but exposes no cancel action. Admin-side cancellation remains the
   only supported path.
11. **No guest cart**: cart and wishlist require a token, so anonymous visitors
    get a sign-in prompt and nothing is persisted or merged after login. Guest
    carts would need a backend session/cart contract.
12. **No verification resend endpoint**: signup and login surface the server's
    unverified-account state, and verification relies on the server redirect.
    A "resend email" control is intentionally absent.
13. **No customer-management API**: the backend exposes customer data only as
    the `user` reference embedded in admin orders. There is no list, detail,
    order-history, edit, role, password or delete endpoint, so the admin panel
    does not publish a customer screen that would be read-only in name only.
14. **No aggregate analytics endpoint**: dashboard status/value figures are
    collected by walking paginated product/order endpoints. Caps keep the load
    bounded (2,500 products, 5,000 orders), and every affected card/panel says
    when it is based on a partial set. True totals would need a backend
    aggregation contract.
15. **No admin order free-text search**: `GET /api/admin/orders` supports only
    `page` and `status`. The queue documents this and does not filter the current
    page client-side, which would produce misleading results.
16. **Admin page-through cost**: a large catalog/order set can trigger many
    sequential list requests when the dashboard is first opened. TanStack Query
    caches the result for the session; a future aggregate endpoint should replace
    this approach before the caps are raised.
17. **React Router advisory**: the production dependency audit reports two
    moderate `react-router` advisories. The only user-controlled redirect input
    is constrained to a same-origin path and rejects `//` and backslashes. The
    fix is a major-version upgrade, not applied without approval.
18. **Static security headers**: the legacy HTML currently has HSTS but no CSP,
    `X-Content-Type-Options`, `X-Frame-Options` or `Referrer-Policy`. The
    candidate cutover config adds them; they must be verified in preview.
19. **Readiness cold start**: `/api/health/ready` can return a single transient
    503 while the bounded database probe warms up. Cutover monitoring should
    retry once; a sustained 503 is a real failure.
