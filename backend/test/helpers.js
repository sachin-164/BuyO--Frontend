// test/helpers.js
// Shared test harness for the Phase 2 test suites.
//
// SAFETY: this harness NEVER touches the real dev database. The target database
// name is forced to buyoDB_ph2_test (must end with _test, enforced below) and it
// is dropped + recreated before each test run.
//
// Requires helpers BEFORE any app module so the test environment is in place.

const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const TEST_DB_NAME = "buyoDB_ph2_test";
if (!/_test$/.test(TEST_DB_NAME)) {
  throw new Error("Test database name must end with _test");
}

// Test environment (set before app modules are loaded)
process.env.NODE_ENV = "test";
process.env.MYSQL_DB = TEST_DB_NAME;
process.env.FRONTEND_URL = "http://127.0.0.1:5503";
process.env.BACKEND_URL = "http://127.0.0.1:5099";
process.env.ADMIN_EMAILS = "admin.ph2@buyotest.local";
process.env.RATE_LIMIT_GLOBAL_MAX = "100000";
process.env.RATE_LIMIT_AUTH_MAX = "100000";

const { resolveMysqlSettings } = require("../config/dbConnectionOptions");

async function recreateTestDatabase() {
  const settings = resolveMysqlSettings();
  if (settings.database !== TEST_DB_NAME) {
    throw new Error(`Refusing to run: expected test database "${TEST_DB_NAME}", got "${settings.database}"`);
  }

  const connection = await mysql.createConnection({
    host: settings.host,
    port: settings.port,
    user: settings.username,
    password: settings.password,
    ...(settings.ssl ? { ssl: settings.ssl } : {})
  });
  await connection.query(`DROP DATABASE IF EXISTS \`${TEST_DB_NAME}\``);
  await connection.query(`CREATE DATABASE \`${TEST_DB_NAME}\``);
  await connection.end();
}

async function startTestApp() {
  await recreateTestDatabase();

  const { createApp } = require("../app");
  const sequelize = require("../config/db");
  require("../models/user");
  require("../models/product");
  require("../models/cart");
  require("../models/wishlist");
  await sequelize.sync(); // creates tables in the scratch test DB only

  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    sequelize,
    close: async () => {
      await new Promise((resolve) => {
        server.closeIdleConnections?.();
        server.close(() => resolve());
      });
      await sequelize.close();
    }
  };
}

async function api(baseUrl, pathname, options = {}) {
  const { method = "GET", token, body, rawBody, headers = {} } = options;

  const finalHeaders = { ...headers };
  if (token) finalHeaders.Authorization = `Bearer ${token}`;

  let payload;
  if (rawBody !== undefined) {
    payload = rawBody;
    if (!finalHeaders["Content-Type"]) finalHeaders["Content-Type"] = "application/json";
  } else if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(baseUrl + pathname, {
    method,
    headers: finalHeaders,
    body: payload,
    redirect: "manual"
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON (e.g. verification plain-text errors)
  }

  return { status: res.status, headers: res.headers, text, json, location: res.headers.get("location") };
}

let emailCounter = 0;
function uniqueEmail(prefix = "user") {
  emailCounter += 1;
  return `${prefix}.${Date.now()}.${emailCounter}@buyotest.local`;
}

function clearOutbox() {
  require("../utils/mailer").clearOutbox();
}

function getOutbox() {
  return require("../utils/mailer").getOutbox();
}

function extractTokenFromEmail(html, kind = "verify") {
  const pattern = kind === "reset" ? /reset-password\.html\?token=([^"'&\s]+)/ : /verify\?token=([^"'&\s]+)/;
  const match = String(html).match(pattern);
  if (!match) throw new Error(`No ${kind} token found in email`);
  return decodeURIComponent(match[1]);
}

async function createVerifiedUser(baseUrl, overrides = {}) {
  const email = overrides.email || uniqueEmail("user");
  const password = overrides.password || "Password123!";
  const name = overrides.name || "Ph2 Test User";

  clearOutbox();
  const signup = await api(baseUrl, "/api/auth/signup", { method: "POST", body: { name, email, password } });
  if (signup.status !== 201) throw new Error(`signup failed (${signup.status}): ${signup.text}`);

  const outbox = getOutbox();
  const token = extractTokenFromEmail(outbox[outbox.length - 1].html, "verify");

  const verify = await api(baseUrl, `/api/auth/verify?token=${encodeURIComponent(token)}`);
  if (verify.status !== 302) throw new Error(`verify failed (${verify.status}): ${verify.text}`);

  const login = await api(baseUrl, "/api/auth/login", { method: "POST", body: { email, password } });
  if (login.status !== 200) throw new Error(`login failed (${login.status}): ${login.text}`);

  return { name, email, password, token: login.json.token, user: login.json.user };
}

function createAdminUser(baseUrl) {
  return createVerifiedUser(baseUrl, {
    email: "admin.ph2@buyotest.local",
    password: "AdminPass123!",
    name: "Ph2 Admin"
  });
}

module.exports = {
  TEST_DB_NAME,
  startTestApp,
  api,
  uniqueEmail,
  clearOutbox,
  getOutbox,
  extractTokenFromEmail,
  createVerifiedUser,
  createAdminUser
};
