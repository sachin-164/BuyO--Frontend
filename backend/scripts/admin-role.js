#!/usr/bin/env node
// scripts/admin-role.js
// Explicit, auditable admin provisioning (Phase 3).
//
// `Users.role` is the database-backed source of truth for authorization.
// Public signup can ONLY create 'customer' accounts; admins are granted or
// revoked exclusively through this script (see docs/admin-provisioning.md).
//
// Usage:
//   npm run admin:role -- --list --confirm-local
//   npm run admin:role -- --email user@example.com --role admin --confirm-local
//   npm run admin:role -- --email user@example.com --role customer --confirm-local
//
// Safety guards — REFUSES unless ALL hold:
//   1. --confirm-local flag passed          2. NODE_ENV is not "production"
//   3. host is loopback                     4. database in DB_ADMIN_ALLOWED_DATABASES
//
// Every change prints a timestamped audit line: BEFORE -> AFTER (database, email).

const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const mysql = require("mysql2/promise");
const { resolveMysqlSettings, toMysql2Options } = require("../config/dbConnectionOptions");
const { getAllowedDatabases, collectLocalGuardReasons, refuseLocal } = require("./lib/localDbGuard");

const VALID_ROLES = ["customer", "admin"];
const DEFAULT_ALLOWED_DATABASES = ["buyoDB"];

async function connect(settings) {
  return mysql.createConnection(toMysql2Options(settings));
}

async function getUserByEmail(connection, email) {
  const [rows] = await connection.query(
    "SELECT `id`, `email`, `isVerified`, `role` FROM `Users` WHERE `email` = ? LIMIT 1",
    [email]
  );
  return rows[0] || null;
}

// Library entry point (used by tests and by main()). Throws on user-not-found.
async function applyRoleChange({ settings = resolveMysqlSettings(), email, role }) {
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role "${role}" — expected one of: ${VALID_ROLES.join(", ")}`);
  }
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("A user email is required (--email).");

  const connection = await connect(settings);
  try {
    const user = await getUserByEmail(connection, normalizedEmail);
    if (!user) throw new Error(`No user found with email "${normalizedEmail}".`);

    const result = {
      user: { id: user.id, email: user.email, isVerified: Boolean(user.isVerified) },
      before: user.role,
      after: role,
      changed: user.role !== role
    };
    if (!result.changed) return result;

    await connection.query("UPDATE `Users` SET `role` = ? WHERE `id` = ?", [role, user.id]);
    return result;
  } finally {
    await connection.end();
  }
}

async function listAdmins({ settings = resolveMysqlSettings() }) {
  const connection = await connect(settings);
  try {
    const [rows] = await connection.query(
      "SELECT `id`, `email`, `isVerified` FROM `Users` WHERE `role` = 'admin' ORDER BY `id`"
    );
    return rows.map((row) => ({ id: row.id, email: row.email, isVerified: Boolean(row.isVerified) }));
  } finally {
    await connection.end();
  }
}

function parseFlagValue(flags, name) {
  const args = [...flags];
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const settings = resolveMysqlSettings();
  const allowed = getAllowedDatabases("DB_ADMIN_ALLOWED_DATABASES", DEFAULT_ALLOWED_DATABASES);

  const reasons = collectLocalGuardReasons({
    flags,
    settings,
    allowed,
    allowedEnvVar: "DB_ADMIN_ALLOWED_DATABASES"
  });
  if (reasons.length) {
    refuseLocal(
      "admin:role",
      "npm run admin:role -- --list | --email <email> --role admin|customer --confirm-local",
      reasons
    );
  }

  if (flags.has("--list")) {
    const admins = await listAdmins({ settings });
    console.log(`Admins in "${settings.database}" (${admins.length}):`);
    for (const admin of admins) {
      console.log(`   ${admin.email}${admin.isVerified ? "" : "  ⚠️ not verified (cannot log in yet)"}`);
    }
    if (!admins.length) console.log("   (none)");
    return;
  }

  const email = parseFlagValue(flags, "--email");
  const role = parseFlagValue(flags, "--role");
  if (!email || !role) {
    console.error("❌ Usage: npm run admin:role -- --email <email> --role admin|customer --confirm-local");
    console.error("   or:    npm run admin:role -- --list --confirm-local");
    process.exit(1);
  }

  const result = await applyRoleChange({ settings, email, role });
  if (!result.changed) {
    console.log(`ℹ️  No change: ${result.user.email} already has role "${result.after}" (database: ${settings.database}).`);
    return;
  }

  console.log(
    `ADMIN ROLE CHANGE [${new Date().toISOString()}] ${result.user.email}: ${result.before} -> ${result.after} (database: ${settings.database})`
  );
  console.log("✅ Role updated. Keep this line in your deployment notes for the audit trail.");
  if (!result.user.isVerified) {
    console.log("⚠️  The account is not verified yet — it cannot use admin APIs until the email is verified.");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("❌ admin:role failed:", err.message);
    process.exit(1);
  });
}

module.exports = { applyRoleChange, listAdmins, VALID_ROLES };
