const express = require("express");
const router = express.Router();

const userController = require("../controllers/userController");
const { authLimiter } = require("../middleware/rateLimiters");
const { requireAuth } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");

const emailRule = { required: true, type: "email" };
const newPasswordRule = { required: true, type: "password", minLength: 8, maxLength: 72 };

// Public auth endpoints (rate-limited)
router.post(
  "/signup",
  authLimiter,
  validateBody({
    name: { required: true, type: "string", minLength: 1, maxLength: 100 },
    email: emailRule,
    password: newPasswordRule
  }),
  userController.signup
);

router.get("/verify", userController.verify);

router.post(
  "/login",
  authLimiter,
  validateBody({
    email: emailRule,
    // No password policy on login — only type/length sanity checks.
    password: { required: true, type: "password", minLength: 1, maxLength: 200 }
  }),
  userController.login
);

router.post(
  "/forgot-password",
  authLimiter,
  validateBody({ email: emailRule }),
  userController.forgotPassword
);

router.post(
  "/reset-password",
  authLimiter,
  validateBody({
    token: { required: true, type: "string", minLength: 10, maxLength: 4096 },
    password: newPasswordRule
  }),
  userController.resetPassword
);

// Public, rate-limited: sends a fresh verification link to unverified accounts
// only. The response is intentionally identical for every address.
router.post(
  "/resend-verification",
  authLimiter,
  validateBody({ email: emailRule }),
  userController.resendVerification
);

// Authenticated
router.get("/me", requireAuth, userController.me);

router.patch(
  "/me",
  requireAuth,
  validateBody({
    name: { required: true, type: "string", minLength: 1, maxLength: 100 }
  }),
  userController.updateProfile
);

// Rate-limited as well: guessing the current password must not be free.
router.post(
  "/change-password",
  authLimiter,
  requireAuth,
  validateBody({
    currentPassword: { required: true, type: "password", minLength: 1, maxLength: 200 },
    newPassword: newPasswordRule
  }),
  userController.changePassword
);

module.exports = router;
