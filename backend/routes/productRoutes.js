const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { addProduct, getProducts, getProductById } = require("../controllers/productController");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");

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
router.get("/", getProducts);                              // GET  /api/products (public)
router.get("/:id", getProductById);                        // GET  /api/products/:id (public)

// Admin-only: multipart "image" field OR JSON body.
// Multer runs before validation because multipart text fields only exist after parsing.
router.post(
  "/",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  validateBody({
    name: { required: true, type: "string", minLength: 1, maxLength: 200 },
    category: { required: true, type: "string", minLength: 1, maxLength: 100 },
    description: { type: "string", maxLength: 5000 },
    mrpPrice: { required: true, type: "number", min: 0.01, max: 100000000 },
    sellingPrice: { required: true, type: "number", min: 0.01, max: 100000000 },
    image: { type: "string", maxLength: 500 }
  }),
  addProduct
);

module.exports = router;
