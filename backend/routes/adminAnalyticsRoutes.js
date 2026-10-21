// routes/adminAnalyticsRoutes.js — admin dashboard aggregates (Phase A).
// Guarded by requireAuth + requireAdmin (DB-backed role, fail-closed).
const express = require("express");
const router = express.Router();
const { getSummary } = require("../controllers/adminAnalyticsController");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { validateQuery } = require("../middleware/validate");

router.use(requireAuth, requireAdmin);

router.get(
  "/summary",
  validateQuery({
    days: { type: "integer", min: 1, max: 365 }
  }),
  getSummary
);

module.exports = router;
