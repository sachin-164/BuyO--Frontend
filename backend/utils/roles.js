// utils/roles.js
// Server-side admin authorization source of truth.
//
// `Users.role` (ENUM 'customer' | 'admin') is the ONLY source of truth —
// public signup can only ever create 'customer'. The Phase 2 ADMIN_EMAILS
// allowlist fallback was REMOVED in Phase 11 (see docs/admin-provisioning.md):
// at that point every intended admin's DB role had been, or was about to be,
// granted with the audited provisioning script (scripts/admin-role.js), and
// the fallback was a standing privilege-escalation risk (an env edit granting
// admin without any audit trail).
//
// Every caller (requireAdmin, publicUser) goes through isAdminUser on purpose.

function isAdminUser(user) {
  if (!user) return false;
  return user.role === "admin";
}

module.exports = { isAdminUser };
