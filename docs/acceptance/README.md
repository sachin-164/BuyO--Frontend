# Real-browser acceptance run

`run.cjs` is the end-to-end acceptance harness used for the 34-point checklist.
It exercises the **real** stack, not mocks:

- a disposable MySQL database (`buyoDB_ph2_test`, recreated on every run — the
  dev database is never touched),
- the real Express app listening on `:5000` with `NODE_ENV=test`
  (`MAIL_TRANSPORT=json`, so verification/reset/receipt/status mail is captured
  in memory and never sent),
- the real Vite dev server on `:5173` (proxy → `:5000`),
- Google Chrome via Playwright, driving the actual React UI.

## Prerequisites

- Node 18+ and a local MySQL server matching `backend/.env`
- `backend/.env` (copy from `backend/.env.example`)
- Google Chrome installed (the harness uses `channel: "chrome"`)
- Playwright available without changing the lockfile:

```bash
npm i --no-save --no-package-lock playwright
```

## Run

```bash
node docs/acceptance/run.cjs
```

The script re-seeds admin, categories and products (multipart image upload),
then runs 30 numbered steps covering storefront, discovery, auth, account,
addresses, COD checkout, cancellation, notifications, admin analytics/orders/
customers/categories, admin browser image upload, variant-product deletion with
multiple cart lines (order snapshot/wishlist preservation), negative security
cases, responsive layout, accessibility, SEO and performance. Exit code is `0`
only when every step passes.

Artifacts:

- `docs/acceptance/out/report.json` — step results, DB/analytics checks,
  captured mail subjects, timings, console errors
- `docs/acceptance/out/*.png` — screenshots on failure (and admin/mobile
  snapshots)

`report-2026-10-24.json` in this directory is the current recorded run:
**30/30 passed** against MySQL + Express + Chrome, including the admin upload
and variant-product deletion regressions (see the checklist's acceptance
section). `report-2026-10-23.json` (29/29) and `report-2026-10-22.json` (25/25)
remain as historical runs.

## Notes

- Backend test suites and this harness both recreate `buyoDB_ph2_test`; never
  run them concurrently.
- Nothing here talks to production or to the dev database.
