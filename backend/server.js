const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config();
console.log("Loaded MONGO_URI:", process.env.MONGO_URI);
connectDB();

const app = express();
app.use(cors());
app.use(express.json());

// Import Routes
app.use("/products", require("./routes/productRoutes"));
app.use("/users", require("./routes/userRoutes"));
app.use("/cart", require("./routes/cartRoutes"));
app.use("/wishlist", require("./routes/wishlistRoutes"));
// Serve uploaded images
app.use("/uploads", express.static("uploads"));

// Start Server
app.listen(process.env.PORT, () =>
  console.log(`🚀 Server running on http://localhost:${process.env.PORT}`)
);
