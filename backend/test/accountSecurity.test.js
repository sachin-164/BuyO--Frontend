// test/accountSecurity.test.js — Phase C (checklist items 8, 10, 14)
//
// Covers:
//   PATCH  /api/auth/me              — profile update (name only, whitelisted)
//   POST   /api/auth/change-password — current-password proof, CAS write,
//                                      session invalidation + fresh token
//   POST   /api/auth/resend-verification — non-enumerating resend
//
// SAFETY: shared harness — scratch test DB only (buyoDB_ph2_test), dropped and
// recreated per run. Mail is captured in memory, never sent.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");
const User = require("../models/user");

describe("Account security + verification resend (Phase C)", () => {
  let ctx;
  let user;
  const password = "Password123!";

  const api = (path, options) => helpers.api(ctx.baseUrl, path, options);

  before(async () => {
    ctx = await helpers.startTestApp();
    user = await helpers.createVerifiedUser(ctx.baseUrl, { name: "Original Name", password });
  });

  after(async () => {
    await ctx.close();
  });

  // ---------- profile ----------
  it("requires authentication to update a profile", async () => {
    const res = await api("/api/auth/me", { method: "PATCH", body: { name: "Nope" } });
    assert.equal(res.status, 401);
  });

  it("updates the name and returns the fresh public user", async () => {
    const res = await api("/api/auth/me", {
      method: "PATCH",
      token: user.token,
      body: { name: "  Renamed Buyer  " }
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.user.name, "Renamed Buyer", "value must be trimmed");
    assert.equal(res.json.user.email, user.email);
    assert.equal(res.json.user.isAdmin, false);

    const me = await api("/api/auth/me", { token: user.token });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.name, "Renamed Buyer");
  });

  it("ignores attempts to change role, verification or email", async () => {
    const res = await api("/api/auth/me", {
      method: "PATCH",
      token: user.token,
      body: {
        name: "Still A Customer",
        role: "admin",
        isVerified: false,
        email: "attacker@example.com"
      }
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.user.role, "customer");
    assert.equal(res.json.user.isAdmin, false);
    assert.equal(res.json.user.isVerified, true);
    assert.equal(res.json.user.email, user.email, "email must be immutable here");

    const dbUser = await User.findByPk(user.user.id);
    assert.equal(dbUser.role, "customer");
    assert.equal(dbUser.isVerified, true);
    assert.equal(dbUser.email, user.email);
  });

  it("validates the profile payload", async () => {
    const empty = await api("/api/auth/me", {
      method: "PATCH",
      token: user.token,
      body: { name: "   " }
    });
    assert.equal(empty.status, 400);

    const missing = await api("/api/auth/me", { method: "PATCH", token: user.token, body: {} });
    assert.equal(missing.status, 400);

    const tooLong = await api("/api/auth/me", {
      method: "PATCH",
      token: user.token,
      body: { name: "x".repeat(101) }
    });
    assert.equal(tooLong.status, 400);
  });

  // ---------- password ----------
  it("rejects a wrong current password without touching the account", async () => {
    const res = await api("/api/auth/change-password", {
      method: "POST",
      token: user.token,
      body: { currentPassword: "definitely-wrong", newPassword: "AnotherPass123!" }
    });
    assert.equal(res.status, 400, res.text);
    assert.equal(res.json.code, "INVALID_CURRENT_PASSWORD");

    // The old session and old password both still work.
    assert.equal((await api("/api/auth/me", { token: user.token })).status, 200);
    const login = await api("/api/auth/login", {
      method: "POST",
      body: { email: user.email, password }
    });
    assert.equal(login.status, 200);
  });

  it("rejects a new password equal to the current one and enforces the policy", async () => {
    const same = await api("/api/auth/change-password", {
      method: "POST",
      token: user.token,
      body: { currentPassword: password, newPassword: password }
    });
    assert.equal(same.status, 400, same.text);

    const weak = await api("/api/auth/change-password", {
      method: "POST",
      token: user.token,
      body: { currentPassword: password, newPassword: "short" }
    });
    assert.equal(weak.status, 400, weak.text);

    const anonymous = await api("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: password, newPassword: "AnotherPass123!" }
    });
    assert.equal(anonymous.status, 401);
  });

  it("changes the password, invalidates old sessions and issues a fresh token", async () => {
    const newPassword = "RotatedPass456!";
    const oldToken = user.token;

    const res = await api("/api/auth/change-password", {
      method: "POST",
      token: oldToken,
      body: { currentPassword: password, newPassword }
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.success, true);
    assert.ok(res.json.token && res.json.token !== oldToken, "a fresh token is required");

    // Old sessions die (stolen-token containment)…
    const stale = await api("/api/auth/me", { token: oldToken });
    assert.equal(stale.status, 401);

    // …but the device that made the change stays signed in.
    const current = await api("/api/auth/me", { token: res.json.token });
    assert.equal(current.status, 200);

    const oldLogin = await api("/api/auth/login", {
      method: "POST",
      body: { email: user.email, password }
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await api("/api/auth/login", {
      method: "POST",
      body: { email: user.email, password: newPassword }
    });
    assert.equal(newLogin.status, 200);

    // Keep the suite's token current for any later test.
    user.token = res.json.token;
    user.password = newPassword;
  });

  it("never leaks password material in the profile response", async () => {
    const res = await api("/api/auth/me", { token: user.token });
    assert.equal(res.status, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(res.json.user, "password"), false);
  });

  // ---------- verification resend ----------
  it("does not reveal whether an address exists or is already verified", async () => {
    helpers.clearOutbox();

    const unknown = await api("/api/auth/resend-verification", {
      method: "POST",
      body: { email: "nobody-here@buyotest.local" }
    });
    assert.equal(unknown.status, 200, unknown.text);
    assert.equal(unknown.json.success, true);

    const verified = await api("/api/auth/resend-verification", {
      method: "POST",
      body: { email: user.email }
    });
    assert.equal(verified.status, 200, verified.text);
    assert.equal(verified.json.message, unknown.json.message, "responses must be identical");
    assert.equal(
      helpers.getOutbox().filter((mail) => mail.to === user.email).length,
      0,
      "a verified account must not receive a verification link"
    );
  });

  it("sends a working link to an unverified account", async () => {
    const email = helpers.uniqueEmail("unverified");
    const signup = await api("/api/auth/signup", {
      method: "POST",
      body: { name: "Not Yet Verified", email, password: "Password123!" }
    });
    assert.equal(signup.status, 201, signup.text);

    helpers.clearOutbox();
    const resend = await api("/api/auth/resend-verification", {
      method: "POST",
      body: { email }
    });
    assert.equal(resend.status, 200, resend.text);

    const mails = helpers.getOutbox().filter((mail) => mail.to === email);
    assert.equal(mails.length, 1);
    const token = helpers.extractTokenFromEmail(mails[0].html, "verify");

    const verify = await api(`/api/auth/verify?token=${encodeURIComponent(token)}`);
    assert.equal(verify.status, 302, verify.text);

    const login = await api("/api/auth/login", {
      method: "POST",
      body: { email, password: "Password123!" }
    });
    assert.equal(login.status, 200, login.text);

    // A second resend for the now-verified account sends nothing.
    helpers.clearOutbox();
    await api("/api/auth/resend-verification", { method: "POST", body: { email } });
    assert.equal(helpers.getOutbox().filter((mail) => mail.to === email).length, 0);
  });

  it("validates the resend payload", async () => {
    const missing = await api("/api/auth/resend-verification", { method: "POST", body: {} });
    assert.equal(missing.status, 400);

    const invalid = await api("/api/auth/resend-verification", {
      method: "POST",
      body: { email: "not-an-email" }
    });
    assert.equal(invalid.status, 400);
  });
});
