// const mongoose = require("mongoose");

// const productSchema = new mongoose.Schema({
//   name: { type: String, required: true },
//   price: { type: Number, required: true },
//   category: { type: String, required: true },
//   description: { type: String },
//   image: { type: String } // URL for product image
// }, { timestamps: true });

// module.exports = mongoose.model("Product", productSchema);

const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  description: { type: String },
  mrpPrice: { type: Number, required: true },
  sellingPrice: { type: Number, required: true },
  image: { type: String } // Store image URL
});

module.exports = mongoose.model("Product", productSchema);
