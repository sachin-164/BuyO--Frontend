# Guest cart & login-merge design (Phase 5)

Status: **design only** — no guest-token system exists and none is needed.
Nothing here is implemented; the merge endpoint lands in Phase 9 when the
cart UI and auth flow come together.

## What exists today

- The legacy storefront keeps the cart entirely in `localStorage` (`js/cart.js`
  reads/writes a `cart` array; `js/product-details.js` posts to `/api/cart`).
- The `cartitems` table has a nullable `productId` column (the original model
  comment: "allows guest items seeded from localStorage"). That was never
  wired up — cart routes were stubs until Phase 5.
- Phase 5 made the cart **authenticated-only**: every route requires a JWT and
  is scoped to `UserId`. Guests get `401`.

## Why no guest-token system (and no schema change)

Requirements say to design for the future login-merge flow *without* adding a
custom guest-token system or schema changes unless justified. Neither is
necessary:

1. **The guest cart already has a home.** The browser's `localStorage` cart is
   the guest-side source of truth (unchanged behavior). A server-side guest
   cart would duplicate state, require guest tokens, expiry/garbage
   collection, and an anonymous identity model — none of which the current
   product needs.
2. **Merge = replayed upserts.** After login the client can simply send its
   guest items (`[{ productId, qty }]`) to a future `POST /api/cart/merge`
   endpoint. The server runs the same transactional upsert used by
   `POST /api/cart` (user-row lock + stock validation + merge/inc), which is
   already duplicate-safe. The existing schema handles this as-is: one row
   per user+product via the upsert logic — no new columns or tokens.
3. **Wishlist merges by the same rule** (add-if-absent per productId).

## Planned merge contract (Phase 9)

```
POST /api/cart/merge            (auth required)
body: { items: [{ productId: integer, qty: 1..99 }, ...] }   // max ~50 items
-> 200 { success, merged, skipped: [{ productId, reason }] }
```

- Per item: existing line → qty incremented (capped by stock); new product →
  line created; missing/out-of-stock product → skipped with a safe reason.
- The whole merge runs under one transaction with the same user-row lock, so
  it cannot race with concurrent adds or create duplicate rows.
- The client clears its localStorage guest cart only after a successful merge
  response.

## Deferred hardening (schema changes allowed again, e.g. Phase 11+)

- Add a composite unique index on `cartitems (UserId, productId)` and
  `wishlistitems (UserId, productId)` as a database-level backstop to the
  transactional dedup (see `controllers/cartController.js` design notes).
