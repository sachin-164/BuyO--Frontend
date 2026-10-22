// controllers/reviewController.js — customer reviews + admin moderation
// (checklist items 23–25, owner-approved 2026-10-22).
//
// PUBLIC SAFETY
// - Every public read filters status = "approved" at the SQL level. Pending or
//   rejected rows can never leak into a list, a rating aggregate, a count or a
//   product response.
// - Rating aggregates are computed live from approved rows; nothing is cached
//   in Products, so moderation takes effect on the next request.
// - Responses include Cache-Control: no-store. A moderation decision must not
//   be masked by an intermediary cache.
//
// WRITE SAFETY
// - Authentication is required (route middleware). The controller ignores any
//   client-supplied userId/status/verified fields; the review is always created
//   for req.user.id with status "pending".
// - Customers cannot edit or delete reviews. One review per customer/product is
//   enforced by the database unique index as well as a friendly pre-check.
// - Admin moderation requires requireAdmin (route), whitelists the target
//   status, and records moderatedBy/moderatedAt. Repeating the same status is a
//   safe no-op that preserves the original moderator/time.
const { Op, fn, col } = require("sequelize");
const sequelize = require("../config/db");
const Product = require("../models/product");
const ProductReview = require("../models/productReview");
const User = require("../models/user");
const { resolveDialect } = require("../config/dbConnectionOptions");
const { findProductByIdentifier } = require("./productController");

const PUBLIC_DEFAULT_LIMIT = 10;
const PUBLIC_MAX_LIMIT = 50;
const ADMIN_DEFAULT_LIMIT = 20;
const ADMIN_MAX_LIMIT = 100;
const MODERATION_STATUSES = ["approved", "rejected"];
const REVIEW_STATUSES = ["pending", "approved", "rejected"];

function noStore(res) {
  res.set("Cache-Control", "no-store");
}

function pagination(query, defaultLimit, maxLimit) {
  const requestedPage = Number(query.page);
  const requestedLimit = Number(query.limit);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, maxLimit)
      : defaultLimit;
  return { page, limit, offset: (page - 1) * limit };
}

function publicReview(review) {
  return {
    id: review.id,
    rating: Number(review.rating),
    title: review.title || null,
    body: review.body,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    author: {
      // Display name only: no email or account id is exposed publicly.
      name: review.User ? review.User.name : "BuyO customer"
    }
  };
}

function adminReview(review) {
  return {
    id: review.id,
    rating: Number(review.rating),
    title: review.title || null,
    body: review.body,
    status: review.status,
    moderatedBy: review.moderatedBy || null,
    moderatedAt: review.moderatedAt || null,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    product: review.Product
      ? {
          id: review.Product.id,
          name: review.Product.name,
          slug: review.Product.slug,
          image: review.Product.image || null
        }
      : null,
    customer: review.User
      ? {
          id: review.User.id,
          name: review.User.name,
          email: review.User.email
        }
      : null
  };
}

function ownReview(review) {
  return {
    ...adminReview(review),
    product: review.Product
      ? {
          id: review.Product.id,
          name: review.Product.name,
          slug: review.Product.slug,
          image: review.Product.image || null
        }
      : null
  };
}

function isDuplicateReview(error) {
  if (!error || error.name !== "SequelizeUniqueConstraintError") return false;
  const text = [
    error.message,
    error.parent && error.parent.message,
    error.original && error.original.message,
    error.parent && error.parent.sqlMessage,
    ...Object.keys(error.fields || {})
  ]
    .filter(Boolean)
    .join(" | ");
  return /uq_product_reviews_user_product/i.test(text);
}

// ---------- GET /api/products/:identifier/reviews (public, approved only) ----------
const getProductReviews = async (req, res) => {
  try {
    noStore(res);
    const product = await findProductByIdentifier(req.params.identifier, { attributes: ["id"] });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const { page, limit, offset } = pagination(req.query, PUBLIC_DEFAULT_LIMIT, PUBLIC_MAX_LIMIT);
    const where = { productId: product.id, status: "approved" };

    const [aggregate, distributionRows, total, rows] = await Promise.all([
      ProductReview.findOne({
        attributes: [
          [fn("COUNT", col("id")), "count"],
          [fn("AVG", col("rating")), "average"]
        ],
        where,
        raw: true
      }),
      ProductReview.findAll({
        attributes: ["rating", [fn("COUNT", col("id")), "count"]],
        where,
        group: ["rating"],
        raw: true
      }),
      ProductReview.count({ where }),
      ProductReview.findAll({
        where,
        include: [{ model: User, as: "User", attributes: ["name"] }],
        order: [
          ["createdAt", "DESC"],
          ["id", "DESC"]
        ],
        limit,
        offset
      })
    ]);

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of distributionRows) {
      const rating = Number(row.rating);
      if (distribution[rating] !== undefined) distribution[rating] = Number(row.count);
    }
    const count = Number(aggregate ? aggregate.count : 0) || 0;
    const average = count > 0 ? Number(aggregate.average) : null;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      success: true,
      productId: product.id,
      count: rows.length,
      reviews: rows.map(publicReview),
      summary: {
        count,
        average: average === null ? null : Math.round(average * 100) / 100,
        distribution
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error("❌ Error fetching product reviews:", error);
    res.status(500).json({ success: false, message: "Error fetching product reviews" });
  }
};

// ---------- POST /api/products/:identifier/reviews (authenticated) ----------
const createReview = async (req, res) => {
  try {
    noStore(res);
    const product = await findProductByIdentifier(req.params.identifier, { attributes: ["id"] });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // Whitelist: everything else in the body (status, userId, verifiedPurchase,
    // moderatedBy, ...) is ignored by construction.
    const rating = Number(req.body.rating);
    const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
    const title =
      typeof req.body.title === "string" && req.body.title.trim() ? req.body.title.trim() : null;

    const errors = [];
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      errors.push("Rating must be a whole number from 1 to 5");
    }
    if (body.length < 10) errors.push("Review must be at least 10 characters");
    if (body.length > 2000) errors.push("Review must be 2000 characters or fewer");
    if (title && title.length > 120) errors.push("Title must be 120 characters or fewer");
    if (errors.length) {
      return res.status(400).json({ success: false, message: "Validation failed", errors });
    }

    const existing = await ProductReview.findOne({
      where: { userId: req.user.id, productId: product.id },
      attributes: ["id"]
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        code: "REVIEW_EXISTS",
        message: "You have already reviewed this product"
      });
    }

    let review;
    try {
      review = await ProductReview.create({
        productId: product.id,
        userId: req.user.id,
        rating,
        title,
        body,
        // Forced server-side, regardless of the request payload.
        status: "pending",
        moderatedBy: null,
        moderatedAt: null
      });
    } catch (error) {
      if (isDuplicateReview(error)) {
        return res.status(409).json({
          success: false,
          code: "REVIEW_EXISTS",
          message: "You have already reviewed this product"
        });
      }
      throw error;
    }

    res.status(201).json({
      success: true,
      message: "Thanks! Your review is pending approval.",
      review: {
        id: review.id,
        productId: review.productId,
        rating: Number(review.rating),
        title: review.title || null,
        body: review.body,
        status: review.status,
        createdAt: review.createdAt
      }
    });
  } catch (error) {
    console.error("❌ Error creating review:", error);
    res.status(500).json({ success: false, message: "Error creating review" });
  }
};

// ---------- GET /api/reviews/mine (authenticated; own reviews incl. pending) ----------
const getMyReviews = async (req, res) => {
  try {
    noStore(res);
    const where = { userId: req.user.id };
    if (req.query.productId !== undefined) {
      const productId = Number(req.query.productId);
      if (!Number.isInteger(productId) || productId <= 0 || productId > 2147483647) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: ["Invalid productId"]
        });
      }
      where.productId = productId;
    }

    const reviews = await ProductReview.findAll({
      where,
      include: [
        { model: Product, attributes: ["id", "name", "slug", "image"] },
        { model: User, as: "Moderator", attributes: ["id", "name"], required: false }
      ],
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"]
      ],
      limit: 100
    });

    res.json({
      success: true,
      count: reviews.length,
      reviews: reviews.map((review) => ({
        ...ownReview(review),
        moderator: review.Moderator ? { id: review.Moderator.id, name: review.Moderator.name } : null
      }))
    });
  } catch (error) {
    console.error("❌ Error fetching own reviews:", error);
    res.status(500).json({ success: false, message: "Error fetching your reviews" });
  }
};

// ---------- GET /api/admin/reviews (admin moderation queue) ----------
const listAdminReviews = async (req, res) => {
  try {
    noStore(res);
    const status = req.query.status === undefined ? "pending" : String(req.query.status);
    if (![...REVIEW_STATUSES, "all"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: ["status must be pending, approved, rejected or all"]
      });
    }
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const { page, limit, offset } = pagination(req.query, ADMIN_DEFAULT_LIMIT, ADMIN_MAX_LIMIT);

    const where = {};
    if (status !== "all") where.status = status;
    if (q) {
      const like = `%${q}%`;
      const searchOp = resolveDialect() === "postgres" ? Op.iLike : Op.like;
      where[Op.or] = [
        { title: { [searchOp]: like } },
        { body: { [searchOp]: like } },
        { "$Product.name$": { [searchOp]: like } },
        { "$User.name$": { [searchOp]: like } }
      ];
    }

    const include = [
      {
        model: Product,
        attributes: ["id", "name", "slug", "image"],
        // A text search on product/customer must not silently hide rows.
        required: Boolean(q)
      },
      { model: User, as: "User", attributes: ["id", "name", "email"], required: false }
    ];

    const { count, rows } = await ProductReview.findAndCountAll({
      where,
      include,
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"]
      ],
      limit,
      offset,
      distinct: true
    });

    const countRows = await ProductReview.findAll({
      attributes: ["status", [fn("COUNT", col("id")), "count"]],
      group: ["status"],
      raw: true
    });
    const statusCounts = { pending: 0, approved: 0, rejected: 0 };
    for (const row of countRows) {
      if (statusCounts[row.status] !== undefined) statusCounts[row.status] = Number(row.count);
    }

    const totalPages = Math.max(1, Math.ceil(count / limit));
    res.json({
      success: true,
      count: rows.length,
      reviews: rows.map(adminReview),
      statusCounts,
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error("❌ Error fetching review queue:", error);
    res.status(500).json({ success: false, message: "Error fetching review queue" });
  }
};

// ---------- PATCH /api/admin/reviews/:id (admin moderation) ----------
const moderateReview = async (req, res) => {
  try {
    noStore(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: ["Invalid review id"]
      });
    }

    const status = req.body.status;
    if (!MODERATION_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: ["status must be approved or rejected"]
      });
    }

    const outcome = await sequelize.transaction(async (transaction) => {
      const review = await ProductReview.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!review) return null;

      if (review.status === status) {
        // Safe repeated moderation: never overwrite the original moderator or
        // timestamp, and never fail a double-click.
        return { review, unchanged: true };
      }

      await review.update(
        {
          status,
          moderatedBy: req.user.id,
          moderatedAt: new Date()
        },
        { transaction }
      );
      return { review, unchanged: false };
    });

    if (!outcome) {
      return res.status(404).json({ success: false, message: "Review not found" });
    }

    res.json({
      success: true,
      unchanged: outcome.unchanged,
      message: outcome.unchanged
        ? `Review is already ${status}`
        : status === "approved"
          ? "Review approved"
          : "Review rejected",
      review: {
        id: outcome.review.id,
        productId: outcome.review.productId,
        status: outcome.review.status,
        moderatedBy: outcome.review.moderatedBy || null,
        moderatedAt: outcome.review.moderatedAt || null,
        updatedAt: outcome.review.updatedAt
      }
    });
  } catch (error) {
    console.error("❌ Error moderating review:", error);
    res.status(500).json({ success: false, message: "Error moderating review" });
  }
};

module.exports = {
  getProductReviews,
  createReview,
  getMyReviews,
  listAdminReviews,
  moderateReview
};
