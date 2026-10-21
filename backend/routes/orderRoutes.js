// routes/orderRoutes.js — customer orders + COD checkout (Phase 6)
// All routes require auth (JWT); orders are always scoped to req.user.id.
const express = require("express");
const router = express.Router();
const { createOrder, listOrders, getOrder, cancelOrder } = require("../controllers/orderController");
const { requireAuth } = require("../middleware/auth");
const { validateBody, validateQuery } = require("../middleware/validate");
const { STATUS_VALUES } = require("../utils/orderStatus");

const idempotencyKeyRule = {
  type: "string",
  minLength: 8,
  maxLength: 64,
  validate: (value) => (/^[A-Za-z0-9_-]+$/.test(value) ? null : "idempotencyKey may only contain letters, numbers, - and _")
};

const createOrderSchema = {
  addressId: { required: true, type: "integer", min: 1, max: 2147483647 },
  idempotencyKey: { required: true, ...idempotencyKeyRule },
  notes: { type: "string", maxLength: 500 }
};

const listQuerySchema = {
  status: {
    type: "string",
    maxLength: 20,
    validate: (value) => (STATUS_VALUES.includes(value) ? null : `status must be one of: ${STATUS_VALUES.join(", ")}`)
  },
  page: { type: "integer", min: 1, max: 100000000 },
  limit: { type: "integer", min: 1, max: 100 }
};

router.use(requireAuth);

router.get("/", validateQuery(listQuerySchema), listOrders);   // own list
router.post("/", validateBody(createOrderSchema), createOrder); // checkout (COD)
router.get("/:id", getOrder);                                   // own detail
router.post("/:id/cancel", cancelOrder);                         // own cancellation (restocks)

module.exports = router;
