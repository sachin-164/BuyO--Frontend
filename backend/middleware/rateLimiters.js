// middleware/rateLimiters.js
// Rate limiting: a broad limiter for all API traffic plus a strict limiter for
// auth-sensitive endpoints (signup, login, password reset).
//
// Limits are env-configurable:
//   RATE_LIMIT_GLOBAL_WINDOW_MS / RATE_LIMIT_GLOBAL_MAX  (default 15 min / 300)
//   RATE_LIMIT_AUTH_WINDOW_MS   / RATE_LIMIT_AUTH_MAX    (default 15 min / 15)

const rateLimitModule = require("express-rate-limit");
const rateLimit = rateLimitModule.rateLimit || rateLimitModule;

function createLimiter({ windowMs, max, message = "Too many requests. Please try again later." }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message }
  });
}

const globalLimiter = createLimiter({
  windowMs: Number(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_GLOBAL_MAX || 300)
});

const authLimiter = createLimiter({
  windowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_AUTH_MAX || 15),
  message: "Too many attempts. Please wait a few minutes and try again."
});

module.exports = { createLimiter, globalLimiter, authLimiter };
