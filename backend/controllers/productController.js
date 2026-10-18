const Product = require("../models/product");

// ---------- Add Product (POST /api/products, admin-only; body pre-validated) ----------
const addProduct = async (req, res) => {
  try {
    const { name, category, description, mrpPrice, sellingPrice } = req.body;

    if (sellingPrice > mrpPrice) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: ["sellingPrice cannot be greater than mrpPrice"]
      });
    }

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : (req.body.image || "");

    const product = await Product.create({
      name,
      category,
      description,
      mrpPrice,
      sellingPrice,
      image: imageUrl
    });

    res.status(201).json({ success: true, message: "✅ Product added successfully!", product });
  } catch (error) {
    console.error("❌ Error adding product:", error);
    res.status(500).json({ success: false, message: "Error adding product" });
  }
};

// ---------- Get All Products (GET /api/products) ----------
const getProducts = async (req, res) => {
  try {
    const products = await Product.findAll();
    res.json({ success: true, count: products.length, products });
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ success: false, message: "Error fetching products" });
  }
};

// ---------- Get One Product (GET /api/products/:id) ----------
const getProductById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, product });
  } catch (error) {
    console.error("❌ Error fetching product:", error);
    res.status(500).json({ success: false, message: "Error fetching product" });
  }
};

module.exports = { addProduct, getProducts, getProductById };
