// Get wishlist items
const getWishlist = (req, res) => {
  res.json({ message: "Wishlist items fetched successfully!" });
};

// Add to wishlist
const addToWishlist = (req, res) => {
  res.json({ message: "Item added to wishlist!" });
};

// Remove from wishlist
const removeFromWishlist = (req, res) => {
  res.json({ message: `Item with ID ${req.params.id} removed from wishlist!` });
};

module.exports = { getWishlist, addToWishlist, removeFromWishlist };
