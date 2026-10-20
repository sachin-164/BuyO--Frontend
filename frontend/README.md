# BuyO React frontend

React + TypeScript + Vite migration of the BuyO storefront and admin panel.
**Phase 2 (foundation + design system) is complete; later phases are tracked in
[`docs/react-migration.md`](../docs/react-migration.md).**

This app is isolated from the currently deployed static frontend. It is **not**
wired into Vercel yet; production stays on the legacy pages until the Phase 6
cutover is approved.

## Commands

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api to http://localhost:5000
npm run build      # typecheck + production build into dist/
npm run typecheck
npm test           # Vitest + Testing Library
npm run preview    # preview the production build
```

Start the Express API separately (`cd backend && npm run dev`) for live data.

## Environment

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Optional. Empty means same-origin `/api` (production default). Only public values; never put secrets in `VITE_*`. |

The dev server proxies `/api` to `http://localhost:5000`, so no variable is
needed locally.

## Structure

```
src/
  components/ui/       design-system primitives (CVA + Tailwind tokens)
  components/layout/   storefront header, footer, shell
  components/product/  product card
  components/feedback/ error boundary
  features/catalog/    TanStack Query hooks for catalog data
  lib/                 API client, query client, formatting, motion, utils
  pages/               route pages (foundation + honest phase placeholders)
  test/                Vitest setup
  routes.tsx           route map, lazy loading, legacy redirects
```

## Security notes

- The browser only talks to the same-origin `/api`; authorization stays in
  Express (`requireAuth` / `requireAdmin`).
- The session token is stored under the existing `token` key so sessions survive
  the cutover; no password or service-role key is ever stored client-side.
- A token-bearing `401` emits one `buyo:unauthorized` event; the future auth
  provider clears the session from that single signal.
- Admin routes in the SPA are a convenience only. Every admin endpoint is
  already protected server-side.
