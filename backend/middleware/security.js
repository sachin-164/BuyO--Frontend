// middleware/security.js
// Security headers (helmet) + CORS allowlisting.

const helmet = require("helmet");
const cors = require("cors");

// Local dev frontends are always allowed (VS Code Live Server 5503, other 5500 default).
const LOCAL_DEV_ORIGINS = [
  "http://127.0.0.1:5503",
  "http://localhost:5503",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

// Allowed origins = local dev defaults + the origin of FRONTEND_URL + CORS_ALLOWED_ORIGINS.
function getAllowedOrigins() {
  const configured = String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  let frontendOrigin = null;
  try {
    if (process.env.FRONTEND_URL) frontendOrigin = new URL(process.env.FRONTEND_URL).origin;
  } catch {
    // Ignore malformed FRONTEND_URL — CORS decisions must not crash the server.
  }

  return new Set([...LOCAL_DEV_ORIGINS, ...(frontendOrigin ? [frontendOrigin] : []), ...configured]);
}

function securityHeaders() {
  return helmet({
    // Product images are served from /uploads and are loaded cross-origin by
    // the frontend (a different port in dev, another domain in prod), so the
    // default same-origin resource policy would break them.
    crossOriginResourcePolicy: { policy: "cross-origin" }
  });
}

function corsMiddleware() {
  return cors({
    origin(origin, callback) {
      // No Origin header = non-browser client (curl, server-to-server). Allowed.
      if (!origin) return callback(null, true);
      return callback(null, getAllowedOrigins().has(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600
  });
}

module.exports = { securityHeaders, corsMiddleware, getAllowedOrigins };
