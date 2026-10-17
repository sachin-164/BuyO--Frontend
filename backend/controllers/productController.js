const Product = require("../models/product");

// ---------- Add Product (POST /api/products, image via multer "image" field) ----------
const addProduct = async (req, res) => {
  try {
    const { name, category, description, mrpPrice, sellingPrice } = req.body;

    // Basic validation
    if (!name || !category || !mrpPrice || !sellingPrice) {
      return res.status(400).json({
        success: false,
        message: "name, category, mrpPrice and sellingPrice are required"
      });
    }

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : (req.body.image || "");

    const product = await Product.create({
      name,
      category,
      description,
      mrpPrice: Number(mrpPrice),
      sellingPrice: Number(sellingPrice),
      image: imageUrl
    });

    res.status(201).json({ success: true, message: "✅ Product added successfully!", product });

  } catch (error) {
    console.error("❌ Error adding product:", error.message);
    res.status(500).json({ success: false, message: "Error adding product", error: error.message });
  }
};

// ---------- Get All Products (GET /api/products) ----------
const getProducts = async (req, res) => {
  try {
    const products = await Product.findAll();
    res.json({ success: true, count: products.length, products });
  } catch (error) {
    console.error("❌ Error fetching products:", error.message);
    res.status(500).json({ success: false, message: "Error fetching products", error: error.message });
  }
};

// ---------- Get One Product (GET /api/products/:id) ----------
const getProductById = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.json({ success: true, product });
  } catch (error) {
    console.error("❌ Error fetching product:", error.message);
    res.status(500).json({ success: false, message: "Error fetching product", error: error.message });
  }
};

module.exports = { addProduct, getProducts, getProductById };
