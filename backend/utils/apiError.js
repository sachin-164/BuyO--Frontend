// utils/apiError.js
// Controlled HTTP errors for the cart/wishlist (and future) controllers.
//
// Throwing an HttpError inside sequelize.transaction() rolls the transaction
// back and propagates to Express; middleware/errorHandler.js maps it to its
// status + safe JSON body (internal details never leak).

class HttpError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = { success: false, message, ...(errors && errors.length ? { errors } : {}) };
  }
}

// Parses a numeric path param (ids are positive 32-bit ints in MySQL).
function parsePositiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
    throw new HttpError(400, "Validation failed", [`Invalid ${label}`]);
  }
  return id;
}

module.exports = { HttpError, parsePositiveId };
