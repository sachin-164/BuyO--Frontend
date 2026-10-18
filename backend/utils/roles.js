// utils/roles.js
// Server-side admin authorization source of truth.
//
// Phase 3: `Users.role` (ENUM 'customer' | 'admin') is the database-backed
// source of truth — public signup can only ever create 'customer'.
// The Phase 2 ADMIN_EMAILS allowlist remains as a TRANSITIONAL fallback so
// existing legitimate admins keep access until an operator grants their DB
// role with the audited provisioning script (scripts/admin-role.js; see
// docs/admin-provisioning.md for the procedure and sunset plan).
//
// Every caller (requireAdmin, publicUser) goes through isAdminUser on purpose.

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminEmail(email) {
  if (!email) return false;
  return getAdminEmails().includes(String(email).trim().toLowerCase());
}

// `user` is a Sequelize User instance (loaded fresh by requireAuth).
function isAdminUser(user) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return isAdminEmail(user.email); // transitional fallback (see header)
}

module.exports = { getAdminEmails, isAdminEmail, isAdminUser };
