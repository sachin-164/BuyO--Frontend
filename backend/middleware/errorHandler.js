// middleware/errorHandler.js
// Safe, centralized error responses.
// - 4xx errors keep their (non-sensitive) message.
// - 5xx errors are logged server-side in full and answered with a generic
//   message — internal details (SQL errors, stack traces) never reach clients.

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Body parser: payload too large
  if (err.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "Request body too large" });
  }

  // Body parser: malformed JSON
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ success: false, message: "Invalid JSON body" });
  }

  // multer upload errors (e.g. file too large)
  if (err.name === "MulterError") {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File too large (max 5 MB)" : "File upload error";
    return res.status(400).json({ success: false, message });
  }

  // Controlled HTTP errors thrown by controllers (e.g. validation inside a
  // transaction) — carries a safe, pre-sanitized JSON body.
  if (err.name === "HttpError" && err.body) {
    return res.status(err.status).json(err.body);
  }

  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(`❌ ${req.method} ${req.originalUrl}:`, err.stack || err.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again later." });
  }

  console.warn(`⚠️ ${req.method} ${req.originalUrl}: ${err.message}`);
  res.status(status).json({ success: false, message: "Request failed" });
}

module.exports = { notFoundHandler, errorHandler };
