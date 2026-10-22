// routes/productRoutes.js — catalog products (Phase 4)
// Public: GET / (search/filter/sort/pagination), GET /:identifier (id or slug).
// Admin:  POST /, PUT /:id, DELETE /:id.
const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const {
  addProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  replaceProductImages,
  appendProductImage,
  deleteProductImage,
  MAX_LIMIT
} = require("../controllers/productController");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { validateBody, validateQuery } = require("../middleware/validate");
const { isValidSlug } = require("../utils/slugify");
// Phase 12: image constants + naming live in the storage adapter so the
// multipart path and the direct-upload path can never drift apart.
const {
  ALLOWED_IMAGE_TYPES,
  IMAGE_SIGNATURES,
  DEFAULT_MAX_IMAGE_BYTES,
  generateImageName,
  getImageStore,
  resolveStorageConfig
} = require("../lib/imageStore");

// Ensure the uploads folder exists (multer would fail with ENOENT otherwise).
// BOOT MUST NOT DEPEND ON A WRITABLE DISK: on serverless (Vercel) the
// function file system is read-only outside /tmp and backend/uploads/ is
// gitignored, so this mkdir threw EROFS at import there and took the WHOLE
// API down (every /api/* invocation died with FUNCTION_INVOCATION_FAILED —
// verified live; mechanism reproduced in
// test/deployReadiness.test.js). If the folder cannot be created, boot
// continues; only an actual local-disk upload fails later, with a handled
// error — local-disk uploads are a documented serverless limitation
// (docs/deployment.md; Supabase Storage activation plan in
// docs/storage-supabase.md).
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (err) {
  console.warn(
    `[productRoutes] uploads dir not creatable (${err.code || "ERROR"}): ` +
      "continuing without local-disk uploads (expected on read-only serverless filesystems)"
  );
}

// Multer config (store files in /uploads with a server-generated name).
// SECURITY (Phase 11): the stored filename NEVER contains the client-supplied
// original name — it is timestamp + random hex + an extension derived from an
// allowlisted image mimetype. Combined with the magic-byte check below, a file
// that is not a real image can never land in /uploads (which is served
// statically), closing the stored-content/extension-spoofing vector.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, generateImageName(file.mimetype))
});

// Size limit is configurable (MAX_IMAGE_BYTES, default = the historical 5 MB).
// Read at require time; a config error surfaces on first storage use (503),
// never as a boot crash.
let multerMaxBytes = DEFAULT_MAX_IMAGE_BYTES;
try {
  multerMaxBytes = resolveStorageConfig().maxImageBytes;
} catch {
  // storage misconfiguration is handled lazily with a 503 (no disk fallback)
}
const upload = multer({
  storage,
  limits: { fileSize: multerMaxBytes },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES[file.mimetype]) return cb(null, true);
    // Remember why the file was skipped: silently ignoring it would let an
    // admin believe an image was replaced when the bytes never left the client.
    req.rejectedFileType = file.mimetype;
    cb(null, false);
  }
});

// Reject a request whose only/attached file failed the mimetype allowlist.
// Must run before the handler so nothing else is written for that request.
function rejectDisallowedFile(req, res, next) {
  if (!req.rejectedFileType) return next();
  return res.status(400).json({
    success: false,
    message: "Validation failed",
    errors: [`Unsupported image type "${req.rejectedFileType}"; use JPEG, PNG, WebP or GIF`]
  });
}

// HOSTED STORAGE SAFETY (Phase 12): with STORAGE_DRIVER=supabase the multipart
// path must never land image bytes on the ephemeral function disk. Files are
// removed synchronously before the 409 — no silent local-disk fallback.
function rejectMultipartWhenHosted(req, res, next) {
  if (!req.file) return next();
  let store;
  try {
    store = getImageStore();
  } catch {
    return res.status(503).json({ success: false, message: "Storage is not configured" });
  }
  if (store.driver === "local") return next();
  fs.rmSync(req.file.path, { force: true });
  return res.status(409).json({
    success: false,
    code: "multipart-disabled",
    message:
      "Hosted storage mode does not accept multipart image uploads; use the direct upload flow (POST /api/uploads/authorize)"
  });
}

// Magic-byte verification (runs after multer stored the file): the first bytes
// must match the declared image type, otherwise the file is deleted and the
// request rejected with 400. Minimum discriminating prefixes are used so tiny
// synthetic test fixtures (e.g. a 4-byte PNG header) still validate.

function verifyImageFile(req, res, next) {
  if (!req.file) return next();
  const matches = IMAGE_SIGNATURES[req.file.mimetype];
  const fail = () => {
    // Synchronous removal: the file must be gone before the 400 response is
    // sent (an async unlink races with any immediate directory check).
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: ["Uploaded file is not a valid image (content does not match its type)"]
    });
  };
  let buffer = Buffer.alloc(12);
  let read = 0;
  try {
    const fd = fs.openSync(req.file.path, "r");
    try {
      read = fs.readSync(fd, buffer, 0, 12, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return fail();
  }
  if (!matches || read < 4 || !matches(buffer.subarray(0, read))) return fail();
  next();
}

// A multipart request that ends in an error response must not leave its file
// behind. This runs for every route that accepts a file: if the handler (or a
// later validator) responds 4xx/5xx, the just-written upload is removed. On
// success the file IS the new product image, so it stays.
function cleanupUploadOnFailure(req, res, next) {
  if (!req.file) return next();
  res.on("finish", () => {
    if (res.statusCode >= 400) {
      try {
        fs.rmSync(req.file.path, { force: true });
      } catch (err) {
        console.error("⚠️ failed to remove rejected upload:", err.message);
      }
    }
  });
  next();
}

// Multipart text fields arrive as strings. `imageMeta` is a JSON object in the
// JSON API, so parse it back when it arrives through a form. Anything else
// (numbers, booleans) is already coerced by validateBody.
function parseMultipartJsonFields(req, res, next) {
  if (!req.file) return next(); // JSON body: already an object
  if (typeof req.body.imageMeta === "string" && req.body.imageMeta.trim() !== "") {
    try {
      req.body.imageMeta = JSON.parse(req.body.imageMeta);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: ["imageMeta must be valid JSON"]
      });
    }
  }
  next();
}

// ---------- validation schemas ----------
const VALID_SORTS = ["newest", "oldest", "price_asc", "price_desc", "name_asc", "name_desc"];

const listQuerySchema = {
  q: { type: "string", maxLength: 100 },
  category: { type: "string", maxLength: 160 },
  minPrice: { type: "number", min: 0, max: 100000000 },
  maxPrice: { type: "number", min: 0, max: 100000000 },
  inStock: { type: "boolean" },
  sort: {
    type: "string",
    maxLength: 32,
    validate: (value) => (VALID_SORTS.includes(value) ? null : `sort must be one of: ${VALID_SORTS.join(", ")}`)
  },
  page: { type: "integer", min: 1, max: 100000000 },
  limit: { type: "integer", min: 1, max: MAX_LIMIT }
};

function validateSlugField(value) {
  return isValidSlug(value) ? null : "slug must contain only lowercase letters, numbers and hyphens";
}

// imageMeta: { alt?, width?, height? } — strict shape so junk never lands in JSON.
function validateImageMeta(value) {
  const allowed = ["alt", "width", "height"];
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) return `imageMeta only supports ${allowed.join(", ")} (unknown: ${unknown})`;
  if (value.alt !== undefined && (typeof value.alt !== "string" || value.alt.trim() === "" || value.alt.length > 255)) {
    return "imageMeta.alt must be a non-empty string of at most 255 characters";
  }
  for (const dim of ["width", "height"]) {
    if (value[dim] !== undefined && (!Number.isInteger(value[dim]) || value[dim] < 0 || value[dim] > 100000)) {
      return `imageMeta.${dim} must be an integer between 0 and 100000`;
    }
  }
  return null;
}

const imageMetaRule = { type: "object", validate: validateImageMeta };
const categoryIdRule = { type: "integer", min: 1, max: 2147483647, nullable: true };
const stockRule = { type: "integer", min: 0, max: 1000000000 };
const slugRule = { type: "string", maxLength: 160, validate: validateSlugField };

// POST: create (name/category/prices required; stock/imageMeta/slug/categoryId optional)
const createProductSchema = {
  name: { required: true, type: "string", minLength: 1, maxLength: 200 },
  category: { required: true, type: "string", minLength: 1, maxLength: 100 }, // legacy free-text (kept in sync with categoryId)
  description: { type: "string", maxLength: 5000 },
  mrpPrice: { required: true, type: "number", min: 0.01, max: 100000000 },
  sellingPrice: { required: true, type: "number", min: 0.01, max: 100000000 },
  image: { type: "string", maxLength: 500 },
  slug: slugRule,
  stock: stockRule,
  imageMeta: imageMetaRule,
  categoryId: categoryIdRule
};

// PUT: same rules, everything optional (empty body -> 400 "No fields to update")
// NOTE: copy each rule object — sharing references would strip `required` from
// the create schema too.
const updateProductSchema = Object.fromEntries(
  Object.entries(createProductSchema).map(([field, rules]) => [field, { ...rules }])
);
for (const field of ["name", "category", "mrpPrice", "sellingPrice"]) {
  delete updateProductSchema[field].required;
}
// categoryId: null explicitly unlinks the product from its category (legacy string kept)

// ---------- routes ----------
router.get("/", validateQuery(listQuerySchema), getProducts); // GET /api/products (public)
router.get("/:identifier", getProduct);                       // GET /api/products/:id or :slug (public)

// Admin-only: multipart "image" field OR JSON body.
// Multer runs before validation because multipart text fields only exist after parsing.
router.post(
  "/",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  rejectDisallowedFile,
  rejectMultipartWhenHosted,
  verifyImageFile,
  cleanupUploadOnFailure,
  parseMultipartJsonFields,
  validateBody(createProductSchema),
  addProduct
);

// Admin-only: partial update. Accepts the same multipart "image" field as
// create, so an existing product's image can be replaced without a hosted
// storage account; JSON bodies keep working unchanged.
router.put(
  "/:id",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  rejectDisallowedFile,
  rejectMultipartWhenHosted,
  verifyImageFile,
  cleanupUploadOnFailure,
  parseMultipartJsonFields,
  validateBody(updateProductSchema),
  updateProduct
);

// Admin-only gallery. PUT replaces the ordered set (reorder/alt/remove), POST
// appends one image (JSON url or a local multipart file), DELETE removes one.
router.put("/:id/images", requireAuth, requireAdmin, replaceProductImages);
router.post(
  "/:id/images",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  rejectDisallowedFile,
  rejectMultipartWhenHosted,
  verifyImageFile,
  cleanupUploadOnFailure,
  appendProductImage
);
router.delete("/:id/images/:imageId", requireAuth, requireAdmin, deleteProductImage);

// Admin-only
router.delete("/:id", requireAuth, requireAdmin, deleteProduct);

module.exports = router;
