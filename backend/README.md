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
npm run dev      # nodemon watch mode
```

Server listens on `PORT` (default 5000). Tables are created/altered automatically on startup (`sequelize.sync({ alter: true })`).

## API

| Method | Route | Description |
|---|---|---|
| GET  | `/api/auth/verify?token=...` | Email verification link target |
| POST | `/api/auth/signup` | Create user + send verification email |
| POST | `/api/auth/login` | Returns JWT (requires verified email) |
| GET  | `/api/products` | All products |
| GET  | `/api/products/:id` | Single product |
| POST | `/api/products` | Add product (multipart field `image`) |
| GET  | `/api/cart` | Cart items *(stub — real logic pending)* |
| POST | `/api/cart` | Add to cart *(stub)* |
| DELETE | `/api/cart/:id` | Remove from cart *(stub)* |
| GET/POST/DELETE | `/api/wishlist`, `/api/wishlist/:id` | Wishlist *(stub)* |

`POST /api/products` body (JSON or multipart): `name`, `category`, `description`, `mrpPrice`, `sellingPrice`, optional `image` (URL) or `image` file upload. Uploaded files land in `backend/uploads/` and are served at `/uploads/<file>`.
