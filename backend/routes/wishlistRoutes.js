const express = require("express");
const router = express.Router();
const { getWishlist, addToWishlist, removeFromWishlist } = require("../controllers/wishlistController");

// Routes
router.get("/", getWishlist);                // Get all wishlist items
router.post("/", addToWishlist);             // Add to wishlist
router.delete("/:id", removeFromWishlist);   // Remove from wishlist

module.exports = router;
