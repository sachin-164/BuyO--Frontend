# BuyO — Phase 6 React Migration Release Readiness

Status: **local release verification complete; isolated preview and production
cutover are not executed.** The production site is still the legacy static
frontend. Nothing in this document has been applied to Vercel, its environment
variables, DNS, the database, or customer/order data.

Starting point: branch `react-migration` at `e39311f` (`feat(phase-5): complete
React admin panel`), with `master` and `origin/master` at `b6500cc`. The Phase 6
verification commit records the hardening and this document.

Production baseline inspected read-only:

- Vercel project `sani-9088/buyo-project`
  (`prj_UiWrLDywhlKbhJhBIknBfSKimail`), production alias
  `https://buyo-project-ten.vercel.app`.
- Current production deployment: `dpl_BN2josM1NmGwmuuvcjsyFr9KDMBJ`, created
  2026-10-20 10:17:11 UTC.
- Existing branch preview is the **legacy** static site, not this React build;
  `/shop` and `/admin` return 404 there and `/api/health/ready` returns 503
  because Preview has no database configuration. Do not point it at production
  data.

---

## 1. Guardrails used for this verification

- No merge to `master`, no production deployment, no Vercel/Supabase setting
  changes, no DNS changes, no schema or migration changes.
- No production customer, order, product, category or upload data was created,
  modified or deleted. All browser writes went to an in-memory test API.
- The temporary browser harness and screenshots live outside the repository in
  `%TEMP%\buyo-e2e`; they are not shipped and add no dependency to the app.
- `opencode.json` is intentionally untracked and was not added or modified.

---

## 2. Quality gates

Executed on 2026-10-21 from `frontend/` unless noted.

| Gate | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **PASS**, no diagnostics |
| `npm test -- --run` | **PASS**, 143/143 tests across 24 files |
| `npm run build` | **PASS** |
| Production bundle | 78 JS files, 827,908 bytes total; 1 CSS file, 39,775 bytes; largest bundle `index-CEjE8VNW.js`, 484,318 bytes (154.41 kB gzip); dist total 868,388 bytes |
| Source maps | **Disabled** in `frontend/vite.config.ts`; 0 `.map` files in `dist` |
| Secret scan | **PASS** for tracked source and `frontend/dist`; only documented placeholders in `backend/.env.example` and mock values in backend tests were found |
| `git diff --check` | **PASS**, no whitespace errors |
| Frontend production audit | 2 moderate (`react-router`, `react-router-dom`); 0 critical/high |
| Frontend full audit | 15 total: 2 critical, 6 high, 7 moderate, all in dev tooling (`vite`, `vitest`, `tinypool`, `esbuild`, `tailwindcss`) |
| Root production audit | 2 moderate (`sequelize`, `uuid`); 0 critical/high |

No dependency was upgraded. The React Router advisory is recorded as an accepted
release risk in section 8; the app's only redirect input (`next`) is constrained
to a same-origin path, rejects `//` and backslashes, and no untrusted external
navigation target is accepted.

Read-only production API probes:

| Probe | Result |
|---|---|
| `GET /api/health` | 200 |
| `GET /api/health/ready` | One cold-start 503, then 6/6 consecutive 200s (0.57–1.92 s) |
| `GET /api/products?limit=1` | 200; 4 products total; shape matches the React catalog contract |
| `GET /api/categories` | 200; **0 Category rows** |
| `GET /api/orders` without a token | 401 |
| `GET /api/admin/orders` without a token | 401 |

The transient readiness 503 is the bounded 2-second database probe losing a
cold connection, not a sustained outage: catalog requests and all six repeat
probes succeeded immediately afterwards. Cutover monitoring must tolerate one
retry on the first readiness request.

Production HTML currently receives HSTS from Vercel but **not**
`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` or
`Referrer-Policy`. Those headers are part of the prepared cutover config, not a
production change made now.

---

## 3. Browser acceptance results

Environment:

- Production build served from `frontend/dist` by an isolated local server.
- System Chrome `155.0.8059.86` driven by a temporary `playwright-core` install.
- In-memory API that mirrors the documented response contracts, including real
  product shape, auth guards, cart/wishlist, address CRUD, COD idempotency,
  admin CRUD, signed-upload flow, empty/error states and failure injection.
- Viewports 390, 768 and 1440; reduced-motion emulation; keyboard traversal.

Result: **30/30 PASS, 0 FAIL**. No browser check was run against the production
backend or production data.

| # | Critical journey | Result | Evidence |
|---|---|---|---|
| 1 | Homepage, catalog, categories, images | PASS | Real bundle, no console errors, images settled |
| 2 | Catalog search, filters, sort, pagination, back/forward | PASS | URL restored, 12 results per page, history safe |
| 3 | Product detail, stock states, related products, 404 | PASS | In stock, only 3 left, out of stock and missing product |
| 4 | Guest protected-route redirect and return-to | PASS | `/cart` redirected to login, returned after login |
| 5 | Cart add, update, remove, reload persistence | PASS | Optimistic update and server totals |
| 6 | Wishlist toggle and removal | PASS | Product page and wishlist page |
| 7 | Address create, edit, default, delete | PASS | Deleted card detached from the list |
| 8 | COD checkout double-submit and confirmation | PASS | One server order; timeline and confirmation verified |
| 9 | Order history, status filter, detail | PASS | Timeline/address snapshots |
| 10 | Empty catalog and order history | PASS | Honest empty states, no invented data |
| 11 | Production-like zero-category data | PASS | Home, categories and `?category=Shoes` remain usable |
| 12 | Per-route document titles | PASS | 14 customer, auth, error and admin routes |
| 13 | Invalid login/signup/verification/forgot/reset | PASS | Server errors and neutral email responses |
| 14 | Admin dashboard, guards, direct API denial | PASS | Real figures with capped-data labels |
| 15 | Customer denied admin UI | PASS | 403 page, no admin controls |
| 16 | Admin product list filters, pagination, mobile cards | PASS | Filter, pagination and card layout |
| 17 | Admin product create, edit, 409, delete | PASS | Server field/conflict errors mapped |
| 18 | Admin image upload success and failure | PASS | Signed PUT, persisted alt metadata, failed upload creates no product |
| 19 | Admin category create, edit, safe delete | PASS | Tax edit and removal |
| 20 | Admin order filter, detail, permitted transition | PASS | Placed → confirmed → shipped, recorded events |
| 21 | Admin denial and 500/403/missing states | PASS | Explicit error states |
| 22 | Expired token and return-to | PASS | Session cleared, login prompt retained |
| 23 | Legacy `.html` redirects and query preservation | PASS | Direct entry and preserved ids/search |
| 24 | Responsive storefront 390/768/1440 | PASS | Grids, menu, no overflow |
| 25 | Responsive admin drawer and tables | PASS | Mobile cards, drawer navigation |
| 26 | Keyboard, dialog focus trap, reduced motion | PASS | Skip link, labels, invalid announcement |
| 27 | Admin account menu and dialog focus containment | PASS | Keyboard-only flow |
| 28 | Refresh/direct entry on nested SPA routes | PASS | Deep routes survive reload |
| 29 | Network failure on categories | PASS | Catalog remains usable |
| 30 | Console/request sweep across 13 routes | PASS | No JS errors, unexpected HTTP failures or failed requests |

Results are UI and API-contract verification, not a substitute for the real
backend preview in section 5.

### Blocked checks

| Check | Status | Reason |
|---|---|---|
| Real-backend browser E2E | **BLOCKED** | No isolated preview database/project exists |
| Isolated Vercel preview acceptance | **BLOCKED** | Creating a project/database requires explicit approval |
| Real email delivery (verification/reset) | **BLOCKED** | Preview must use `MAIL_TRANSPORT=json`; no mailbox approved |
| Real Supabase Storage upload | **BLOCKED** | No isolated bucket/project approved |
| Customer management | **BLOCKED** | No customer list/detail endpoint |
| Complete revenue/analytics totals | **BLOCKED** | No aggregate endpoint; dashboard uses capped page-throughs |
| Local-storage image replacement | **BLOCKED** | `PUT /api/products/:id` is JSON-only |
| Admin free-text order search | **BLOCKED** | API supports only `page` and `status` |
| Multi-image gallery | **BLOCKED** | API exposes one image |

No application defect remained after the browser pass. Two harness failures were
fixed in the temporary test code (a double-response bug and synchronous
client-side URL assertions). One real hardening gap was fixed in the app: pages
that did not set their own title now do.

---

## 4. Phase 6 changes in this commit

- Added `usePageTitle` to the remaining customer, auth and error pages
  (`home`, `cart`, `wishlist`, `checkout`, `addresses`, login/signup/forgot/reset/
  verify, access denied, not found, route error, coming soon).
- Disabled production source maps in `frontend/vite.config.ts`.
- Added this release-readiness record and linked it from the migration plan.

No backend, schema, API, environment-variable, dependency or production-config
change was made.

---

## 5. Isolated preview preparation (requires approval)

### 5.1 Resources that must be approved first

Preferred:

1. A dedicated Vercel **preview project** (or an explicitly approved preview
   build for this branch) that is never promoted to production.
2. A dedicated Supabase **test project and database** with disposable data.
3. A test Storage bucket (or `STORAGE_DRIVER=local` is not viable on Vercel's
   read-only filesystem; hosted storage needs its own test bucket).

Acceptable alternatives, also requiring approval:

- A separate database/schema inside the existing Supabase project with separate
  credentials, never the production database.
- A local full-stack preview on a trusted machine, using an embedded/scratch
  PostgreSQL instance, if a remote preview is not required.

Do **not** copy production `DATABASE_URL`, `PG_*`, `JWT_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY` or mailbox credentials into Preview. Do not point a
preview at production customer/order data.

### 5.2 Preview environment (names only; values entered privately)

- `NODE_ENV=production`
- `DB_DIALECT=postgres`
- `PG_HOST`, `PG_PORT`, `PG_DB`, `PG_USER`, `PG_PASS` — test database only
- `PG_SSL` — leave automatic unless the test host requires a mode
- `JWT_SECRET` — a new random test secret
- `FRONTEND_URL`, `BACKEND_URL` — the preview origin (no trailing slash)
- `TRUST_PROXY=1`
- `MAIL_TRANSPORT=json` — no real email
- `STORAGE_DRIVER=supabase` plus test `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`; or leave storage
  unconfigured and explicitly accept that uploads return 503
- `HEALTH_DB_TIMEOUT_MS` — default 2000 is acceptable; retry one cold probe
- Rate-limit overrides only if the preview test traffic needs them

No `VITE_*` variable is required for a same-origin preview.

### 5.3 Vercel preview settings

- Framework preset: **Other**
- Root directory: repository root (`.`), because `/api/app` must remain the
  serverless function
- Node.js: 24.x
- Install/build/output come from the committed candidate `vercel.json` below;
  do not duplicate conflicting settings in the dashboard
- Branch: `react-migration` or a dedicated `phase-6-preview` branch
- Disable automatic production promotion for the preview project

### 5.4 Candidate `vercel.json` for preview and later cutover

This is the **only** production configuration change proposed. It is not applied
in this commit. Validate it in the preview before using it on `master`.

```json
{
  "installCommand": "npm ci --omit=dev && npm ci --prefix frontend --include=dev",
  "buildCommand": "npm run build --prefix frontend",
  "outputDirectory": "frontend/dist",
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/app" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https://*.supabase.co; upgrade-insecure-requests"
        }
      ]
    }
  ]
}
```

Preview checks for this config:

- `/assets/*.js` and `/assets/*.css` are served as files, not rewritten to HTML.
- `/api/health` and `/api/health/ready` still reach `api/app`.
- `/shop`, `/product/<slug>`, `/admin/orders/9001` and `/orders/9001` serve the
  SPA on direct load and reload.
- HTML/JS/CSS carry the five security headers; no `.map` files are published.
- External product images and direct Supabase uploads satisfy the CSP. If a
  custom storage domain or image host is used, extend `connect-src`/`img-src`
  before cutover; do not weaken `script-src`.
- `X-Frame-Options: DENY` does not break any owner-approved embedding (the
  storefront and admin are not designed to be framed).

### 5.5 Preview acceptance checklist

Run after approval, against the real preview API and test database:

1. Health/readiness (retry one cold 503), products, product detail, categories
   and search with real test data.
2. Signup/verify/login/forgot/reset using `MAIL_TRANSPORT=json`; capture the
   dry-run message from logs, never a real inbox.
3. Customer: create disposable address, add to cart, wishlist, place one COD
   order, view confirmation/history/detail.
4. Admin: create/edit/delete a disposable product and category; upload an image;
   confirm alt metadata; transition the test order through allowed statuses.
5. Authorization: no-token and customer-token admin requests must be rejected by
   the API; expired token must sign out with return-to preserved.
6. Legacy `.html` redirects, direct/deep refresh, 404, 390/768/1440 layouts,
   reduced motion and keyboard focus.
7. Browser console/network sweep, response headers, no source maps.
8. Clean up the disposable test records or destroy the test database. Do not
   leave test credentials or data in a shared environment.

Record PASS/FAIL/BLOCKED for each. Cutover is not allowed with an unresolved
FAIL or a BLOCKED critical journey.

---

## 6. Production cutover plan (prepared, not executed)

Preconditions: explicit owner approval; preview acceptance complete; no open
critical defect; production deployment ID and database backup policy confirmed.

1. **Freeze the target.** Confirm `master` is `b6500cc`, production is
   `dpl_BN2josM1NmGwmuuvcjsyFr9KDMBJ`, and the working tree is clean except for
   intentionally untracked files.
2. **Merge the verified app.** Merge `react-migration` into `master` without
   force-pushing. Do not apply the candidate `vercel.json` in the merge commit:
   the merge alone must still deploy the legacy static site and leave `/`,
   `/api` and sessions unchanged.
3. **Apply the cutover config as its own commit.** Replace `vercel.json` with the
   candidate from section 5.4, validate JSON, and commit it separately so a
   rollback can revert exactly one commit.
4. **Deploy through the normal production branch.** Push `master`; watch the
   build log. Confirm the frontend install/build steps ran and the output is
   `frontend/dist`. Do not change production env vars, DNS, database or storage.
5. **Smoke test immediately** using `curl.exe` and a browser:
   - `/api/health` 200; `/api/health/ready` 200 after at most one retry
   - `/`, `/shop`, `/product/<real-slug>`, `/categories`, `/login`
   - `/admin` redirects to login without a token; a real admin session loads
   - `/orders`, `/account`, `/cart` after login
   - one read-only catalog search/filter and one order detail
   - legacy `products.html?id=...` redirects
   - response headers and no source-map URLs
6. **Monitor for at least 30 minutes:** error rate, readiness, API 5xx, login
   failures, checkout failures, Vercel function logs. Do not run destructive
   production tests for acceptance.
7. **Declare success only after** smoke, headers, routing and a real authenticated
   admin/customer read-only pass. Keep the legacy deployment available.

If any gate fails, stop and execute section 7 rather than debugging on the
production alias.

---

## 7. Rollback plan

### Fast rollback (preferred)

The previous production deployment is already built and ready:

```powershell
vercel rollback dpl_BN2josM1NmGwmuuvcjsyFr9KDMBJ --yes
```

This reassigns the production alias to the legacy static deployment. It does not
touch the database, environment variables, DNS or git.

Verify:

```powershell
curl.exe -s https://buyo-project-ten.vercel.app/ | Select-String "js/config.js"
curl.exe -s -o NUL -w "%{http_code}`n" https://buyo-project-ten.vercel.app/api/health
curl.exe -s -o NUL -w "%{http_code}`n" "https://buyo-project-ten.vercel.app/api/products?limit=1"
```

The first command must find the legacy `js/config.js` reference; the API probes
must return 200. Legacy `/shop` returning 404 is expected after rollback.

### Code rollback (required if `master` should stop producing React builds)

```powershell
git revert <cutover-config-commit>
git push origin master
```

This restores the previous `vercel.json` (root static install only, `/api`
rewrite preserved) and redeploys the legacy site. The React app code may remain
in the repository; it is inert without the build/output settings. Do not force
push or rewrite `master` history.

### Data/rollback boundary

- No schema or data migration is part of this cutover, so there is nothing to
  down-migrate.
- Tokens remain valid: the `token` key and JWT secret are unchanged, and both
  frontends use the same API.
- Orders placed during the React window remain valid and readable by the legacy
  API; no order rollback is needed.
- If a data incident is ever suspected, stop and use the existing
  `docs/backup-restore.md` runbook under separate approval; do not improvise a
  restore against production.

---

## 8. Accepted risks / remaining gaps

1. **React Router advisory.** The production audit reports two moderate
   advisories (`react-router`, `react-router-dom`, including an open-redirect
   bypass). The app does not accept arbitrary external navigation targets;
   `safeNextPath` requires a same-origin path and rejects `//` and backslashes.
   The fix is a major-version upgrade and was not applied without approval. Keep
   it on the post-cutover dependency worklist.
2. **Static security headers.** The current legacy HTML has HSTS but lacks CSP,
   `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`. The
   candidate config adds them; verify in preview, and adjust CSP only for
   approved external image/storage hosts.
3. **SPA metadata.** Per-route titles are now set, but the description remains
   the static index description and there is no SSR. Search/social previews will
   not get route-specific descriptions until a server-rendered or prerendered
   solution is approved.
4. **Readiness cold start.** `/api/health/ready` can return one transient 503
   while the database probe warms up. Monitoring should retry once; a sustained
   503 is a real incident.
5. **Unpublished Category rows.** Production currently has zero Category rows
   while products carry legacy category names. The React UI handles this
   honestly; publishing records/assigning products is an owner data decision.
6. **Capped analytics.** Dashboard totals walk paginated endpoints with caps
   (2,500 products, 5,000 orders) and label partial figures. An aggregate
   endpoint is future work.
7. **Unsupported operations.** Customer management, admin free-text order
   search, local-storage image replacement and multi-image galleries remain
   blocked by absent backend contracts, as documented in
   `docs/react-migration.md`.

---

## 9. Approval needed to continue

Before any preview resource is created or production changes:

- [ ] Approve the isolated preview database/project and test Storage bucket
      (or choose the local full-stack preview alternative).
- [ ] Approve creating/using the Vercel preview project and its Preview-only
      environment values.
- [ ] Approve the candidate `vercel.json` as the cutover config.
- [ ] After preview acceptance, explicitly approve the production merge and
      cutover window.

Until those approvals, the correct state is: **verified locally, not released.**
