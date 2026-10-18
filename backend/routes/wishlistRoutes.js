// routes/wishlistRoutes.js — wishlist (Phase 5)
// All routes require auth (JWT); wishlist data is always scoped to req.user.id.
const express = require("express");
const router = express.Router();
const {
  getWishlist,
  addToWishlist,
  toggleWishlist,
  removeFromWishlist,
  checkWishlist
} = require("../controllers/wishlistController");
const { requireAuth } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");

const productIdSchema = {
  productId: { required: true, type: "integer", min: 1, max: 2147483647 }
};

router.use(requireAuth);

router.get("/", getWishlist);                                   // list (live product data)
router.post("/", validateBody(productIdSchema), addToWishlist); // add (idempotent, dedup-safe)
router.post("/toggle", validateBody(productIdSchema), toggleWishlist);
router.get("/products/:productId", checkWishlist);             // membership check
router.delete("/:productId", removeFromWishlist);              // remove by product id

module.exports = router;
