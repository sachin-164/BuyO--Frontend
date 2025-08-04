// const express = require("express");
// const router = express.Router();
// const { addProduct, getProducts } = require("../controllers/productController");

// router.post("/", addProduct);  // POST /products
// router.get("/", getProducts);  // GET /products

// module.exports = router;

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { addProduct, getProducts } = require("../controllers/productController");

// Multer config (store files in /uploads with original name)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage: storage });

// POST /products (with image)
router.post("/", upload.single("image"), addProduct);
router.get("/", getProducts);

module.exports = router;
