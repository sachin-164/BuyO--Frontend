// app.js
// Express application (middleware + routes). Kept separate from server.js so
// tests (and future serverless deployments) can boot the app without listening.

const express = require("express");
const path = require("path");
const { securityHeaders, corsMiddleware } = require("./middleware/security");
const { globalLimiter } = require("./middleware/rateLimiters");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/authRoutes");
const healthRoutes = require("./routes/healthRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const addressRoutes = require("./routes/addressRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminOrderRoutes = require("./routes/adminOrderRoutes");

// Parses TRUST_PROXY (see call site in createApp). Exported for unit tests.
// Values are deliberately restricted: Express's trust-all (`true`) and the
// function/everything forms are rejected because they let any client forge
// X-Forwarded-For and defeat IP-based rate limiting.
function resolveTrustProxy(env = process.env) {
  const raw = String(env.TRUST_PROXY || "").trim();
  if (!raw) return null; // not set -> Express default (trust no proxy)
  if (raw === "true" || raw === "*" || raw === "yes") {
    throw new Error(
      'TRUST_PROXY must not be trust-all. Use a hop count (e.g. "1"), "loopback", "uniquelocal", or explicit IPs/CIDRs.'
    );
  }
  if (/^\d+$/.test(raw)) return Number(raw); // hop count
  if (raw === "loopback" || raw === "uniquelocal") return raw;
  // Comma-separated IPs / CIDRs / names accepted by Express.
  if (/^[a-zA-Z0-9.,:/ _-]+$/.test(raw)) {
    return raw.split(",").map((part) => part.trim()).filter(Boolean);
  }
  throw new Error(`Invalid TRUST_PROXY value: "${raw}"`);
}

function applyTrustProxy(app, env = process.env) {
  const value = resolveTrustProxy(env);
  if (value !== null) app.set("trust proxy", value);
  return value;
}

function createApp() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required (see backend/.env.example)");
  }

  const app = express();

  // Proxy trust (Phase 11): ONLY enable when this app actually runs behind a
  // reverse proxy / load balancer — otherwise req.ip would be the proxy's IP
  // and every user would share one rate-limit bucket. Accepted values: a hop
  // count ("1"), "loopback", "uniquelocal", or a comma-separated list of
  // IPs/CIDRs. The trust-all value `true` is REFUSED: it would let any client
  // spoof X-Forwarded-For and bypass IP rate limiting entirely.
  applyTrustProxy(app);

  // Security headers + CORS allowlist
  app.use(securityHeaders());
  app.use(corsMiddleware());

  // Body parsing (bounded)
  app.use(express.json({ limit: "100kb" }));

  // Static: uploaded product images (Phase 11: also rate-limited — the global
  // API limiter alone left /uploads unlimited, a free bandwidth-DoS vector).
  app.use("/uploads", globalLimiter, express.static(path.join(__dirname, "uploads")));

  // Rate limiting for all API traffic
  app.use("/api", globalLimiter);

  // Routes
  app.use("/api/health", healthRoutes); // liveness + bounded DB readiness (Phase 9)
  app.use("/api/auth", authRoutes);
  app.use("/api/categories", categoryRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/cart", cartRoutes);
  app.use("/api/wishlist", wishlistRoutes);
  app.use("/api/addresses", addressRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/admin/orders", adminOrderRoutes);

  // 404 for unknown API routes (clean JSON instead of HTML errors)
  app.use(notFoundHandler);

  // Central error handler (safe messages; internal details only in server logs)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, resolveTrustProxy };
