// app.js
// Express application (middleware + routes). Kept separate from server.js so
// tests (and future serverless deployments) can boot the app without listening.

const express = require("express");
const path = require("path");
const { securityHeaders, corsMiddleware } = require("./middleware/security");
const { globalLimiter } = require("./middleware/rateLimiters");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/authRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");

function createApp() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required (see backend/.env.example)");
  }

  const app = express();

  // Security headers + CORS allowlist
  app.use(securityHeaders());
  app.use(corsMiddleware());

  // Body parsing (bounded)
  app.use(express.json({ limit: "100kb" }));

  // Static: uploaded product images
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  // Rate limiting for all API traffic
  app.use("/api", globalLimiter);

  // Routes
  app.use("/api/auth", authRoutes);
  app.use("/api/categories", categoryRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/cart", cartRoutes);
  app.use("/api/wishlist", wishlistRoutes);

  // 404 for unknown API routes (clean JSON instead of HTML errors)
  app.use(notFoundHandler);

  // Central error handler (safe messages; internal details only in server logs)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
