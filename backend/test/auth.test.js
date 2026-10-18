// test/auth.test.js
// Regression + security tests for signup, email verification, login and the
// password-reset flow. Runs against the scratch DB created by test/helpers.js.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const helpers = require("./helpers");

describe("Auth regression (signup / verify / login / password reset)", () => {
  let ctx;
  let User;
  let tokens;

  before(async () => {
    ctx = await helpers.startTestApp();
    User = require("../models/user");
    tokens = require("../utils/tokens");
  });

  after(async () => {
    await ctx.close();
  });

  it("signup creates an unverified user and sends a verification email", async () => {
    const email = helpers.uniqueEmail("signup");
    helpers.clearOutbox();

    const res = await helpers.api(ctx.baseUrl, "/api/auth/signup", {
      method: "POST",
      body: { name: "Signup Tester", email, password: "Password123!" }
    });

    assert.equal(res.status, 201);
    assert.equal(res.json.success, true);

    const user = await User.findOne({ where: { email } });
    assert.ok(user, "user row should exist");
    assert.equal(user.isVerified, false);

    const outbox = helpers.getOutbox();
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, email);
    assert.equal(outbox[0].subject, "Verify Your Email");
    assert.match(outbox[0].html, /\/api\/auth\/verify\?token=/);
  });

  it("signup rejects invalid payloads with 400", async () => {
    const cases = [
      [{ email: "a@b.co", password: "Password123!" }, "missing name"],
      [{ name: "A", email: "not-an-email", password: "Password123!" }, "bad email"],
      [{ name: "A", email: "a@b.co", password: "short" }, "short password"],
      [{ name: "A", email: "a@b.co", password: "p".repeat(80) }, "overlong password"],
      [{ name: "A", email: "a@b.co", password: "é".repeat(40) }, "password over 72 bytes"]
    ];

    for (const [body, label] of cases) {
      const res = await helpers.api(ctx.baseUrl, "/api/auth/signup", { method: "POST", body });
      assert.equal(res.status, 400, `${label}: expected 400, got ${res.status} (${res.text})`);
      assert.equal(res.json.success, false);
    }
  });

  it("signup rejects a duplicate email", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const res = await helpers.api(ctx.baseUrl, "/api/auth/signup", {
      method: "POST",
      body: { name: "Dup", email: user.email, password: "Password123!" }
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.message, "User already exists");
  });

  it("verify: valid token marks the user verified and login then works", async () => {
    const email = helpers.uniqueEmail("verify");
    helpers.clearOutbox();

    await helpers.api(ctx.baseUrl, "/api/auth/signup", {
      method: "POST",
      body: { name: "Verify Tester", email, password: "Password123!" }
    });
    const token = helpers.extractTokenFromEmail(helpers.getOutbox()[0].html);

    const before = await User.findOne({ where: { email } });
    assert.equal(before.isVerified, false);

    const res = await helpers.api(ctx.baseUrl, `/api/auth/verify?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 302);
    assert.match(res.location, /login\.html\?status=success$/);

    const afterRow = await User.findOne({ where: { email } });
    assert.equal(afterRow.isVerified, true);

    const login = await helpers.api(ctx.baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email, password: "Password123!" }
    });
    assert.equal(login.status, 200);
  });

  it("verify: reusing the same link redirects with already_verified", async () => {
    const email = helpers.uniqueEmail("reverify");
    helpers.clearOutbox();

    await helpers.api(ctx.baseUrl, "/api/auth/signup", {
      method: "POST",
      body: { name: "ReVerify", email, password: "Password123!" }
    });
    const token = helpers.extractTokenFromEmail(helpers.getOutbox()[0].html);

    const first = await helpers.api(ctx.baseUrl, `/api/auth/verify?token=${encodeURIComponent(token)}`);
    assert.equal(first.status, 302);
    assert.match(first.location, /login\.html\?status=success$/);

    const second = await helpers.api(ctx.baseUrl, `/api/auth/verify?token=${encodeURIComponent(token)}`);
    assert.equal(second.status, 302);
    assert.match(second.location, /login\.html\?status=already_verified$/);
  });

  it("verify: invalid and expired tokens are rejected", async () => {
    const invalid = await helpers.api(ctx.baseUrl, "/api/auth/verify?token=garbage");
    assert.equal(invalid.status, 400);

    const expired = jwt.sign({ email: "x@y.z", purpose: "email_verify" }, process.env.JWT_SECRET, {
      expiresIn: "-1s"
    });
    const expiredRes = await helpers.api(ctx.baseUrl, `/api/auth/verify?token=${expired}`);
    assert.equal(expiredRes.status, 400);
  });

  it("login: wrong password and unknown email get the identical generic 401", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);

    const wrongPassword = await helpers.api(ctx.baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: user.email, password: "WrongPass123!" }
    });
    assert.equal(wrongPassword.status, 401);

    const unknownEmail = await helpers.api(ctx.baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: helpers.uniqueEmail("ghost"), password: "WrongPass123!" }
    });
    assert.equal(unknownEmail.status, 401);

    assert.equal(wrongPassword.json.message, unknownEmail.json.message);
  });

  it("login: unverified account — 403 with correct password, generic 401 with wrong one", async () => {
    const email = helpers.uniqueEmail("unverified");
    helpers.clearOutbox();

    const signup = await helpers.api(ctx.baseUrl, "/api/auth/signup", {
      method: "POST",
      body: { name: "Unverified", email, password: "Password123!" }
    });
    assert.equal(signup.status, 201);

    const correct = await helpers.api(ctx.baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email, password: "Password123!" }
    });
    assert.equal(correct.status, 403);
    assert.match(correct.json.message, /not verified/i);

    const wrong = await helpers.api(ctx.baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email, password: "WrongPass123!" }
    });
    assert.equal(wrong.status, 401);
  });

  it("login returns a working access token; /me reflects the same user", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);

    const me = await helpers.api(ctx.baseUrl, "/api/auth/me", { token: user.token });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, user.email);
    assert.equal(me.json.user.isAdmin, false);
    assert.equal(me.json.user.password, undefined, "password hash must never be returned");
  });

  it("/me rejects missing, malformed, and non-access tokens", async () => {
    const missing = await helpers.api(ctx.baseUrl, "/api/auth/me");
    assert.equal(missing.status, 401);

    const malformed = await helpers.api(ctx.baseUrl, "/api/auth/me", { token: "not-a-jwt" });
    assert.equal(malformed.status, 401);

    const verifyPurpose = jwt.sign({ email: "x@y.z", purpose: "email_verify" }, process.env.JWT_SECRET, {
      expiresIn: "5m"
    });
    const wrongPurpose = await helpers.api(ctx.baseUrl, "/api/auth/me", { token: verifyPurpose });
    assert.equal(wrongPurpose.status, 401);

    const expired = jwt.sign({ id: 1, purpose: "access" }, process.env.JWT_SECRET, { expiresIn: "-1s" });
    const expiredRes = await helpers.api(ctx.baseUrl, "/api/auth/me", { token: expired });
    assert.equal(expiredRes.status, 401);
  });

  it("forgot-password: identical response for known and unknown emails; email only for known", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    helpers.clearOutbox();

    const known = await helpers.api(ctx.baseUrl, "/api/auth/forgot-password", {
      method: "POST",
      body: { email: user.email }
    });
    assert.equal(known.status, 200);
    assert.equal(helpers.getOutbox().length, 1, "known email should receive a reset email");

    const unknown = await helpers.api(ctx.baseUrl, "/api/auth/forgot-password", {
      method: "POST",
      body: { email: helpers.uniqueEmail("ghost") }
    });
    assert.equal(unknown.status, 200);
    assert.equal(helpers.getOutbox().length, 1, "unknown email must not trigger an email");

    assert.equal(known.json.message, unknown.json.message);
  });

  it("reset-password: full flow — new password works, old fails, token is single-use", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    helpers.clearOutbox();

    await helpers.api(ctx.baseUrl, "/api/auth/forgot-password", { method: "POST", body: { email: user.email } });
    const outbox = helpers.getOutbox();
    assert.equal(outbox.length, 1);
    const resetToken = helpers.extractTokenFromEmail(outbox[0].html, "reset");

    const reset = await helpers.api(ctx.baseUrl, "/api/auth/reset-password", {
      method: "POST",
      body: { token: resetToken, password: "NewPassword456!" }
    });
    assert.equal(reset.status, 200);

    const oldLogin = await helpers.api(ctx.baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: user.email, password: user.password }
    });
    assert.equal(oldLogin.status, 401, "old password must stop working");

    const newLogin = await helpers.api(ctx.baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: user.email, password: "NewPassword456!" }
    });
    assert.equal(newLogin.status, 200, "new password must work");

    const reuse = await helpers.api(ctx.baseUrl, "/api/auth/reset-password", {
      method: "POST",
      body: { token: resetToken, password: "Another789!" }
    });
    assert.equal(reuse.status, 400, "the same reset token must not work twice");
  });

  it("reset-password: expired and tampered tokens are rejected", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const dbUser = await User.findOne({ where: { email: user.email } });

    const expired = jwt.sign(
      { sub: String(dbUser.id), pwv: tokens.sha256Hex(dbUser.password), purpose: "password_reset" },
      process.env.JWT_SECRET,
      { expiresIn: "-1s" }
    );
    const expiredRes = await helpers.api(ctx.baseUrl, "/api/auth/reset-password", {
      method: "POST",
      body: { token: expired, password: "NewPassword456!" }
    });
    assert.equal(expiredRes.status, 400);

    const valid = tokens.signPasswordResetToken(dbUser);
    const tampered = valid.slice(0, -3) + (valid.endsWith("a") ? "bbb" : "aaa");
    const tamperedRes = await helpers.api(ctx.baseUrl, "/api/auth/reset-password", {
      method: "POST",
      body: { token: tampered, password: "NewPassword456!" }
    });
    assert.equal(tamperedRes.status, 400);
  });

  it("reset-password: weak new password rejected by validation", async () => {
    const res = await helpers.api(ctx.baseUrl, "/api/auth/reset-password", {
      method: "POST",
      body: { token: "abcdefghijklmno", password: "weak" }
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });
});
