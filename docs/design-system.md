# BuyO Design System (Phase 7, extended in Phases 8–9)

Shared visual foundation for the storefront and admin redesign (Phases 8–10).
**Adoption status (after Phase 9):** the shell and design system are live on
`index.html`, `categories.html`, `products.html`, `product-details.html`,
`cart.html`, `checkout.html`, `wishlist.html`, `profile.html`, the auth pages
(`login.html`, `signup.html`, `forgot-password.html`, `reset-password.html`),
and the stub pages (`about`, `contact`, `services`). No customer-facing page
uses the legacy `header.html`/`js/header.js` system anymore (the files remain
in the repo, unlinked). Font Awesome CDN remains **only** on the untouched
`demo.html` prototype and `admin/` pages (Phase 10); every redesigned page
uses inline SVG icons.

Load order for any page adopting the system:

```html
<link rel="stylesheet" href="css/tokens.css" />
<link rel="stylesheet" href="css/base.css" />
<link rel="stylesheet" href="css/components.css" />
<link rel="stylesheet" href="css/layout.css" />
...
<a class="skip-link" href="#main">Skip to content</a>
<div data-buyo-header></div>
<main id="main">...</main>
<div data-buyo-footer></div>
<script src="js/config.js"></script>
<script src="js/api.js"></script>
<script src="js/ui.js"></script>
<script src="js/layout.js"></script>
```

## 1. Fonts

No font files exist in this repository (verified: no `.woff2/.woff/.ttf/.otf`
outside `node_modules`), so there are **no `@font-face` rules and no external
font requests**. Tokens define stacks instead:

| Token              | Stack                                             | Use |
|--------------------|---------------------------------------------------|-----|
| `--font-ui`        | `"Inter", system-ui, -apple-system, "Segoe UI", …` | All UI text. Uses Inter when installed locally, else the system stack. |
| `--font-display`   | `Georgia, "Iowan Old Style", "Times New Roman", serif` | Headings, wordmark, display accents (editorial feel per the design direction). |

To self-host real fonts later: put the files in `assets/fonts/`, add
`@font-face` declarations at the top of `css/tokens.css`, and the stacks pick
them up automatically — nothing else changes. No CDN dependency will be added
without explicit approval.

## 2. Design tokens (`css/tokens.css`)

Approved palette:

| Token | Value | Meaning |
|-------|-------|---------|
| `--color-brand` | `#064E4A` | Dark teal — primary actions, footer, links |
| `--color-brand-strong` | `#033B38` | Deep teal — hover/active states |
| `--color-accent` | `#F59E0B` | Orange — highlights, discount badges, accents |
| `--color-accent-strong` | `#D97706` | Accent hover |
| `--color-bg` | `#F7F7F5` | Warm page background |
| `--color-surface` | `#FFFFFF` | Cards, header, inputs |
| `--color-text` | `#171717` | Primary text |
| `--color-text-muted` | `#737373` | Secondary text |
| `--color-border` | `#E5E5E5` | Dividers, input borders |

Semantic feedback colors: `--color-danger` (`#B91C1C`), `--color-success`
(`#15803D`), `--color-on-brand` (white), `--color-on-accent` (`#171717`).

**Contrast rules (WCAG AA):**
- White text on `--color-brand` teal ≈ 9.9:1 ✓.
- `--color-text-muted` on `--color-bg` ≈ 4.6:1 ✓ (normal text AA).
- Orange `--color-accent` is **never used as small text on white** (≈2:1 ✗);
  orange surfaces always carry `--color-on-accent` dark text (≈7:1 ✓).
- The footer lightens link colors to ~78–88% white on teal — all ≥ 4.5:1.

Other token groups: spacing (4px base: `--space-1…16`), type scale
(`--text-xs…5xl`, weights `--weight-regular…extrabold`, `--leading-*`),
radii (`--radius-sm…xl`, `--radius-full`), shadows (`--shadow-sm/md/lg`),
z-index (`--z-base/header/dropdown/drawer/modal/toast`), motion
(`--duration-fast/base/slow`, `--ease-standard`), layout
(`--container-max: 1200px`, `--header-height: 64px`).

Dark theme is deferred: the token file is structured so a
`prefers-color-scheme: dark` block can override only the color tokens.

## 3. Base layer (`css/base.css`)

- Minimal reset (box-sizing, media defaults, inherited form fonts).
- `:focus-visible` → 2px brand ring with 2px offset (visible on light *and*
  teal surfaces); mouse clicks don't ring.
- `.skip-link` — first tab stop, hidden until focused, jumps to `#main`.
- `.visually-hidden` utility for screen-reader-only text.
- Global `prefers-reduced-motion: reduce` kill-switch for all
  animations/transitions (hover lifts, shimmer, drawer slide, toasts).
- `::selection` in brand teal.
- `.buyo-container` (max-width 1200px + padding) and `.buyo-page` (vertical
  rhythm) layout helpers.

## 4. Components (`css/components.css`)

All classes are `ui-`-prefixed to coexist with legacy page styles.

| Component | Classes | Notes |
|-----------|---------|-------|
| Button | `.ui-btn` + `--primary/--secondary/--accent/--ghost`, `--sm`, `--block` | Busy state: `aria-busy="true"` + `disabled` shows a spinner, keeps width. |
| Form field | `.ui-field`, `.ui-label`, `.ui-input` (`--sm`), `.ui-error` | Set `aria-invalid="true"` on invalid inputs; errors are plain text nodes. |
| Badge | `.ui-badge` + `--brand/--accent/--success/--danger` | Pill shape; used for discounts, stock status. |
| Product card | `.ui-product-card` (+ `__media/__fallback/__discount/__body/__category/__name/__price-row/__price/__mrp`) | Entire card is one `<a>` to `product-details.html?id=…`. Falls back to a letter tile when there is no image. Discount badge + struck MRP only when `mrpPrice > sellingPrice`. |
| Product grid | `.ui-product-grid` | Auto-fill 220px columns; 2 columns below 768px. |
| Skeleton | `.ui-skeleton`, `.ui-skeleton-card` | Loading placeholders; shimmer is removed under reduced motion. |
| Empty/error state | `.ui-empty`, `__icon/__title/__text` | Centered block; slot for one action button. |
| Toast | `.ui-toast` + `--success/--error`, region `.ui-toast-region` | Created by JS (below). Fixed bottom-right; full width under 768px. |
| Modal / drawer | `.ui-modal` (+ `--drawer`), `__overlay/__dialog/__title/__close` | Hidden by default; `[data-ui-modal-close]` closes; ESC + focus trap handled by JS. |
| Hero | `.ui-hero` (+ `__eyebrow/__title/__text/__actions/__art`) | Homepage brand statement on a teal gradient; decorative CSS artwork is `aria-hidden`. Buttons use `.ui-btn--accent` / `.ui-btn--on-teal`-style variants. |
| Category chips | `.ui-chips`, `.ui-chip` (+ `__count`), `[aria-pressed]` | Links (home) or filter buttons (categories page); selected state is teal. |
| Section head | `.ui-section`, `.ui-section-head`, `.ui-section-title`, `.ui-section-link` | Standard "title + View all" pattern above product grids. |
| Breadcrumb | `.ui-breadcrumb` | Product detail pages; muted links, `/` separators. |
| Product detail | `.ui-detail` (+ `__media/__fallback/__discount/__category/__name/__price-row/__price/__mrp/__stock/__description/__actions/__auth-note`) | Two columns ≥1024px, stacked below; letter-tile fallback when no image. |
| Footer social | `.buyo-footer__social`, `.buyo-footer__social-link` | Real owner profiles preserved from the legacy footer; inline SVG icons, `rel="noopener noreferrer"`. |
| Steps | `.ui-steps`, `--circles`, `__item/__num/__connector` | Numbered progress indicators (cart → checkout → completed). Static indicators (not links) when steps aren't navigable; completed steps show a ✓. |
| Cart line | `.ui-cart-layout`, `.ui-cart-lines`, `.ui-cart-line` (+ `__media/__name/__price/__unit/__note/__remove`), `.ui-qty` + `.ui-qty-btn` | Server-cart rows; qty capped at `min(99, stock)` client-side; stock/`unavailable` flags surface as `.ui-badge--warning/--neutral`. |
| Summary card | `.ui-summary` (+ `__title/__row/__total/__cta/__notice`) | Totals panel with an honest "preview only" notice for tax. |
| Checkout | `.ui-checkout-layout/__panel/__panel-title/__back/__steps`, `.ui-checkout-items/__item(+__media/__name/__meta/__price)` | Two-panel layout (review left, steps + form right); stacks below 1024px. |
| Address card | `.ui-address-card` (+ `__name/__text/__badges/__actions`), `.ui-address-list` (radio cards), `.ui-address-grid` | Selection cards on checkout; CRUD cards (edit/set default/two-step delete) on the profile. |
| Payment method | `.ui-method-tile` (+ `__icon/__title/__text)` | Single-tile method row; COD-only until a real gateway lands. |
| Confirmation | `.ui-done` (+ `__mark/__title/__text/__meta/__actions`) | Order-placed panel with real order number/total. |
| Auth pages | `.ui-auth` (+ `__back/__title/__sub/__aside/__foot`), `.ui-input-wrap`, `.ui-input-toggle`, `.ui-form-alert` (+ `--success`) | Centered headerless column (reference login.png): eye toggle for passwords, `role="alert"` message region. |
| Account area | `.ui-account` (+ `__nav/__nav-item/--danger/__panel/__panel-head/__title`), `.ui-profile-card` (+ `__avatar/__name/__email/__meta`), `.ui-profile-stats`, `.ui-stat-card` (+ `__value/__label`) | Sidebar-tab account layout (reference profile.png); stat tiles show only real API counts. |
| Order card | `.ui-order-card` (+ `__head/__number/__date/__grid/__items/__detail`), `.ui-timeline` (+ `__time`) | Order history rows; delivery address + status timeline lazy-load from `GET /api/orders/:id`. |
| Wishlist extras | `.ui-wish-item/__actions`, `.ui-wish-gone` (+ `__name/__text`) | Product card + Remove row; dashed card for products deleted from the catalog. |

### JS helpers (`js/ui.js` → `window.BuyOUi`)

```js
BuyOUi.toast("Saved", { type: "success" });        // "info" | "success" | "error"
BuyOUi.openModal(modalEl);                          // trap + ESC + restore focus
BuyOUi.closeModal(modalEl);
BuyOUi.isModalOpen(modalEl);
```

Modal markup contract:

```html
<div class="ui-modal" data-ui-modal hidden>
  <div class="ui-modal__overlay" data-ui-modal-close></div>
  <div class="ui-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
    <h2 id="dlg-title" class="ui-modal__title">Title</h2>
    <button class="ui-modal__close" data-ui-modal-close aria-label="Close">✕</button>
    ...
  </div>
</div>
```

All toasts use `role="status"` + `aria-live="polite"` and are announced without
stealing focus.

### Catalog helpers (`js/catalog.js` → `window.BuyOCatalog`)

Shared by the homepage, categories, and products pages so product cards look
identical everywhere:

```js
BuyOCatalog.productCard(product)   // anchor card -> product-details.html?id=…
BuyOCatalog.skeletonCards(8)       // loading placeholders
BuyOCatalog.emptyState({ title, text, icon?, action? })
BuyOCatalog.formatPrice(value)     // ₹ + en-IN grouping
BuyOCatalog.discountPercent(mrp, selling) // derived, never stored
BuyOCatalog.safeImageUrl(value)    // only /uploads/… or http(s):// pass
BuyOCatalog.esc(value)             // HTML escaping for API strings
```

## 5. Layout shell (`css/layout.css` + `js/layout.js`)

Rendered by `js/layout.js` into `[data-buyo-header]` / `[data-buyo-footer]`.

- **Header** (sticky, white, teal wordmark `buyo!`): search form
  (`role="search"`), desktop nav (Home / Products / Categories with
  `aria-current="page"`), icon links to cart + wishlist, account control,
  hamburger below 1024px.
- **Search** submits `GET products.html?q=…` — the products page queries the
  real public API (`GET /api/products?q=…`). Empty query → all products.
- **Account control** reflects the **real** session: token present →
  `GET /api/auth/me`; on success shows “Hi, ⟨first name⟩” with *My profile* /
  *Sign out*; on 401 the API client clears the session (see §6) and the menu
  flips to *Login* / *Create account* in place — **no redirect loops**.
- **Cart/wishlist icons carry real count badges** (Phase 9): on every load with
  a session, `GET /api/cart` + `GET /api/wishlist` fill the badge counters
  (hidden at 0, `99+` cap, `aria-label` gains “, N items”); pages announce
  mutations with `buyo:cart-updated` / `buyo:wishlist-updated` and the header
  refreshes the matching count (sequential-id guard so a slow response can't
  overwrite a newer one). Guests and cleared sessions show no badges.
- **Mobile drawer**: hidden panel opened by the hamburger; `role="dialog"`,
  `aria-modal`, ESC/overlay closes, focus moves in and returns to the button,
  Tab is trapped, auto-closes when resizing to ≥1024px (desktop nav returns).
- **Footer** (teal): brand blurb + links that all point to existing pages with
  real content (stub pages like about/services/contact are deliberately not
  linked). Light focus ring on teal via `.buyo-footer a:focus-visible`.
- Icons are **inline SVG** — no icon-font/CDN dependency in the shell.

## 6. API client (`js/api.js` → `window.BuyOApi`)

Single fetch wrapper for all new code. After Phase 9 every flow uses it —
`login.js`, `signup.js`, `forgot-password.js`, `reset-password.js`, `cart.js`,
`checkout.js`, `profile.js`, `wishlist.js` included (no page carries its own
inline `fetch` anymore; `product-details.js` rewired in P8).

```js
const res = await BuyOApi.get("/products?q=laptop", { auth: "never" });
// res => { ok, status, data, message, timedOut? }   — never throws
await BuyOApi.post("/auth/login", { email, password });
BuyOApi.getToken(); BuyOApi.clearSession(); BuyOApi.signOut();
```

- Base URL from `CONFIG.API_URL` (`js/config.js`).
- 10s default timeout via `AbortController` (`timedOut: true` on expiry).
- Parses JSON defensively (non-JSON bodies → `data: null`); surfaces the
  server's `message` or first validation error in `res.message`.
- Attaches `Authorization: Bearer <token>` from `localStorage.token` when a
  token exists (`auth: "never"` opts out for public endpoints).
- **401 policy:** the session (`token` + legacy `isLoggedIn`) is cleared only
  when a request that actually sent a token gets a 401, then
  `buyo:session-cleared` is dispatched. No automatic redirects anywhere.
  `signOut()` clears the session and dispatches `buyo:signed-out`.
- CORS: the backend must allow the page origin (`CORS_URLS` env);
  `http://127.0.0.1:5503` and `http://localhost:5503` are already allowed.

## 7. Breakpoints

| Width | Behaviour |
|-------|-----------|
| ≥ 1024px | Full desktop header: logo + search + nav links + icons; footer 3 columns. |
| < 1024px | Compact header: logo + icons + hamburger; search on its own row; nav + account in the drawer; account shows icon only. |
| < 768px  | Product grid → 2 columns; footer stacks to 1 column; toasts go full-width. |

## 8. Accessibility conventions

1. Every page with the shell starts with a **skip link** and one `<main id="main">`.
2. Landmarks: `<header>`, `<nav aria-label="…">`, `<main>`, `<footer>`; search
   is a `<form role="search">` with a real `<label>` (visually hidden).
3. Interactive controls are native `<button>`/`<a>` elements with accessible
   names (icon-only controls use `aria-label`).
4. Focus is always visible (`:focus-visible`); dialogs/drawers trap Tab and
   restore focus to the opener on close.
5. State changes use `aria-expanded`, `aria-current`, `aria-invalid`,
   `aria-busy`; live feedback uses polite live regions.
6. `prefers-reduced-motion: reduce` disables all animation globally.
7. User-provided strings (product names, search terms) are HTML-escaped before
   insertion (`esc()` in `js/products.js` / `js/layout.js`).

## 9. Manual verification checklist

Run after any change to the design system or shell:

1. **Load** — `cd backend && npm start` (port 5000) and
   `python -m http.server 5503 --bind 127.0.0.1` from the repo root; open
   `http://127.0.0.1:5503/products.html`.
2. **Console** — DevTools console shows no errors; Network tab shows one
   successful `GET /api/products?…` (status 200, JSON) after load.
3. **Search** — type a term in the header, press Enter/“Search”: URL becomes
   `products.html?q=…`, results heading shows the term, the API request
   carries `q=…`. Empty search returns to `products.html`.
4. **Widths 360 / 768 / 1280** — header stays usable; below 1024px the
   hamburger appears and search moves to its own row; the grid shows 2
   columns below 768px; nothing overflows horizontally.
5. **Keyboard** — first Tab = skip link (visible on focus); every control
   reachable with a visible ring; drawer: ESC closes and focus returns to the
   hamburger; account menu: ESC/outside-click closes.
6. **Reduced motion** — with OS “reduce motion” on, skeleton shimmer/hover
   lifts/drawer slide don’t animate.
7. **Auth states** — logged out: menu shows Login/Create account. Log in via
   `login.html`: header shows “Hi, ⟨name⟩” after `GET /api/auth/me` succeeds.
   Delete the token in DevTools → any authed call flips the menu back to
   Login with an “expired” toast, no redirect loop.
8. **No stale legacy pages** — every customer-facing page loads the shared
   shell with no new console errors; only `demo.html` and `admin/` still
   reference Font Awesome (Phase 10 + untouched prototype).

## 10. Reference-driven design mapping

Every redesigned page is built from its `design-references/` screenshot
before styling: identify the reference → implement → capture local desktop +
mobile screenshots → compare → correct → report remaining deviations.

| Page | Reference | Notes / deviations |
|------|-----------|--------------------|
| `index.html` | `Home_page` screenshot (P8) | Hero + sections + chips. |
| `categories.html` / `products.html` | `categories.png` (P8) | Filter rail + grid. |
| `product-details.html` | `product_view.png` (P8) | Media + buy panel. |
| `cart.html` | `cart.png` | Plain stepper, line cards, summary; no coupon row (no coupon feature), no strikethrough MRP (API lacks it → “₹X each”). |
| `checkout.html` | `checkout.png` | 3-step circles, address radio cards, COD tile; keeps the BuyO site shell (reference is a standalone checkout header); no discount/credit rows. |
| `login.html` | `login.png` | Headerless centered column, eye toggle; no Google button and no Remember-me (no backend support — omitted, not faked). |
| `signup.html` | `login.png` mirrored | No dedicated signup reference exists (reported). |
| `forgot-password.html` / `reset-password.html` | `login.png` auth-card style | Required by the backend’s reset emails (`reset-password.html?token=…`). |
| `profile.html` | `profile.png` | Sidebar tabs + identity card + real stat tiles; reference’s Dashboard/Statistics/Reviews/Charts omitted (no such data — not faked). |
| `wishlist.html` | *(none)* | BuyO product-card system on the shell; stated as a deviation. |

### Phase 10 — admin area (`admin_page.webp`)

The admin area is a separate app (`admin/`, `body.adm`) sharing the same
tokens/components. Every page is gated by `admin/js/shell.js`, which re-checks
`GET /api/auth/me` and renders chrome only when the **database** reports
`{ isVerified: true, isAdmin: true }` (the server's `requireAdmin` remains the
real wall). All statistics are computed from live API rows — nothing is
fabricated.

| Admin page | Reference | Notes / deviations |
|------------|-----------|--------------------|
| App shell (`admin/css/admin.css` + `admin/js/shell.js`) | `admin_page.webp` chrome | Floating white app card, icon sidebar (Dashboard, expandable Products group → Product List/Categories, Orders, Log out), top bar with off-canvas drawer below 1024px. Reference's purple accent → BuyO dark teal; reference's bell/notifications, Customers, Analytics, Settings nav items **omitted** (no backend endpoints — would be fake controls). Reference avatar photo → initial-letter avatar (no uploads for admins). |
| `dashboard.html` | `admin_page.webp` (content card + stat tiles) | Real stats only: Orders, Order value (non-cancelled gross; COD note), Products, Out of stock, Categories + Recent orders table. Reference's Sales chart and customer/revenue analytics **omitted** (no analytics endpoint) — no chart is faked. |
| `products.html` | `admin_page.webp` list page (primary) | Zebra table with thumbnails + name/slug, Price (+ struck MRP), Stock, In/Out-of-stock badges, Edit + two-step trash; Filter bar (category/availability/price — all real server query params) + Add Product; `Previous / pages / Next` footer. "Sales" column → "Orders" naming elsewhere; reference checkbox/bulk-action column **omitted** (no bulk API); Category/Stock/Status headers are not sortable (API only sorts name/price — no fake affordances); reference "See All" → Clear filters. |
| `product-form.html` (add/edit) | *(none — no form reference)* | Replaces the old never-wired `admin/add-product.html` (legacy file kept, unlinked). Create offers multipart upload (5 MB, image/*) or image URL; edit is URL-only + Remove image (the PUT API accepts URLs — documented API gap, upload-on-edit is future work). Client validation mirrors server rules; server 400 field errors map back onto inputs. |
| `categories.html` | `admin_page.webp` table styling | Real CRUD via modal (BuyO `.ui-modal` + focus trap); GST % column and delete warning state the server's real behaviour (`affectedProducts` reported in the success toast). |
| `orders.html` | `admin_page.webp` list page | Real rows (order number, customer, date/time, items, total, status badge) + server-backed status filter chips. Pagination is computed from de-duplicated fetched rows because the admin orders `pagination.total` counts joined item rows (backend finding P10-1 — page compensates, no backend change this phase). |
| `order-detail.html` | *(none — no detail reference)* | Items + totals, customer/delivery snapshot, status timeline, and **only** the transition buttons the server's `ALLOWED_TRANSITIONS` permits (server re-validates; 409 refreshes the view). Cancel requires a second confirming click. |
| Gate / denied states | *(none)* | No token / expired session → sign-in card (`?next=admin/…`, same-origin whitelist); valid customer or unverified account → access-denied card. No nav or data is rendered for non-admins. |

Shared adaptations: `.ui-badge` soft-fill variants replace the reference's
outline badges (reuses the approved badge system); `.ui-btn--danger` was added
scoped to `body.adm` for destructive actions; admin tables reuse the shared
`.adm-table` with a 720px desktop floor and horizontal scroll below it.
Font Awesome appears on **no** new admin page (all icons are inline SVG); the
legacy `admin/add-product.html` keeps its old markup untouched.

