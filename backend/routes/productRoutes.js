const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { addProduct, getProducts, getProductById } = require("../controllers/productController");

// Ensure the uploads folder exists (multer would fail with ENOENT otherwise)
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer config (store files in /uploads with timestamped original name)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "-"))
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/"))
});

// Routes
router.get("/", getProducts);                              // GET  /api/products
router.get("/:id", getProductById);                        // GET  /api/products/:id
router.post("/", upload.single("image"), addProduct);      // POST /api/products (multipart "image")

module.exports = router;
