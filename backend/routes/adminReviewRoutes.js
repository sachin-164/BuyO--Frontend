// routes/adminReviewRoutes.js — admin review moderation.
// Mounted at /api/admin/reviews. requireAuth + requireAdmin are applied to
// every route, including reads: a customer must never see other customers'
// pending reviews or moderation metadata.
const express = require("express");
const router = express.Router();
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { validateBody, validateQuery } = require("../middleware/validate");
const {
  listAdminReviews,
  moderateReview
} = require("../controllers/reviewController");

const listQuerySchema = {
  status: {
    type: "string",
    maxLength: 16,
    validate: (value) =>
      ["pending", "approved", "rejected", "all"].includes(value)
        ? null
        : "status must be pending, approved, rejected or all"
  },
  q: { type: "string", maxLength: 100 },
  page: { type: "integer", min: 1, max: 100000000 },
  limit: { type: "integer", min: 1, max: 100 }
};

const moderateSchema = {
  status: {
    required: true,
    type: "string",
    validate: (value) =>
      ["approved", "rejected"].includes(value) ? null : "status must be approved or rejected"
  }
};

router.get("/", requireAuth, requireAdmin, validateQuery(listQuerySchema), listAdminReviews);
router.patch("/:id", requireAuth, requireAdmin, validateBody(moderateSchema), moderateReview);

module.exports = router;
