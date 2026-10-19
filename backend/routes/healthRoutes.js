// routes/healthRoutes.js — deployment smoke-test endpoints (Phase 9).
//
//   GET /api/health        LIVENESS  — 200 whenever the process can serve
//                                    HTTP. Performs NO database access, so
//                                    it stays green during DB outages and
//                                    never opens connections at cold start.
//   GET /api/health/ready  READINESS — 200 only after a bounded database
//                                    round trip (SELECT 1); 503 otherwise.
//
// Both responses are deliberately minimal and never include hosts,
// credentials, stack traces or any internal configuration. Neither endpoint
// performs migrations or schema synchronization. Both sit behind the global
// API rate limiter (mounted under /api in app.js).
const express = require("express");
const router = express.Router();
const sequelize = require("../config/db");
const { intFromEnvSetting } = require("../config/dbConnectionOptions");

// Bounded readiness probe (env-tunable, strictly validated; name only — no
// secret values involved). Thrown at module load on bad values: fail fast.
const DB_READY_TIMEOUT_MS = intFromEnvSetting(process.env, "HEALTH_DB_TIMEOUT_MS", 2000, 100, 30000);

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("health check timed out")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

// Liveness: the process is up and routing. No database dependency.
router.get("/", (req, res) => {
  res.json({ success: true, status: "ok" });
});

// Readiness: one bounded SELECT 1. Failure answers a SAFE 503 — the error
// itself is deliberately discarded so no driver message, host or stack can
// leak into a response body.
router.get("/ready", async (req, res) => {
  try {
    await withTimeout(sequelize.query("SELECT 1"), DB_READY_TIMEOUT_MS);
    res.json({ success: true, ready: true });
  } catch {
    res.status(503).json({ success: false, ready: false, message: "Database not ready" });
  }
});

module.exports = router;
