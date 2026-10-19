// scripts/lib/localDbGuard.js
// Shared safety guards for the local-only database tooling (db:sync, db:migrate,
// db:restore, admin:role). Every script built on this module REFUSES to run
// unless ALL of the following hold:
//
//   1. The script's --confirm-local flag was passed explicitly
//   2. NODE_ENV is not "production"
//   3. The target host is loopback (localhost / 127.0.0.1 / ::1)
//   4. The target database is listed in the script's allowlist env var
//
// Refusals happen BEFORE any connection is made — no accidental remote contact.

const { isLoopbackHost, resolveDialect } = require("../../config/dbConnectionOptions");

function getAllowedDatabases(envVarName, defaults = []) {
  const raw = String(process.env[envVarName] || "").trim();
  if (!raw) return defaults;
  return raw.split(",").map((name) => name.trim()).filter(Boolean);
}

// Pure function: returns an array of human-readable refusal reasons ([] = allowed).
function collectLocalGuardReasons({ flags, settings, allowed, allowedEnvVar }) {
  const reasons = [];

  if (!flags.has("--confirm-local")) reasons.push("missing --confirm-local flag");
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") reasons.push("NODE_ENV=production is set");
  if (!settings.host) reasons.push("no database host configured");
  else if (!isLoopbackHost(settings.host)) reasons.push(`host "${settings.host}" is not loopback (localhost/127.0.0.1/::1)`);
  if (!settings.database) {
    // Message-only: name the env var of the ACTIVE dialect (identical text on
    // MySQL — byte-identical guard output for every pre-Phase-7 test).
    const dbEnv = resolveDialect() === "postgres" ? "PG_DB" : "MYSQL_DB";
    reasons.push(`no database name configured (${dbEnv})`);
  } else if (!allowed.includes(settings.database)) reasons.push(`database "${settings.database}" is not in ${allowedEnvVar} (${allowed.join(", ")})`);

  return reasons;
}

function refuseLocal(scriptLabel, usage, reasons) {
  console.error(`❌ REFUSED: ${scriptLabel} only runs against an explicitly confirmed LOCAL dev database.`);
  for (const reason of reasons) console.error(`   - ${reason}`);
  if (reasons.some((reason) => reason.includes("not loopback"))) {
    console.error("   Remote targets stay blocked: the future remote-migration path is a separate, explicitly");
    console.error("   approved mechanism that is disabled by default (see docs/migration-remote.md).");
  }
  console.error(`   Usage: ${usage}`);
  process.exit(1);
}

module.exports = { getAllowedDatabases, collectLocalGuardReasons, refuseLocal };
