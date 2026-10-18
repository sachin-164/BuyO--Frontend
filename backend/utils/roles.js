// utils/roles.js
// Server-side admin authorization source of truth.
//
// Phase 2 uses an environment allowlist (ADMIN_EMAILS) so role checks never
// depend on anything the client sends. Phase 3's schema change will add a
// `role` column to the Users table and this module will read that instead —
// every caller (requireAdmin, publicUser) goes through here on purpose.

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

module.exports = { getAdminEmails, isAdminEmail };
