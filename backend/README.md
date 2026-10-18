# BuyO Backend

Express + MySQL (Sequelize) API for the BuyO shopping PWA.

## Install

```bash
cd backend
npm install
```

## Configure

Copy `.env.example` to `.env` and fill in your MySQL, JWT and Gmail SMTP values:

```bash
cp .env.example .env
```

## Run

```bash
npm start        # production
npm run dev      # nodemon watch mode (requires nodemon: npm install -D nodemon)
```

Server listens on `PORT` (default 5000). The schema is **not** synced automatically at boot — set it up explicitly for local dev with:

```bash
npm run db:sync -- --confirm-local
```

## Tests

```bash
npm test    # regression + security suites; runs against a scratch DB (buyoDB_ph2_test)
```

## API

| Method | Route | Description |
|---|---|---|
| GET  | `/api/auth/verify?token=...` | Email verification link target |
| POST | `/api/auth/signup` | Create user + send verification email |
| POST | `/api/auth/login` | Returns JWT (requires verified email) |
| POST | `/api/auth/forgot-password` | Emails a single-use reset link (generic response) |
| POST | `/api/auth/reset-password` | Resets password via emailed token |
| GET  | `/api/auth/me` | Current user (JWT required) |
| GET  | `/api/products` | All products |
| GET  | `/api/products/:id` | Single product |
| POST | `/api/products` | Add product — **admin only** (JWT + `ADMIN_EMAILS`); multipart field `image` |
| GET  | `/api/cart` | Cart items *(stub — real logic pending)* |
| POST | `/api/cart` | Add to cart *(stub)* |
| DELETE | `/api/cart/:id` | Remove from cart *(stub)* |
| GET/POST/DELETE | `/api/wishlist`, `/api/wishlist/:id` | Wishlist *(stub)* |

`POST /api/products` body (JSON or multipart): `name`, `category`, `description`, `mrpPrice`, `sellingPrice`, optional `image` (URL) or `image` file upload. Uploaded files land in `backend/uploads/` and are served at `/uploads/<file>`.

## Security (Phase 2)

- `requireAuth` verifies the JWT and reloads the user from the DB on every request.
- `requireAdmin` authorizes via the server-side `ADMIN_EMAILS` allowlist (Phase 3 replaces this with a DB `role` column).
- Helmet security headers; CORS allowlist (local dev origins + the `FRONTEND_URL` origin + `CORS_ALLOWED_ORIGINS`).
- Rate limiting: a global API limiter plus a strict limiter on auth endpoints (see `.env.example` for overrides).
- Request validation on all write endpoints; the centralized error handler never leaks internal details for 5xx responses.
- Password reset links expire after 30 minutes and are single-use (bound to the current password hash); reset responses are enumeration-safe.
