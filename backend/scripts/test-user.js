#!/usr/bin/env node
// scripts/test-user.js
// Temporary CUSTOMER test account for local login testing (Phase 12).
//
// WHY THIS EXISTS
// Signup requires an email-verification click, and real SMTP may not be
// configured yet. This script creates one temporary customer through the SAME
// mechanisms normal registration uses (bcrypt cost 10, same email/password
// rules, same Users table) and — only when explicitly asked with --verified —
// marks THAT ONE ACCOUNT verified so login works. Email verification for
// everyone else is untouched.
//
// Credentials are NEVER accepted as command-line flags (argv is visible to
// other processes), never printed, never committed:
//   - email:  --email flag, or TEST_USER_EMAIL env var, or interactive prompt
//   - password: TEST_USER_PASSWORD env var, or interactive prompt (hidden)
//
// Usage:
//   npm run test:user -- --verified --confirm-local          (create, login-ready)
//   npm run test:user -- --verified --confirm-local          (re-run: idempotent)
//   npm run test:user -- --delete --confirm-local            (remove the test account)
//
// Safety guards — REFUSES unless ALL hold:
//   1. --confirm-local flag passed
//   2. NODE_ENV is not "production"
//   3. host is loopback
//   4. database in DB_TEST_USER_ALLOWED_DATABASES (default: buyoDB)
//
// Idempotency / safety rules:
//   - Account absent            -> create it (role "customer", verified only with --verified)
//   - Account present, created by this script (name marker matches)
//                               -> NO-OP by default; password is NEVER modified
//                                  after creation; --verified only flips isVerified
//   - Account present, NOT created by this script -> REFUSED (never touches
//     pre-existing users: no password, role, or verification changes)
//   - --delete removes ONLY marker accounts (FKs cascade: cart, wishlist,
//     addresses, orders); pre-existing users are refused there too.

const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const readline = require("readline");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const { resolveMysqlSettings, toMysql2Options } = require("../config/dbConnectionOptions");
const { getAllowedDatabases, collectLocalGuardReasons, refuseLocal } = require("./lib/localDbGuard");

const DEFAULT_ALLOWED_DATABASES = ["buyoDB"];
// Distinguishes accounts created by THIS script from pre-existing users.
const TEST_NAME = "BuyO Test Account (temporary)";
// Same rules as the signup endpoint (routes/authRoutes.js).
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Same hashing as controllers/userController.js signup: bcrypt cost 10.
const BCRYPT_ROUNDS = 10;

function parseFlags(argv) {
  const flags = new Set();
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email") {
      values.email = argv[++i];
    } else {
      flags.add(arg);
    }
  }
  return { flags, values };
}

// Prompt helpers accept injectable streams so tests can drive them without a
// real TTY; interactive use relies on the defaults (process.stdin/stdout).
function promptLine(question, input = process.stdin, output = process.stdout) {
  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

// Hidden password prompt: suppresses echo of typed characters.
function promptHidden(question, input = process.stdin, output = process.stdout) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: Boolean(input.isTTY) });
    let muted = false;
    const originalWrite = rl._writeToOutput;
    rl._writeToOutput = (chunk) => {
      if (!muted) originalWrite.call(rl, chunk);
    };
    rl.question(question, (answer) => {
      muted = false;
      rl.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = true; // the prompt itself was written synchronously above
  });
}

function normalizeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new Error("Invalid email address format.");
  }
  return email;
}

async function run() {
  const { flags, values } = parseFlags(process.argv.slice(2));
  const settings = resolveMysqlSettings();
  const allowed = getAllowedDatabases("DB_TEST_USER_ALLOWED_DATABASES", DEFAULT_ALLOWED_DATABASES);

  const reasons = collectLocalGuardReasons({ flags, settings, allowed, allowedEnvVar: "DB_TEST_USER_ALLOWED_DATABASES" });
  if (reasons.length) {
    refuseLocal(
      "test:user",
      "npm run test:user -- [--email <email>] [--verified] [--delete] --confirm-local",
      reasons
    );
  }

  // ---- Resolve email (flag -> env -> prompt) ----
  let emailRaw = values.email || process.env.TEST_USER_EMAIL || "";
  if (!emailRaw) {
    if (!process.stdin.isTTY) {
      throw new Error("No email: pass --email <address> or set TEST_USER_EMAIL (non-interactive shell).");
    }
    emailRaw = await promptLine("Test account email: ");
  }
  const email = normalizeEmail(emailRaw);

  const connection = await mysql.createConnection(toMysql2Options(settings));
  try {
    const [rows] = await connection.query(
      "SELECT `id`, `name`, `isVerified`, `role` FROM `Users` WHERE `email` = ? LIMIT 1",
      [email]
    );
    const existing = rows[0] || null;
    const isTestAccount = Boolean(existing && existing.name === TEST_NAME);
    const stamp = () => `TEST USER [${new Date().toISOString()}] db=${settings.database} ${email}`;

    // ---- DELETE (marker accounts only) ----
    if (flags.has("--delete")) {
      if (!existing) {
        console.log(`ℹ️  Nothing to delete: no account exists for ${email}.`);
        return;
      }
      if (!isTestAccount) {
        throw new Error(
          `REFUSED: ${email} was NOT created by this script (name does not match the test-account marker). ` +
            "Pre-existing users are never deleted."
        );
      }
      // Cascades remove the account's cart, wishlist, addresses and orders.
      await connection.query("DELETE FROM `Users` WHERE `id` = ?", [existing.id]);
      console.log(`${stamp()} DELETED (was verified=${Boolean(existing.isVerified)}, role=${existing.role})`);
      console.log("✅ Test account removed (dependent cart/wishlist/address/order rows cascaded).");
      return;
    }

    // ---- CREATE (password is only requested for an actual creation) ----
    if (!existing) {
      // Resolve password (env -> hidden prompt; NEVER a CLI flag) and apply the
      // same policy as the signup endpoint before hashing anything.
      let password = process.env.TEST_USER_PASSWORD || "";
      if (!password) {
        if (!process.stdin.isTTY) {
          throw new Error("No password: set TEST_USER_PASSWORD (non-interactive shell). It is never accepted as a flag.");
        }
        password = await promptHidden("Password (echo hidden): ");
      }
      if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
        throw new Error(`Password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters (same rule as signup).`);
      }

      const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const verified = flags.has("--verified");
      await connection.query(
        "INSERT INTO `Users` (`name`, `email`, `password`, `isVerified`, `role`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, 'customer', NOW(3), NOW(3))",
        [TEST_NAME, email, hashedPassword, verified ? 1 : 0]
      );
      console.log(`${stamp()} CREATED (verified=${verified}, role=customer)`);
      if (verified) {
        console.log("✅ Login-ready. Open login.html and sign in with these credentials.");
      } else {
        console.log("ℹ️  Created UNVERIFIED — login will be refused (403) until verified.");
        console.log("   Re-run with --verified to mark ONLY this test account verified.");
      }
      return;
    }

    // ---- Existing account handling ----
    if (!isTestAccount) {
      throw new Error(
        `REFUSED: ${email} already exists but was not created by this script. ` +
          "This tool never modifies pre-existing users (no password/role/verification changes). " +
          "Use a different address (e.g. yourname+buyotest@gmail.com) or verify the account through the normal flow."
      );
    }
    if (existing.role !== "customer") {
      throw new Error(`REFUSED: test account ${email} has unexpected role "${existing.role}" — investigate manually.`);
    }

    let changed = false;
    if (flags.has("--verified") && !existing.isVerified) {
      await connection.query("UPDATE `Users` SET `isVerified` = 1, `updatedAt` = NOW(3) WHERE `id` = ?", [existing.id]);
      changed = true;
    }

    if (changed) {
      console.log(`${stamp()} UPDATED (verified: false -> true; password/role untouched)`);
      console.log("✅ Test account is login-ready.");
    } else {
      console.log(`ℹ️  No change: test account exists (verified=${Boolean(existing.isVerified)}, role=customer).`);
      console.log("   The password was NOT modified — re-runs never overwrite it.");
      if (!existing.isVerified && !flags.has("--verified")) {
        console.log("   It is still unverified: re-run with --verified to allow login.");
      }
    }
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error("❌ test:user failed:", err.message);
    process.exit(1);
  });
}

module.exports = { run, TEST_NAME, promptLine, promptHidden };
