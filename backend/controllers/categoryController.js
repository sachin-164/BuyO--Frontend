// controllers/categoryController.js — category API (Phase 4)
// Public: list (with product counts).
// Admin: create / update / delete (routed with requireAuth + requireAdmin).
// Deleting a category never deletes products: the FK is ON DELETE SET NULL and
// the legacy free-text Products.category string is preserved.
const { Op, fn, col, where } = require("sequelize");
const Category = require("../models/category");
const Product = require("../models/product");
const { resolveDialect } = require("../config/dbConnectionOptions");
const { slugify, uniqueSlug } = require("../utils/slugify");
const { uniqueConflictMessage } = require("../utils/uniqueErrors");

function isValidId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647;
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

    res.json({
      success: true,
      count: categories.length,
      categories: categories.map((category) => ({
        ...category.toJSON(),
        productCount: countByCategory.get(category.id) || 0
      }))
    });
  } catch (error) {
    console.error("❌ Error fetching categories:", error);
    res.status(500).json({ success: false, message: "Error fetching categories" });
  }
};

// ---------- Create Category (POST /api/categories, admin-only) ----------
const createCategory = async (req, res) => {
  try {
    const { name, slug, description, taxRate } = req.body;

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
      taxRate: taxRate === undefined ? 0.0 : taxRate
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

    const affectedProducts = await Product.count({ where: { categoryId: category.id } });
    await category.destroy(); // FK ON DELETE SET NULL: products unlink, legacy strings kept

    res.json({
      success: true,
      message: "Category deleted",
      affectedProducts
    });
  } catch (error) {
    console.error("❌ Error deleting category:", error);
    res.status(500).json({ success: false, message: "Error deleting category" });
  }
};

module.exports = { getCategories, createCategory, updateCategory, deleteCategory };
