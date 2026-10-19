// api/[...path].js — CANDIDATE Vercel serverless entry (Phase 8 preparation).
//
// Status: DEPLOYED as the production API entry on the `buyo-project` Vercel
// project. The catch-all filename `[...path]` is required by Vercel's
// zero-config routing: a plain `api/index.js` only matches the EXACT path
// `/api/index` (subpaths like `/api/index/health` return an edge 404 —
// verified live), while `api/[...path].js` natively matches every `/api/*`
// request and delivers the FULL path to the handler. That made the old
// `vercel.json` rewrite (`/api/:path*` → `/api/index/:path`) unable to route
// any real endpoint; the rewrite was removed along with the rename.
//
// What this file does:
//   - Boots the existing Express app (backend/app.js createApp()) WITHOUT
//     server.js's listen()/signal handling — serverless owns the lifecycle.
//   - Normalizes the incoming URL with restoreApiPrefix() so the app works
//     whether the platform delivers the full path ("/api/products") — the
//     form the catch-all delivers — or a stripped sub-path ("/products") or
//     the legacy function-name form ("/api/index/products"). Pure function,
//     unit-tested in backend/test/deployReadiness.test.js together with a
//     real HTTP round trip.
//   - Loads backend/.env for LOCAL previews only (vercel dev). In production
//     the platform's environment variables are already set and dotenv never
//     overrides existing values, so this is a no-op there.
//
// Known serverless limitations of the current app (documented, unchanged
// here — each needs its own approved phase): local-disk product uploads
// (ephemeral on Vercel; Supabase Storage plan in docs/storage-supabase.md),
// the 5 MB multer limit vs Vercel's ~4.5 MB request payload cap, and the
// in-memory rate limiter being per-instance.
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", "backend", ".env"), quiet: true });

const { createApp } = require("../backend/app");

const app = createApp();

// Restore the /api prefix if the platform stripped it. Order matters:
// the function-name form must be checked before the generic /api/ passthrough.
function restoreApiPrefix(url) {
  const value = typeof url === "string" && url !== "" ? url : "/";
  const FUNCTION_PREFIX = "/api/index";
  if (value === FUNCTION_PREFIX || value.startsWith(FUNCTION_PREFIX + "/") || value.startsWith(FUNCTION_PREFIX + "?")) {
    return "/api" + value.slice(FUNCTION_PREFIX.length);
  }
  if (value === "/api" || value.startsWith("/api/")) return value;
  if (value === "/") return "/api";
  if (value.charAt(0) === "?") return "/api" + value;
  return value.charAt(0) === "/" ? "/api" + value : "/api/" + value;
}

function handler(req, res) {
  req.url = restoreApiPrefix(req.url);
  return app(req, res);
}

module.exports = handler;
module.exports.restoreApiPrefix = restoreApiPrefix;
