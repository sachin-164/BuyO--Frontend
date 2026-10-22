// routes/categoryRoutes.js — catalog categories (Phase 4)
// Public:  GET /  (with product counts).
// Admin:   POST /, PUT /:id, DELETE /:id.
const express = require("express");
const router = express.Router();
const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory
} = require("../controllers/categoryController");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { isValidSlug } = require("../utils/slugify");

function validateSlugField(value) {
  return isValidSlug(value) ? null : "slug must contain only lowercase letters, numbers and hyphens";
}

const nameRule = { type: "string", minLength: 1, maxLength: 100 };
const slugRule = { type: "string", maxLength: 160, validate: validateSlugField };
const descriptionRule = { type: "string", maxLength: 2000 };
const taxRateRule = { type: "number", min: 0, max: 999.99 }; // percentage (e.g. GST), DECIMAL(5,2)
// Optional self-reference. Explicit null = move to root; depth/cycle rules are
// enforced in the controller because they depend on the rest of the tree.
const parentIdRule = { type: "integer", min: 1, max: 2147483647, nullable: true };

// POST: name required; slug auto-generated from name when omitted
const createCategorySchema = {
  name: { required: true, ...nameRule },
  slug: slugRule,
  description: descriptionRule,
  taxRate: taxRateRule,
  parentId: parentIdRule
};

// PUT: everything optional; slug changes only when explicitly provided
// (copy rule objects — sharing references would strip `required`)
const updateCategorySchema = Object.fromEntries(
  Object.entries(createCategorySchema).map(([field, rules]) => [field, { ...rules }])
);
delete updateCategorySchema.name.required;

router.get("/", getCategories);                                              // public
router.post("/", requireAuth, requireAdmin, validateBody(createCategorySchema), createCategory);
router.put("/:id", requireAuth, requireAdmin, validateBody(updateCategorySchema), updateCategory);
router.delete("/:id", requireAuth, requireAdmin, deleteCategory);

module.exports = router;
