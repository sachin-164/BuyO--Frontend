// middleware/auth.js
// JWT authentication + role-based authorization.
//
// requireAuth verifies the Bearer token, loads the user FRESH from the database
// on every request (so verification/role changes take effect immediately), and
// attaches it as req.user.
//
// requireAdmin additionally requires the user to be verified and to be listed
// in the server-side admin allowlist (utils/roles.js). Nothing about admin
// status is ever trusted from the client.

const jwt = require("jsonwebtoken");
const User = require("../models/user");
const { isAdminEmail } = require("../utils/roles");

function unauthorized(res, message = "Authentication required") {
  return res.status(401).json({ success: false, message });
}

function forbidden(res, message = "Access denied") {
  return res.status(403).json({ success: false, message });
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return unauthorized(res);

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return unauthorized(res, "Invalid or expired session. Please sign in again.");
    }

    // Only access tokens may authenticate API requests.
    if (payload.purpose && payload.purpose !== "access") {
      return unauthorized(res, "Invalid or expired session. Please sign in again.");
    }
    if (!payload.id) return unauthorized(res, "Invalid or expired session. Please sign in again.");

    const user = await User.findByPk(payload.id);
    if (!user) return unauthorized(res, "Invalid or expired session. Please sign in again.");

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return unauthorized(res);
  if (!req.user.isVerified || !isAdminEmail(req.user.email)) {
    return forbidden(res, "Admin privileges required");
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
