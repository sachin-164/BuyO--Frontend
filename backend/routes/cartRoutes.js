// routes/cartRoutes.js — server-authoritative cart (Phase 5)
// All routes require auth (JWT); cart data is always scoped to req.user.id.
const express = require("express");
const router = express.Router();
const {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  MAX_LINE_QTY
} = require("../controllers/cartController");
const { requireAuth } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");

const addToCartSchema = {
  productId: { required: true, type: "integer", min: 1, max: 2147483647 },
  qty: { type: "integer", min: 1, max: MAX_LINE_QTY }
};

const updateCartSchema = {
  qty: { required: true, type: "integer", min: 1, max: MAX_LINE_QTY }
};

router.use(requireAuth);

router.get("/", getCart);                                       // list + authoritative totals
router.post("/", validateBody(addToCartSchema), addToCart);     // add / increment (dedup-safe)
router.put("/:id", validateBody(updateCartSchema), updateCartItem); // set quantity
router.delete("/:id", removeFromCart);                          // remove one line

module.exports = router;
