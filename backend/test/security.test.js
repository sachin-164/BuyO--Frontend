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
    const { resolveMysqlSettings } = require("../config/dbConnectionOptions");
    const settings = resolveMysqlSettings(); // points at the scratch test DB (helpers set it)

    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const payload = { name: "Role Lamp", category: "home", mrpPrice: 100, sellingPrice: 90, description: "", image: "" };

    const before = await helpers.api(ctx.baseUrl, "/api/products", { method: "POST", body: payload, token: user.token });
    assert.equal(before.status, 403, "fresh user must not be admin");

    const meBefore = await helpers.api(ctx.baseUrl, "/api/auth/me", { token: user.token });
    assert.equal(meBefore.json.user.role, "customer");
    assert.equal(meBefore.json.user.isAdmin, false);

    // Grant through the same code path the audited CLI script uses.
    const grant = await applyRoleChange({ settings, email: user.email, role: "admin" });
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
    const revoke = await applyRoleChange({ settings, email: user.email, role: "customer" });
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
});
