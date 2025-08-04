// const Product = require("../models/Product");

// // Add product
// const addProduct = async (req, res) => {
//   try {
//     const { name, price, category, description, image } = req.body;
//     const product = new Product({ name, price, category, description, image });
//     await product.save();
//     res.status(201).json({ message: "✅ Product added successfully", product });
//   } catch (error) {
//     res.status(500).json({ message: "❌ Error adding product", error: error.message });
//   }
// };

// // Get all products
// const getProducts = async (req, res) => {
//   try {
//     const products = await Product.find();
//     res.json(products);
//   } catch (error) {
//     res.status(500).json({ message: "❌ Error fetching products", error: error.message });
//   }
// };

// module.exports = { addProduct, getProducts };


const Product = require("../models/product");

// Add Product
const addProduct = async (req, res) => {
  try {
    const { name, category, description, mrpPrice, sellingPrice } = req.body;

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";

    const product = new Product({
      name,
      category,
      description,
      mrpPrice,
      sellingPrice,
      image: imageUrl
    });

    await product.save();
    res.status(200).json({ message: "✅ Product added successfully!" });

  } catch (error) {
    res.status(500).json({ message: "❌ Error adding product", error: error.message });
  }
};

// Get Products
const getProducts = async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: "❌ Error fetching products", error: error.message });
  }
};

module.exports = { addProduct, getProducts };
