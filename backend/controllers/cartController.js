// Get cart items
const getCart = (req, res) => {
  res.json({ message: "Cart items fetched successfully!" });
};

// Add to cart
const addToCart = (req, res) => {
  res.json({ message: "Item added to cart!" });
};

// Remove from cart
const removeFromCart = (req, res) => {
  res.json({ message: `Item with ID ${req.params.id} removed from cart!` });
};

module.exports = { getCart, addToCart, removeFromCart };
