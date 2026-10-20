// api/app.js — the deployed Vercel serverless entry.
//
// Routing story (every step verified live on the `buyo-project` project):
//   - `api/index.js` matches ONLY the exact `/api/index` path (subpaths hit
//     the edge 404), so the historical `/api/:path*` → `/api/index/:path`
//     rewrite could never deliver a real endpoint.
//   - `api/[...path].js` as a zero-config function matched only ONE segment
//     (`/api/health` reached it, `/api/health/ready` edge-404'd).
//   - FINAL DESIGN: a plain `api/app.js` function (route `/api/app`) plus a
//     `vercel.json` rewrite `/api/:path*` → `/api/app`. Vercel rewrites
//     deliver the ORIGINAL url to the function and append the unbound
//     `:path` capture as a query parameter (e.g. `/api/health/ready?path=
//     health%2Fready`) — restoreApiPrefix() strips that synthetic param.
//
// What this file does:
//   - Boots the existing Express app (backend/app.js createApp()) WITHOUT
//     server.js's listen()/signal handling — serverless owns the lifecycle.
//   - Normalizes the incoming URL with restoreApiPrefix() so the app works
//     whether the platform delivers the full path ("/api/products") — the
//     form the rewrite delivers — or a stripped sub-path ("/products") or
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

// Load backend/.env for LOCAL previews only (vercel dev). In production the
// platform's environment variables are already set and dotenv never
// overrides existing values, so this is a no-op there. dotenv is declared in
// the ROOT package.json because this entry lives at repo root (api/) — the
// backend workspace nests its own copy under backend/node_modules/, which a
// require from api/ can never reach (that mismatch was the live
// FUNCTION_INVOCATION_FAILED: "Cannot find module 'dotenv'"). The catch is a
// belt: on Vercel the platform env is complete without dotenv, so a missing
// optional preview nicety must never take the API down.
try {
  require("dotenv").config({ path: path.join(__dirname, "..", "backend", ".env"), quiet: true });
} catch (err) {
  // dotenv not installed (platform env already provided): continue.
}

const { createApp } = require("../backend/app");

const app = createApp();

// Vercel rewrites (/api/:path* → /api/app) deliver the original path but
// append the unbound :path capture as a query parameter (?path=...). No
// route consumes a `path` query parameter (validateQuery whitelists per
// route), so drop the synthetic one before Express sees the request; every
// real query parameter is preserved. Verified live: the function receives
// "/api/health/ready?path=health%2Fready" for a request to /api/health/ready.
function stripRewriteParam(url) {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const kept = url
    .slice(q + 1)
    .split("&")
    .filter((param) => param !== "path" && !param.startsWith("path="));
  return kept.length ? url.slice(0, q) + "?" + kept.join("&") : url.slice(0, q);
}

// Restore the /api prefix if the platform stripped it. Order matters:
// the function-name form must be checked before the generic /api/ passthrough.
function restoreApiPrefix(url) {
  const value = stripRewriteParam(typeof url === "string" && url !== "" ? url : "/");
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
module.exports.stripRewriteParam = stripRewriteParam;
