// test/security.test.js
// Security hardening tests: headers, CORS allowlist, admin authorization,
// validation, safe errors, rate limiting and the nodemailer mail path.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const express = require("express");
const helpers = require("./helpers");

describe("Security hardening (headers, CORS, authz, validation, limits)", () => {
  let ctx;
  let admin;

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);
  });

  after(async () => {
    await ctx.close();
  });

  it("public catalog endpoints stay public", async () => {
    const res = await helpers.api(ctx.baseUrl, "/api/products");
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it("helmet security headers are present", async () => {
    const res = await helpers.api(ctx.baseUrl, "/api/products");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("x-frame-options"), "x-frame-options header expected");
    assert.ok(res.headers.get("strict-transport-security"), "HSTS header expected");
    assert.equal(res.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.equal(res.headers.get("x-powered-by"), null, "x-powered-by must be disabled");
  });

  it("CORS: only allowlisted origins are echoed", async () => {
    const allowed = await helpers.api(ctx.baseUrl, "/api/products", {
      headers: { Origin: "http://127.0.0.1:5503" }
    });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://127.0.0.1:5503");

    const blocked = await helpers.api(ctx.baseUrl, "/api/products", {
      headers: { Origin: "https://evil.example" }
    });
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);

    const preflight = await helpers.api(ctx.baseUrl, "/api/auth/login", {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:5503", "Access-Control-Request-Method": "POST" }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:5503");

    const evilPreflight = await helpers.api(ctx.baseUrl, "/api/auth/login", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" }
    });
    assert.notEqual(evilPreflight.status, 204);
    assert.equal(evilPreflight.headers.get("access-control-allow-origin"), null);
  });

  it("POST /api/products requires authentication AND admin role", async () => {
    const payload = { name: "Sec Test Lamp", category: "home", mrpPrice: 1999, sellingPrice: 1499, description: "", image: "" };

    const anon = await helpers.api(ctx.baseUrl, "/api/products", { method: "POST", body: payload });
    assert.equal(anon.status, 401, "no token should be rejected");

    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const asUser = await helpers.api(ctx.baseUrl, "/api/products", {
      method: "POST",
      body: payload,
      token: user.token
    });
    assert.equal(asUser.status, 403, "regular user token must not be enough");

    const asAdmin = await helpers.api(ctx.baseUrl, "/api/products", {
      method: "POST",
      body: payload,
      token: admin.token
    });
    assert.equal(asAdmin.status, 201, `admin should succeed: ${asAdmin.text}`);
    assert.ok(asAdmin.json.product.id);

    const list = await helpers.api(ctx.baseUrl, "/api/products");
    assert.ok(list.json.products.some((p) => p.name === "Sec Test Lamp"));
  });

  it("signup can never grant admin (role field in the body is ignored)", async () => {
    const email = helpers.uniqueEmail("rolecheck");
    helpers.clearOutbox();
    const res = await helpers.api(ctx.baseUrl, "/api/auth/signup", {
      method: "POST",
      body: { name: "Role Check", email, password: "Password123!", role: "admin", isAdmin: true }
    });
    assert.equal(res.status, 201, res.text);

    const User = require("../models/user");
    const user = await User.findOne({ where: { email } });
    assert.ok(user, "user should exist");
    assert.equal(user.role, "customer", "public signup must always produce role=customer");
  });

  it("DB-backed admin role grants/revokes API access (no ADMIN_EMAILS needed)", async () => {
    const { applyRoleChange } = require("../scripts/admin-role");
    const { resolveMysqlSettings, resolveDialect } = require("../config/dbConnectionOptions");
    const settings = resolveMysqlSettings(); // points at the scratch test DB (helpers set it)

    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const payload = { name: "Role Lamp", category: "home", mrpPrice: 100, sellingPrice: 90, description: "", image: "" };

    // Grant through the same code path the audited CLI script uses (MySQL).
    // Migration Phase 5: that script is raw-mysql2 and stays MySQL-only (tooling
    // not migrated), so on PostgreSQL the test toggles the SAME DB-backed
    // Users.role column through the model (same pattern as orders Phase 3) and
    // returns the equivalent { changed, before } result — assertions identical.
    const setRole = async (role) => {
      if (resolveDialect() !== "postgres") {
        return applyRoleChange({ settings, email: user.email, role });
      }
      const User = require("../models/user");
      const row = await User.findOne({ where: { email: user.email } });
      const [count] = await User.update({ role }, { where: { email: user.email } });
      return { changed: count > 0, before: row ? row.role : null };
    };

    const before = await helpers.api(ctx.baseUrl, "/api/products", { method: "POST", body: payload, token: user.token });
    assert.equal(before.status, 403, "fresh user must not be admin");

    const meBefore = await helpers.api(ctx.baseUrl, "/api/auth/me", { token: user.token });
    assert.equal(meBefore.json.user.role, "customer");
    assert.equal(meBefore.json.user.isAdmin, false);

    const grant = await setRole("admin");
    assert.equal(grant.changed, true);
    assert.equal(grant.before, "customer");

    const asAdmin = await helpers.api(ctx.baseUrl, "/api/products", { method: "POST", body: payload, token: user.token });
    assert.equal(asAdmin.status, 201, `granted admin should succeed: ${asAdmin.text}`);
    assert.ok(asAdmin.json.product.slug, "schema v1: product rows carry a slug");
    assert.equal(asAdmin.json.product.stock, 0);

    const meAfter = await helpers.api(ctx.baseUrl, "/api/auth/me", { token: user.token });
    assert.equal(meAfter.json.user.role, "admin");
    assert.equal(meAfter.json.user.isAdmin, true);

    // Revoke -> access is lost immediately (requireAuth reads the DB fresh per request).
    const revoke = await setRole("customer");
    assert.equal(revoke.changed, true);
    const afterRevoke = await helpers.api(ctx.baseUrl, "/api/products", {
      method: "POST",
      body: { ...payload, name: "Role Lamp 2" },
      token: user.token
    });
    assert.equal(afterRevoke.status, 403, "revoked admin must be rejected");
  });

  it("admin can create a product with an uploaded image (multipart)", async () => {
    const form = new FormData();
    form.append("name", "Sec Test Upload");
    form.append("category", "home");
    form.append("mrpPrice", "500");
    form.append("sellingPrice", "450");
    form.append("image", new Blob([Buffer.from([137, 80, 78, 71])], { type: "image/png" }), "sec-test.png");

    const res = await fetch(ctx.baseUrl + "/api/products", {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: form
    });
    const json = await res.json();
    assert.equal(res.status, 201, JSON.stringify(json));
    assert.match(json.product.image, /^\/uploads\//);

    // Clean up the uploaded scratch file (uploads/ is git-ignored, keep it tidy anyway)
    fs.rmSync(path.join(__dirname, "..", "uploads", path.basename(json.product.image)), { force: true });
  });

  it("upload hardening: stored filename is server-generated (no client name, no traversal)", async () => {
    const form = new FormData();
    form.append("name", "Sec Name Test");
    form.append("category", "home");
    form.append("mrpPrice", "500");
    form.append("sellingPrice", "450");
    // Hostile original name: path traversal + weird characters + unicode.
    form.append("image", new Blob([Buffer.from([137, 80, 78, 71])], { type: "image/png" }), "../../../evil name (1).png");

    const res = await fetch(ctx.baseUrl + "/api/products", {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: form
    });
    const json = await res.json();
    assert.equal(res.status, 201, JSON.stringify(json));

    // Filename must be <timestamp>-<16 hex chars>.png — nothing from the client.
    const stored = path.basename(json.product.image);
    assert.match(stored, /^\d+-[0-9a-f]{16}\.png$/, `unsafe stored name: ${stored}`);
    assert.ok(!stored.includes("evil"), "client name must not leak into the stored path");
    // No file may have been written outside uploads/ (backend root or repo root).
    const escapedNames = ["evil name (1).png"];
    for (const root of [path.join(__dirname, ".."), path.join(__dirname, "..", "..")]) {
      for (const name of escapedNames) {
        assert.ok(!fs.existsSync(path.join(root, name)), `file escaped uploads into ${root}`);
      }
    }

    fs.rmSync(path.join(__dirname, "..", "uploads", stored), { force: true });
  });

  it("upload hardening: non-image content disguised as image/png is rejected with 400", async () => {
    const uploadsBefore = new Set(fs.readdirSync(path.join(__dirname, "..", "uploads")));

    const form = new FormData();
    form.append("name", "Sec Fake Image");
    form.append("category", "home");
    form.append("mrpPrice", "500");
    form.append("sellingPrice", "450");
    // HTML payload labelled as image/png (stored-XSS attempt via /uploads).
    form.append("image", new Blob([Buffer.from("<html><script>alert(1)</script></html>")], { type: "image/png" }), "fake.png");

    const res = await fetch(ctx.baseUrl + "/api/products", {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: form
    });
    const json = await res.json();
    assert.equal(res.status, 400, JSON.stringify(json));
    assert.equal(json.success, false);
    assert.ok(json.errors && json.errors.some((e) => /not a valid image/i.test(e)), json.text);

    // The rejected file must have been deleted, not left in /uploads.
    const leaked = fs.readdirSync(path.join(__dirname, "..", "uploads")).filter((f) => !uploadsBefore.has(f));
    assert.deepEqual(leaked, [], `rejected upload left files behind: ${leaked.join(", ")}`);
  });

  it("upload hardening: non-image mimetypes are ignored (no file stored, product still created)", async () => {
    const form = new FormData();
    form.append("name", "Sec No Image");
    form.append("category", "home");
    form.append("mrpPrice", "500");
    form.append("sellingPrice", "450");
    form.append("image", new Blob([Buffer.from("MZ\x90\x00")], { type: "application/x-msdownload" }), "evil.exe");

    const res = await fetch(ctx.baseUrl + "/api/products", {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: form
    });
    const json = await res.json();
    assert.equal(res.status, 201, JSON.stringify(json));
    assert.equal(json.product.image, "", "non-image part must not become the product image");
  });

  it("product validation rejects bad payloads with safe 400s", async () => {
    const cases = [
      [{ category: "x", mrpPrice: 10, sellingPrice: 5 }, "missing name"],
      [{ name: "X", category: "x", mrpPrice: -1, sellingPrice: 5 }, "negative price"],
      [{ name: "X", category: "x", mrpPrice: 100, sellingPrice: 200 }, "selling price above MRP"]
    ];

    for (const [body, label] of cases) {
      const res = await helpers.api(ctx.baseUrl, "/api/products", { method: "POST", body, token: admin.token });
      assert.equal(res.status, 400, `${label}: expected 400, got ${res.status} (${res.text})`);
      assert.equal(res.json.success, false);
    }
  });

  it("login validation rejects missing fields", async () => {
    const res = await helpers.api(ctx.baseUrl, "/api/auth/login", { method: "POST", body: { email: "a@b.co" } });
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });

  it("unknown routes return JSON 404", async () => {
    const res = await helpers.api(ctx.baseUrl, "/api/definitely-not-a-route");
    assert.equal(res.status, 404);
    assert.equal(res.json.success, false);
    assert.match(res.json.message, /not found/);
  });

  it("malformed JSON bodies are rejected with a safe 400", async () => {
    const res = await helpers.api(ctx.baseUrl, "/api/auth/login", { method: "POST", rawBody: "{not-json" });
    assert.equal(res.status, 400);
    assert.equal(res.json.message, "Invalid JSON body");
  });

  it("oversized bodies are rejected with 413", async () => {
    const res = await helpers.api(ctx.baseUrl, "/api/auth/login", {
      method: "POST",
      rawBody: JSON.stringify({ data: "a".repeat(150 * 1024) })
    });
    assert.equal(res.status, 413);
  });

  it("rate limiter mechanism returns 429 once a limit is hit", async () => {
    const { createLimiter } = require("../middleware/rateLimiters");

    const app = express();
    app.get("/limited", createLimiter({ windowMs: 60_000, max: 3 }), (req, res) => res.json({ ok: true }));

    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await fetch(`${base}/limited`)).status);
    assert.deepEqual(statuses, [200, 200, 200, 429]);

    const body = await (await fetch(`${base}/limited`)).json();
    assert.equal(body.success, false);

    await new Promise((resolve) => {
      server.closeIdleConnections?.();
      server.close(() => resolve());
    });
  });

  it("nodemailer builds our message shape without SMTP (v10 smoke test)", async () => {
    const nodemailer = require("nodemailer");
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const info = await transport.sendMail({
      from: "buyo@buyotest.local",
      to: "someone@buyotest.local",
      subject: "smoke",
      html: "<p>hello</p>"
    });
    assert.ok(info.message);
    assert.match(String(info.message), /smoke/i);
  });

  // ---------- Phase 11: configuration hardening (pure unit tests) ----------

  it("TRUST_PROXY: unset by default; safe forms accepted; trust-all refused", () => {
    const { resolveTrustProxy } = require("../app");

    // Unset -> null (Express default: trust no forwarded headers).
    assert.equal(resolveTrustProxy({}), null);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: "  " }), null);

    // Accepted safe forms: hop count, named scopes, explicit IP list.
    assert.equal(resolveTrustProxy({ TRUST_PROXY: "1" }), 1);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: "2" }), 2);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: "loopback" }), "loopback");
    assert.equal(resolveTrustProxy({ TRUST_PROXY: "uniquelocal" }), "uniquelocal");
    assert.deepEqual(resolveTrustProxy({ TRUST_PROXY: "10.0.0.1, 10.0.0.2" }), ["10.0.0.1", "10.0.0.2"]);

    // Trust-all is REFUSED at startup (lets any client forge X-Forwarded-For).
    for (const bad of ["true", "*", "yes"]) {
      assert.throws(() => resolveTrustProxy({ TRUST_PROXY: bad }), /trust-all/i, `must refuse ${bad}`);
    }
    assert.throws(() => resolveTrustProxy({ TRUST_PROXY: "javascript:alert(1)" }), /Invalid TRUST_PROXY/);
  });

  it("CORS: local dev origins are excluded when NODE_ENV=production", async () => {
    const { getAllowedOrigins } = require("../middleware/security");
    const original = process.env.NODE_ENV;
    try {
      // Dev/test: local origins allowed (unchanged dev experience).
      process.env.NODE_ENV = "test";
      const devSet = getAllowedOrigins();
      assert.ok(devSet.has("http://localhost:5500"), "local origins allowed outside production");

      // Production: local origins gone; configured origins still honoured.
      process.env.NODE_ENV = "production";
      const prodSet = getAllowedOrigins({ ...process.env, FRONTEND_URL: "https://shop.example.com", CORS_ALLOWED_ORIGINS: "https://admin.example.com" });
      assert.ok(!prodSet.has("http://localhost:5500"), "no localhost origins in production");
      assert.ok(!prodSet.has("http://127.0.0.1:5503"), "no loopback origins in production");
      assert.ok(prodSet.has("https://shop.example.com"), "FRONTEND_URL origin allowed");
      assert.ok(prodSet.has("https://admin.example.com"), "explicit extra origin allowed");
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("TLS: certificate verification defaults ON; disable only when explicitly false", () => {
    const { sslRejectUnauthorized } = require("../config/dbConnectionOptions");

    // Default (unset / empty / unknown values) -> certificates ARE verified.
    assert.equal(sslRejectUnauthorized({}), true);
    assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: "" }), true);
    assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: "true" }), true);
    assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: "banana" }), true);

    // Explicit falsey values only -> the documented local-dev exception.
    assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: "false" }), false);
    assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: "0" }), false);
    assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: "no" }), false);
    assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: " FALSE " }), false);
  });
});
