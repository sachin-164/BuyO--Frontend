// routes/uploadRoutes.js — direct-to-storage upload authorization (Phase 12).
//
// POST /api/uploads/authorize (admin-only): validates the upload request
// (allowed image type, configured size limit, safe original filename) and
// mints a short-lived, single-use upload authorization for ONE server-
// generated object path. The admin client then PUTs the image bytes DIRECTLY
// to storage (never through this API), and the product create/update handler
// verifies the stored object server-side before any database write
// (lib/imageStore.js resolveProductImageValue).
//
// The service-role credential never leaves the server; the returned
// signedUploadUrl is a short-lived, single-purpose upload token for exactly
// the validated path — the bucket is never publicly writable.
//
// Only enabled for STORAGE_DRIVER=supabase. In local mode it answers
// 409 code:"local-storage" so clients keep using the existing multipart path.
"use strict";

const express = require("express");
const router = express.Router();

const { requireAuth, requireAdmin } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const {
  ALLOWED_IMAGE_TYPES,
  generateImageName,
  getImageStore,
  resolveUploadAuthTtlMs
} = require("../lib/imageStore");
const { uploadLedger } = require("../lib/uploadLedger");

const authorizeSchema = {
  contentType: { required: true, type: "string", maxLength: 100 },
  size: { required: true, type: "integer", min: 1, max: 99999999 },
  filename: { type: "string", maxLength: 255 } // original name: informational only, validated but never used for naming
};

// The original filename never reaches storage (names are server-generated),
// but junk is still refused so malformed clients fail loudly.
function validateOriginalFilename(name) {
  if (name === undefined || name === null || name === "") return null;
  if (/[\u0000-\u001f\u007f/\\]/.test(name)) return "filename contains invalid characters";
  if (name === "." || name === "..") return "filename is invalid";
  return null;
}

router.post("/authorize", requireAuth, requireAdmin, validateBody(authorizeSchema), async (req, res) => {
  let store;
  try {
    store = getImageStore();
  } catch {
    // Misconfiguration is a server fault with no silent fallback to disk.
    return res.status(503).json({ success: false, message: "Storage is not configured" });
  }
  if (store.driver !== "supabase") {
    return res.status(409).json({
      success: false,
      code: "local-storage",
      message: "Direct upload is not available in local storage mode; use multipart upload"
    });
  }

  const { contentType, size, filename } = req.body;
  const errors = [];
  if (!ALLOWED_IMAGE_TYPES[contentType]) {
    errors.push(`contentType must be one of: ${Object.keys(ALLOWED_IMAGE_TYPES).join(", ")}`);
  }
  if (size > store.config.maxImageBytes) {
    errors.push(`size must be at most ${store.config.maxImageBytes} bytes`);
  }
  const filenameError = validateOriginalFilename(filename);
  if (filenameError) errors.push(filenameError);
  if (errors.length) {
    return res.status(400).json({ success: false, message: "Validation failed", errors });
  }

  const objectPath = `products/${generateImageName(contentType)}`;
  let signed;
  try {
    signed = await store.createSignedUpload({ objectPath });
  } catch (err) {
    console.error("❌ storage upload authorization failed:", err.message);
    return res.status(502).json({ success: false, message: "Could not authorize storage upload" });
  }

  let put;
  try {
    put = await uploadLedger.put(objectPath, {
      adminId: req.user.id,
      mimetype: contentType,
      size,
      ttlMs: resolveUploadAuthTtlMs()
    });
  } catch (err) {
    // The signed URL was minted but the durable authorization could not be
    // recorded. Refuse cleanly; the unused signed URL expires on its own.
    console.error("Upload authorization could not be recorded:", err.message);
    return res.status(503).json({
      success: false,
      message: "Upload authorization is temporarily unavailable; try again"
    });
  }
  if (put.status === "full") {
    return res.status(503).json({ success: false, message: "Too many pending uploads; retry shortly" });
  }

  res.status(201).json({
    success: true,
    objectPath,
    signedUploadUrl: signed.signedUrl,
    uploadToken: signed.token,
    publicUrl: store.publicUrlFor(objectPath),
    expiresAt: new Date(put.expiresAt).toISOString(),
    maxBytes: store.config.maxImageBytes
  });
});

module.exports = router;
