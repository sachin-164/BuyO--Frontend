// routes/reviewRoutes.js — customer review self-service.
// Mounted at /api/reviews. Only the signed-in customer's own reviews are
// returned, including pending/rejected ones; there is deliberately no public
// route here.
const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { validateQuery } = require("../middleware/validate");
const { getMyReviews } = require("../controllers/reviewController");

const myReviewsQuerySchema = {
  productId: { type: "integer", min: 1, max: 2147483647 }
};

router.get("/mine", requireAuth, validateQuery(myReviewsQuerySchema), getMyReviews);

module.exports = router;
