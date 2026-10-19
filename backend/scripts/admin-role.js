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
// DUAL-DIALECT (Migration Phase 7): the guards are identical for both
// databases; MySQL targets come from MYSQL_* env vars, PostgreSQL targets from
// PG_* env vars (never DATABASE_URL, loopback-only, no SSL).
//
// Every change prints a timestamped audit line: BEFORE -> AFTER (database, email).

const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const mysql = require("mysql2/promise");
const {
  resolveDialect,
  resolveMysqlSettings,
  resolvePostgresSettings,
  toMysql2Options
} = require("../config/dbConnectionOptions");
const { getAllowedDatabases, collectLocalGuardReasons, refuseLocal } = require("./lib/localDbGuard");

const VALID_ROLES = ["customer", "admin"];
const DEFAULT_ALLOWED_DATABASES = ["buyoDB"];

// Migration Phase 7: the PostgreSQL path resolves its target from PG_* env vars
// only (same rule as the migration runner) — an explicit settings object is a
// MySQL-path concept and must not be silently ignored on PG.
const PG_ENV_ONLY =
  "PostgreSQL admin:role resolves its target from PG_* environment variables only " +
  "(DB_DIALECT=postgres); passing explicit settings is not supported on this path.";

async function connect(settings) {
  return mysql.createConnection(toMysql2Options(settings));
}

// Migration Phase 7: raw `pg` connection for the PostgreSQL path. Loopback-only
// by design — same boundary as the rest of the PG harness (no SSL, no
// DATABASE_URL, no remote Supabase).
function connectPg(database) {
  const settings = resolvePostgresSettings();
  const { Client } = require("pg");
  return new Client({
    host: settings.host,
    port: settings.port,
    user: settings.username,
    password: settings.password,
    database: database || settings.database
    // No SSL: this path is loopback-only by design.
  });
}

async function getUserByEmail(connection, email) {
  const [rows] = await connection.query(
    "SELECT `id`, `email`, `isVerified`, `role` FROM `Users` WHERE `email` = ? LIMIT 1",
    [email]
  );
  return rows[0] || null;
}

// Library entry point (used by tests and by main()). Throws on user-not-found.
// MySQL keeps the exact pre-Phase-7 behavior (explicit `settings` honored);
// PostgreSQL validates first, then reads its target from PG_* env vars only.
async function applyRoleChange(options = {}) {
  const { email, role } = options;
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role "${role}" — expected one of: ${VALID_ROLES.join(", ")}`);
  }
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("A user email is required (--email).");

  if (resolveDialect() === "postgres") {
    if (options.settings) throw new Error(PG_ENV_ONLY);
    const client = connectPg();
    try {
      await client.connect();
      const { rows } = await client.query(
        `SELECT id, email, "isVerified", role FROM "Users" WHERE email = $1 LIMIT 1`,
        [normalizedEmail]
      );
      const user = rows[0] || null;
      if (!user) throw new Error(`No user found with email "${normalizedEmail}".`);

      const result = {
        user: { id: user.id, email: user.email, isVerified: Boolean(user.isVerified) },
        before: user.role,
        after: role,
        changed: user.role !== role
      };
      if (!result.changed) return result;

      await client.query(`UPDATE "Users" SET role = $1 WHERE id = $2`, [role, user.id]);
      return result;
    } finally {
      await client.end().catch(() => {});
    }
  }

  const settings = options.settings ?? resolveMysqlSettings();
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

async function listAdmins(options = {}) {
  if (resolveDialect() === "postgres") {
    if (options.settings) throw new Error(PG_ENV_ONLY);
    const client = connectPg();
    try {
      await client.connect();
      const { rows } = await client.query(
        `SELECT id, email, "isVerified" FROM "Users" WHERE role = 'admin' ORDER BY id`
      );
      return rows.map((row) => ({ id: row.id, email: row.email, isVerified: Boolean(row.isVerified) }));
    } finally {
      await client.end().catch(() => {});
    }
  }

  const settings = options.settings ?? resolveMysqlSettings();
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
  const dialect = resolveDialect();
  const settings = dialect === "postgres" ? resolvePostgresSettings() : resolveMysqlSettings();
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
    // The PG library path refuses explicit settings (PG_* env only); MySQL
    // keeps receiving the guard's resolved settings as before.
    const admins = dialect === "postgres" ? await listAdmins() : await listAdmins({ settings });
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

  const result =
    dialect === "postgres"
      ? await applyRoleChange({ email, role })
      : await applyRoleChange({ settings, email, role });
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
