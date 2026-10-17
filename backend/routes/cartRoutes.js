const express = require("express");
const router = express.Router();
const { getCart, addToCart, removeFromCart } = require("../controllers/cartController");

// Routes
router.get("/", getCart);          // Get all cart items
router.post("/", addToCart);       // Add to cart
router.delete("/:id", removeFromCart); // Remove from cart

module.exports = router;
