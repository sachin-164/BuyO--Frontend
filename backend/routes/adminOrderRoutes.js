// routes/adminOrderRoutes.js — admin order management (Phase 6)
// requireAdmin fails closed: fresh DB user reload per request, verified email
// required, DB-backed `role = 'admin'` (sole source of truth since Phase 11;
// see docs/admin-provisioning.md).
const express = require("express");
const router = express.Router();
const { listAdminOrders, getAdminOrder, updateOrderStatus } = require("../controllers/adminOrderController");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { validateBody, validateQuery } = require("../middleware/validate");
const { STATUS_VALUES } = require("../utils/orderStatus");

const listQuerySchema = {
  q: { type: "string", maxLength: 100 },
  status: {
    type: "string",
    maxLength: 20,
    validate: (value) => (STATUS_VALUES.includes(value) ? null : `status must be one of: ${STATUS_VALUES.join(", ")}`)
  },
  page: { type: "integer", min: 1, max: 100000000 },
  limit: { type: "integer", min: 1, max: 100 }
};

const statusSchema = {
  status: {
    required: true,
    type: "string",
    validate: (value) => (STATUS_VALUES.includes(value) ? null : `status must be one of: ${STATUS_VALUES.join(", ")}`)
  },
  note: { type: "string", maxLength: 500 }
};

router.use(requireAuth, requireAdmin);

router.get("/", validateQuery(listQuerySchema), listAdminOrders);
router.get("/:id", getAdminOrder);
router.put("/:id/status", validateBody(statusSchema), updateOrderStatus);

module.exports = router;
