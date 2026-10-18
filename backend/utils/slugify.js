// utils/slugify.js
// URL-safe slugs for products and categories (used by the API layer).
// Legacy rows are backfilled by migration 003 with "<base>-p<id>" style slugs,
// which are collision-free by construction; new rows get clean slugs here.

// Valid slugs: lowercase letters/digits joined by single hyphens (no edges).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
}

// Finds a free slug on `model` by suffixing -2, -3, ... (writes here are
// admin-frequency, so a small query loop is fine and always terminates).
async function uniqueSlug(model, base, fallback = "item") {
  const root = slugify(base) || fallback;
  let candidate = root;
  let counter = 1;
  while (await model.findOne({ where: { slug: candidate }, attributes: ["id"] })) {
    counter += 1;
    candidate = `${root}-${counter}`;
  }
  return candidate;
}

function isValidSlug(value) {
  return typeof value === "string" && value.length <= 160 && SLUG_RE.test(value);
}

module.exports = { slugify, uniqueSlug, isValidSlug, SLUG_RE };
