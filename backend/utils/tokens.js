// utils/tokens.js
// Central JWT issuing/verification helpers.
//
// Every token carries a `purpose` claim so tokens cannot be swapped between
// flows (access vs email verification vs password reset).
//
// Password-reset tokens are STATELESS and single-use without any schema change:
//   - they embed sha256(user.password) as `pwv`
//   - changing the password (which a successful reset does) makes `pwv` stale,
//     so the same link can never be used twice
//   - they expire via the normal JWT `exp` claim (default 30 minutes)

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ACCESS_TOKEN_TTL = "2h";
const EMAIL_VERIFY_TOKEN_TTL = "24h";
const RESET_TOKEN_TTL = process.env.RESET_TOKEN_TTL || "30m";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured (see backend/.env.example)");
  return secret;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input), "utf8").digest("hex");
}

function signAccessToken(user) {
  return jwt.sign({ id: user.id, purpose: "access" }, getSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

function signEmailVerificationToken(email) {
  return jwt.sign({ email, purpose: "email_verify" }, getSecret(), { expiresIn: EMAIL_VERIFY_TOKEN_TTL });
}

function signPasswordResetToken(user) {
  return jwt.sign(
    { sub: String(user.id), pwv: sha256Hex(user.password), purpose: "password_reset" },
    getSecret(),
    { expiresIn: RESET_TOKEN_TTL }
  );
}

module.exports = {
  sha256Hex,
  signAccessToken,
  signEmailVerificationToken,
  signPasswordResetToken,
  ACCESS_TOKEN_TTL,
  EMAIL_VERIFY_TOKEN_TTL,
  RESET_TOKEN_TTL
};
