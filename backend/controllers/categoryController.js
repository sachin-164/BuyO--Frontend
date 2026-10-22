// controllers/categoryController.js — category API (Phase 4)
// Public: list (with product counts).
// Admin: create / update / delete (routed with requireAuth + requireAdmin).
// Deleting a category never deletes products: the FK is ON DELETE SET NULL and
// the legacy free-text Products.category string is preserved.
const { Op, fn, col, where } = require("sequelize");
const sequelize = require("../config/db");
const Category = require("../models/category");
const Product = require("../models/product");
const { resolveDialect } = require("../config/dbConnectionOptions");
const { slugify, uniqueSlug } = require("../utils/slugify");
const { uniqueConflictMessage } = require("../utils/uniqueErrors");

// The taxonomy is intentionally shallow: a root can own children and a child
// can own grandchildren, but nothing deeper. Every write validates the FULL
// resulting subtree height, not just the parent's own depth.
const MAX_CATEGORY_DEPTH = 3;

function isValidId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647;
}

function hierarchyError(status, code, message) {
  return { status, code, message };
}

// One query for the whole parent map + child index. Used by write validation
// (and by the delete path) so cycle/depth rules never need per-node queries.
async function loadParentIndex() {
  const rows = await Category.findAll({ attributes: ["id", "parentId"] });
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId ?? null]));
  const childrenOf = new Map(rows.map((row) => [row.id, []]));
  for (const row of rows) {
    const parentId = parentOf.get(row.id);
    if (parentId !== null && childrenOf.has(parentId)) childrenOf.get(parentId).push(row.id);
  }
  return { parentOf, childrenOf };
}

// Depth of an existing node (root = 1). null when stored data contains a cycle.
function lineageDepth(id, parentOf) {
  let depth = 1;
  let current = parentOf.get(id) ?? null;
  const seen = new Set([id]);
  while (current !== null) {
    if (seen.has(current)) return null;
    seen.add(current);
    depth += 1;
    current = parentOf.get(current) ?? null;
  }
  return depth;
}

// Height of the subtree rooted at `id` (leaf = 1). null when a cycle exists.
function subtreeHeight(id, childrenOf) {
  let height = 0;
  const stack = [[id, 1]];
  const seen = new Set();
  while (stack.length) {
    const [node, level] = stack.pop();
    if (seen.has(node)) return null;
    seen.add(node);
    height = Math.max(height, level);
    for (const child of childrenOf.get(node) ?? []) stack.push([child, level + 1]);
  }
  return height;
}

// Returns null when the placement is legal, otherwise an error descriptor.
// Rules: parent must exist; a category can never be its own ancestor; and the
// moved subtree's height plus the parent's depth must fit inside MAX_DEPTH.
function validateParentPlacement({ parentId, categoryId, parentOf, childrenOf }) {
  if (parentId === null || parentId === undefined) return null;

  if (!parentOf.has(parentId)) {
    return hierarchyError(400, "CATEGORY_PARENT_NOT_FOUND", "Parent category does not exist");
  }

  if (categoryId !== null && categoryId !== undefined) {
    if (parentId === categoryId) {
      return hierarchyError(400, "CATEGORY_CYCLE", "A category cannot be its own parent");
    }
    let current = parentId;
    const seen = new Set([categoryId]);
    while (current !== null) {
      if (current === categoryId) {
        return hierarchyError(
          400,
          "CATEGORY_CYCLE",
          "A category cannot be moved under its own descendant"
        );
      }
      if (seen.has(current)) {
        return hierarchyError(
          400,
          "CATEGORY_HIERARCHY_INVALID",
          "The category hierarchy currently contains a cycle; fix it before moving this category"
        );
      }
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
  }

  const parentDepth = lineageDepth(parentId, parentOf);
  const height = categoryId === null || categoryId === undefined ? 1 : subtreeHeight(categoryId, childrenOf);
  if (parentDepth === null || height === null) {
    return hierarchyError(
      400,
      "CATEGORY_HIERARCHY_INVALID",
      "The category hierarchy currently contains a cycle; fix it before changing parents"
    );
  }
  if (parentDepth + height > MAX_CATEGORY_DEPTH) {
    return hierarchyError(
      400,
      "CATEGORY_DEPTH_EXCEEDED",
      `Categories can be nested at most ${MAX_CATEGORY_DEPTH} levels deep`
    );
  }
  return null;
}

// Case-insensitive category-name lookup. MySQL's default collation already
// compares names case-insensitively (the plain { name } query is kept there,
// byte-identical), while PostgreSQL compares case-sensitively. The public
// contract — duplicate name -> 409 regardless of case — must hold on both,
// so PG uses an explicit LOWER() comparison.
async function findCategoryByName(name) {
  if (resolveDialect() === "postgres") {
    return Category.findOne({
      where: where(fn("LOWER", col("name")), String(name).toLowerCase()),
      attributes: ["id"]
    });
  }
  return Category.findOne({ where: { name }, attributes: ["id"] });
}

// ---------- List Categories (GET /api/categories, public) ----------
// The flat `categories` array stays exactly as before (same ordering, same
// fields) plus parentId/depth/rollup counts; `tree` is derived from it. One
// query for rows and one grouped query for counts — never N+1.
const getCategories = async (req, res) => {
  try {
    const categories = await Category.findAll({ order: [["name", "ASC"], ["id", "ASC"]] });

    // One grouped query for product counts (products without a link are skipped).
    const counts = await Product.findAll({
      attributes: ["categoryId", [fn("COUNT", col("id")), "productCount"]],
      where: { categoryId: { [Op.ne]: null } },
      group: ["categoryId"],
      raw: true
    });
    const countByCategory = new Map(counts.map((row) => [row.categoryId, Number(row.productCount)]));

    const rows = categories.map((category) => category.toJSON());
    const parentOf = new Map(rows.map((row) => [row.id, row.parentId ?? null]));

    // Depth with memoization; any cycle is a data fault, surfaced as an error
    // instead of an infinitely recursive payload.
    const depthCache = new Map();
    function depthOf(id) {
      if (depthCache.has(id)) return depthCache.get(id);
      const chain = [];
      const seen = new Set();
      let current = id;
      let base = 0;
      while (current !== null && !depthCache.has(current)) {
        if (seen.has(current)) {
          for (const node of chain) depthCache.set(node, null);
          return null;
        }
        seen.add(current);
        chain.push(current);
        current = parentOf.get(current) ?? null;
      }
      if (current !== null && depthCache.has(current)) base = depthCache.get(current) ?? 0;
      for (let index = chain.length - 1; index >= 0; index -= 1) {
        base += 1;
        depthCache.set(chain[index], base);
      }
      return depthCache.get(id);
    }

    const depths = new Map(rows.map((row) => [row.id, depthOf(row.id)]));
    if ([...depths.values()].some((depth) => depth === null)) {
      throw new Error("Category hierarchy contains a cycle");
    }

    const childrenOf = new Map(rows.map((row) => [row.id, []]));
    const roots = [];
    for (const row of rows) {
      const parentId = parentOf.get(row.id);
      if (parentId !== null && childrenOf.has(parentId)) childrenOf.get(parentId).push(row);
      else roots.push(row);
    }

    const totals = new Map();
    function totalFor(row) {
      if (totals.has(row.id)) return totals.get(row.id);
      let total = countByCategory.get(row.id) || 0;
      for (const child of childrenOf.get(row.id) ?? []) total += totalFor(child);
      totals.set(row.id, total);
      return total;
    }

    const flat = rows.map((row) => ({
      ...row,
      productCount: countByCategory.get(row.id) || 0,
      totalProductCount: totalFor(row),
      depth: depths.get(row.id)
    }));
    const flatById = new Map(flat.map((row) => [row.id, row]));

    function toNode(row) {
      return {
        ...flatById.get(row.id),
        children: (childrenOf.get(row.id) ?? []).map(toNode)
      };
    }

    res.json({
      success: true,
      count: flat.length,
      maxDepth: MAX_CATEGORY_DEPTH,
      categories: flat,
      tree: roots.map(toNode)
    });
  } catch (error) {
    console.error("❌ Error fetching categories:", error);
    res.status(500).json({ success: false, message: "Error fetching categories" });
  }
};

// ---------- Create Category (POST /api/categories, admin-only) ----------
const createCategory = async (req, res) => {
  try {
    const { name, slug, description, taxRate, parentId } = req.body;

    // Hierarchy rules are enforced before any row is written.
    const { parentOf, childrenOf } = await loadParentIndex();
    const placementError = validateParentPlacement({
      parentId: parentId ?? null,
      categoryId: null,
      parentOf,
      childrenOf
    });
    if (placementError) {
      return res.status(placementError.status).json({
        success: false,
        code: placementError.code,
        message: placementError.message
      });
    }

    const categorySlug = slug || await uniqueSlug(Category, slugify(name), "category");

    const nameExists = await findCategoryByName(name);
    if (nameExists) {
      return res.status(409).json({ success: false, message: "A category with that name already exists" });
    }
    const slugExists = await Category.findOne({ where: { slug: categorySlug }, attributes: ["id"] });
    if (slugExists) {
      return res.status(409).json({ success: false, message: "A category with that slug already exists" });
    }

    const category = await Category.create({
      name,
      slug: categorySlug,
      description,
      taxRate: taxRate === undefined ? 0.0 : taxRate,
      parentId: parentId ?? null
    });

    res.status(201).json({ success: true, message: "Category created", category });
  } catch (error) {
    const conflict = uniqueConflictMessage(error, "category");
    if (conflict) return res.status(409).json({ success: false, message: conflict });
    console.error("❌ Error creating category:", error);
    res.status(500).json({ success: false, message: "Error creating category" });
  }
};

// ---------- Update Category (PUT /api/categories/:id, admin-only) ----------
const updateCategory = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid category id" });
    }
    const id = Number(req.params.id);
    const category = await Category.findByPk(id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const updates = { ...req.body };
    // Empty string = no change (validation keeps optional strings as "").
    if (Object.prototype.hasOwnProperty.call(updates, "slug") && !updates.slug) delete updates.slug;
    if (Object.prototype.hasOwnProperty.call(updates, "description") && updates.description === "") delete updates.description;

    if (!Object.keys(updates).length) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: ["No fields to update"]
      });
    }

    // Moving a category is validated against its WHOLE subtree: the move may
    // not create a cycle and may not push descendants past the depth limit.
    if (Object.prototype.hasOwnProperty.call(updates, "parentId")) {
      const { parentOf, childrenOf } = await loadParentIndex();
      const placementError = validateParentPlacement({
        parentId: updates.parentId ?? null,
        categoryId: category.id,
        parentOf,
        childrenOf
      });
      if (placementError) {
        return res.status(placementError.status).json({
          success: false,
          code: placementError.code,
          message: placementError.message
        });
      }
    }

    if (updates.name !== undefined) {
      const clash = await findCategoryByName(updates.name);
      if (clash && clash.id !== category.id) {
        return res.status(409).json({ success: false, message: "A category with that name already exists" });
      }
    }
    if (updates.slug !== undefined) {
      const clash = await Category.findOne({ where: { slug: updates.slug }, attributes: ["id"] });
      if (clash && clash.id !== category.id) {
        return res.status(409).json({ success: false, message: "A category with that slug already exists" });
      }
    }

    await category.update(updates);
    res.json({ success: true, message: "Category updated", category });
  } catch (error) {
    const conflict = uniqueConflictMessage(error, "category");
    if (conflict) return res.status(409).json({ success: false, message: conflict });
    console.error("❌ Error updating category:", error);
    res.status(500).json({ success: false, message: "Error updating category" });
  }
};

// ---------- Delete Category (DELETE /api/categories/:id, admin-only) ----------
const deleteCategory = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid category id" });
    }
    const id = Number(req.params.id);
    const category = await Category.findByPk(id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    // Children are promoted to roots (the FK rule is ON DELETE SET NULL) and
    // products unlink (FK ON DELETE SET NULL); the legacy free-text category
    // string on those products is preserved. Both happen in one transaction.
    let affectedProducts = 0;
    let reparentedChildren = 0;
    await sequelize.transaction(async (transaction) => {
      affectedProducts = await Product.count({ where: { categoryId: category.id }, transaction });
      reparentedChildren = await Category.count({ where: { parentId: category.id }, transaction });
      // Explicit promotion keeps this correct even before migration 009 has
      // added the self-FK, and is a no-op once it exists.
      await Category.update({ parentId: null }, { where: { parentId: category.id }, transaction });
      await category.destroy({ transaction });
    });

    res.json({
      success: true,
      message: "Category deleted",
      affectedProducts,
      reparentedChildren
    });
  } catch (error) {
    console.error("❌ Error deleting category:", error);
    res.status(500).json({ success: false, message: "Error deleting category" });
  }
};

module.exports = { getCategories, createCategory, updateCategory, deleteCategory };
