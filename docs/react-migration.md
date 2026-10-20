# BuyO — React Migration: Audit, Architecture, and Plan

Status: **Phases 1–2 complete** (audit + React foundation/design system).
The deployed static frontend and Express API are **untouched** by this migration
until the Phase 6 cutover is explicitly approved.

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
| GET | `/products` | public | list; `page`, `limit`, `search`, `category`, `sort`; returns `pagination` |
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
break live pages, so **Phases 2–5 build and verify locally/CI only**.

Cutover (Phase 6, requires explicit approval):

1. Install frontend dependencies in CI (workspace or `npm ci --prefix frontend`).
2. Build `frontend/dist`.
3. Set Vercel build settings to publish that directory while keeping the
   existing `api/app.js` function and `/api/:path*` rewrite.
4. Add SPA fallback (`/(.*)` → `/index.html`) **after** static asset and API
   routes; keep `admin` deep links working.
5. Verify: health/readiness, catalog, auth, cart, checkout, admin order flow,
   storage upload, legacy redirects, 404, security headers.
6. Roll back by reverting `vercel.json`/build settings to the previous
   deployment (static frontend remains in git, untouched).

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
- [ ] **Phase 4 — cart, wishlist, accounts, addresses, checkout, orders**
- [ ] **Phase 5 — complete admin panel**
- [ ] **Phase 6 — animation/a11y/security/performance hardening, E2E, cutover**

---

## 8. Risks / open questions

1. **Admin image replacement**: the backend update route is JSON-only; either
   keep create-only uploads in the React admin or approve a small multipart
   update change. Not changed without approval.
2. **Cutover is atomic**: while both frontends exist, only one can own `/`.
   A separate preview Vercel project would allow browser review before cutover
   and needs approval (new project, no production impact).
3. **Session compatibility**: token key `token` is preserved; password-version
   binding and 401 semantics must match `backend/middleware/auth.js`.
4. **SEO**: SPA metadata must be set per route; no server rendering is planned.
5. **Legacy deep links**: `*.html` URLs must redirect at cutover to avoid
   breaking bookmarks and search results.
6. **Category records are unpublished**: the read-only API currently returns
   zero Category records, while the published product carries
   `category: "Mobile"` and `categoryId: null`. Filtering by that legacy name
   works, and product pages link to it, but the category index honestly shows an
   empty state. Publishing Category records and assigning products is an owner
   data decision (not changed in Phase 3).
7. **Single product image**: the API exposes one `image` (`imageMeta` optional)
   and no image array. The gallery component supports multiple thumbnails, but
   today renders one image plus the lightbox. Multi-image support requires a
   backend change and approval.
8. **No suggestion/facet endpoint**: search suggestions reuse
   `GET /api/products?q=&limit=5`, recent searches stay in local storage, and
   filters only use documented catalog parameters. No new endpoint was added.
