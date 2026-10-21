// routes/adminCustomerRoutes.js — admin customer directory (Phase A).
// Guarded by requireAuth + requireAdmin (DB-backed role, fail-closed).
const express = require("express");
const router = express.Router();
const { listCustomers, getCustomer } = require("../controllers/adminCustomerController");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { validateQuery } = require("../middleware/validate");

router.use(requireAuth, requireAdmin);

router.get(
  "/",
  validateQuery({
    q: { type: "string", maxLength: 100 },
    page: { type: "integer", min: 1, max: 100000000 },
    limit: { type: "integer", min: 1, max: 100 }
  }),
  listCustomers
);
router.get("/:id", getCustomer);

module.exports = router;
