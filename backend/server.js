// server.js
const dotenv = require("dotenv");
dotenv.config(); // ✅ Load .env first

const path = require("path");
const express = require("express");
const cors = require("cors");
const sequelize = require("./config/db"); // MySQL connection (Sequelize)

const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Static: uploaded product images
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/wishlist", wishlistRoutes);

// 404 for unknown API routes (so fetches get clean JSON instead of HTML errors)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err.message);
  res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
});

// Start Server
const startServer = async () => {
  try {
    // Test DB connection
    await sequelize.authenticate();
    console.log(`✅ MySQL Connected to DB: ${process.env.MYSQL_DB}`);

    // Schema is managed explicitly — no implicit sync on boot.
    // Local dev:  npm run db:sync -- --confirm-local
    // Production: versioned migrations (later phase)

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ DB Connection Failed:", err.message);
    process.exit(1); // Stop app if DB fails
  }
};

startServer();
