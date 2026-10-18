const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const { sendMail } = require("../utils/mailer");
const { sha256Hex, signAccessToken, signEmailVerificationToken, signPasswordResetToken } = require("../utils/tokens");
const { isAdminUser } = require("../utils/roles");

// Used to equalise response timing when an account does not exist
// (anti user-enumeration). Computed once at module load.
const DUMMY_HASH = bcrypt.hashSync("buyo-dummy-password", 10);

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isVerified: user.isVerified,
    role: user.role,
    isAdmin: isAdminUser(user)
  };
}

// ---------- SIGNUP FUNCTION ----------
// Body is validated + normalised by middleware/validate.js (name, email, password).
const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // Public signup can ONLY create customers. Admins are granted exclusively via
    // the audited provisioning script (scripts/admin-role.js), never via this API.

    const token = signEmailVerificationToken(email);
    const verifyLink = `${process.env.BACKEND_URL}/api/auth/verify?token=${token}`;

    let createdUser = null;
    try {
      createdUser = await User.create({ name, email, password: hashedPassword, isVerified: false, role: "customer" });

      await sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Verify Your Email",
        html: `<p>Click <a href="${verifyLink}">here</a> to verify your email.</p>
               <p>This link will expire in 24 hours.</p>`
      });
    } catch (createOrMailErr) {
      // Phase 11: if anything fails AFTER the row was created (typically SMTP),
      // remove the just-created account so the user isn't left locked out of an
      // unverifiable account with no resend-verification endpoint. They can
      // simply retry signup.
      if (createdUser) {
        try {
          await createdUser.destroy();
        } catch (cleanupErr) {
          console.error("Signup cleanup failed (account may remain, unverified):", cleanupErr);
        }
      }
      if (createOrMailErr.name === "SequelizeUniqueConstraintError") {
        // Lost a race against a concurrent signup with the same email.
        return res.status(400).json({ success: false, message: "User already exists" });
      }
      console.error("Signup mail failure (account rolled back):", createOrMailErr);
      return res.status(503).json({
        success: false,
        message: "We couldn't send the verification email. Please try again in a moment."
      });
    }

    res.status(201).json({ success: true, message: "Signup successful! Check your email for verification." });
  } catch (err) {
    if (err.name === "SequelizeUniqueConstraintError") {
      // Lost a race against a concurrent signup with the same email.
      return res.status(400).json({ success: false, message: "User already exists" });
    }
    console.error("Signup error:", err);
    res.status(500).json({ success: false, message: "Signup failed. Please try again later." });
  }
};

// ---------- VERIFY FUNCTION ----------
const verify = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== "string") {
      return res.status(400).send("Verification token is missing.");
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(400).send("Verification link has expired. Please request a new one.");
      }
      return res.status(400).send("Invalid verification link.");
    }

    // New tokens carry purpose "email_verify"; legacy tokens only have `email`.
    // Tokens for other flows (e.g. password reset) are rejected here.
    if (!decoded.email || (decoded.purpose && decoded.purpose !== "email_verify")) {
      return res.status(400).send("Invalid verification link.");
    }

    const email = String(decoded.email).toLowerCase();
    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.error(`Verification error: user ${email} not found.`);
      return res.status(404).send("Verification failed: User not found.");
    }

    // FRONTEND_URL guard (Phase 11): if it is unset/misconfigured, never emit a
    // redirect to "undefined/...". Plain text keeps the outcome readable.
    const redirectTo = (status) => {
      const base = process.env.FRONTEND_URL;
      if (!base) return null;
      return `${base.replace(/\/+$/, "")}/login.html?status=${status}`;
    };

    if (user.isVerified) {
      const target = redirectTo("already_verified");
      return target
        ? res.redirect(target)
        : res.send("This email is already verified. You can sign in.");
    }

    await user.update({ isVerified: true });
    console.log(`✅ User ${email} verified`);

    const successTarget = redirectTo("success");
    return successTarget
      ? res.redirect(successTarget)
      : res.send("Email verified successfully. You can now sign in.");
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).send("An unexpected error occurred during verification.");
  }
};

// ---------- LOGIN FUNCTION ----------
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const genericFailure = { success: false, message: "Invalid email or password." };

    const user = await User.findOne({ where: { email } });
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH); // equalise timing
      return res.status(401).json(genericFailure);
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json(genericFailure);

    // Only revealed after the password is proven correct.
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Email not verified. Please check your inbox for the verification link."
      });
    }

    const authToken = signAccessToken(user);
    res.json({ success: true, message: "Login successful", token: authToken, user: publicUser(user) });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Login failed. Please try again later." });
  }
};

// ---------- FORGOT PASSWORD ----------
const FORGOT_PASSWORD_MESSAGE = "If an account exists for that email, a password reset link has been sent.";

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ where: { email } });

    if (user) {
      const token = signPasswordResetToken(user);
      const resetLink = `${process.env.FRONTEND_URL}/reset-password.html?token=${token}`;
      await sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Reset your BuyO password",
        html: `<p>Click <a href="${resetLink}">here</a> to reset your BuyO password.</p>
               <p>This link expires in 30 minutes and can only be used once.</p>
               <p>If you did not request this, you can safely ignore this email.</p>`
      });
    } else {
      await bcrypt.hash("buyo-dummy-password", 10); // equalise timing
    }

    res.status(200).json({ success: true, message: FORGOT_PASSWORD_MESSAGE });
  } catch (err) {
    // Never reveal account existence — even when mail delivery fails.
    console.error("Forgot password error:", err);
    res.status(200).json({ success: true, message: FORGOT_PASSWORD_MESSAGE });
  }
};

// ---------- RESET PASSWORD ----------
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    const invalidLink = () =>
      res.status(400).json({ success: false, message: "Invalid or expired reset link." });
    const usedLink = () =>
      res.status(400).json({ success: false, message: "This reset link has already been used or is no longer valid." });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    } catch {
      return invalidLink();
    }

    if (decoded.purpose !== "password_reset" || !decoded.sub || !decoded.pwv) return invalidLink();

    const user = await User.findByPk(Number(decoded.sub));
    if (!user) return invalidLink();

    // Stateless single-use: the token only matches while the password is unchanged.
    if (sha256Hex(user.password) !== decoded.pwv) return usedLink();

    const newHash = await bcrypt.hash(password, 10);

    // Atomic compare-and-swap: only the first concurrent request wins.
    const [affected] = await User.update(
      { password: newHash },
      { where: { id: user.id, password: user.password } }
    );
    if (affected === 0) return usedLink();

    res.json({ success: true, message: "Password updated. You can now sign in." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ success: false, message: "Password reset failed. Please try again later." });
  }
};

// ---------- ME (requires auth middleware) ----------
const me = async (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
};

module.exports = { signup, verify, login, forgotPassword, resetPassword, me };
