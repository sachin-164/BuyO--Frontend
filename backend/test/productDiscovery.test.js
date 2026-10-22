// test/productDiscovery.test.js — Phase F (checklist items 26–27)
//
// GET /api/products/suggestions?q=  — bounded typeahead over product names
// GET /api/products/:identifier/related — same-category siblings
//
// Both endpoints must be honest: no invented products, deterministic order,
// literal LIKE handling, and no work for queries that cannot match.
//
// SAFETY: shared harness — scratch test DB only (buyoDB_ph2_test).

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");

describe("Catalog discovery (Phase F)", () => {
  let ctx;
  let admin;
  let steel;
  let lighting;
  let created = [];

  const api = (pathname, options) => helpers.api(ctx.baseUrl, pathname, options);

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);

    const makeCategory = async (name, slug) => {
      const res = await api("/api/categories", {
        method: "POST",
        token: admin.token,
        body: { name, slug }
      });
      assert.equal(res.status, 201, res.text);
      return res.json.category;
    };
    steel = await makeCategory("Discovery Steel", "discovery-steel");
    lighting = await makeCategory("Discovery Lighting", "discovery-lighting");
  });

  after(async () => {
    for (const id of created) {
      await api(`/api/products/${id}`, { method: "DELETE", token: admin.token });
    }
    await ctx.close();
  });

  async function freshCategory(label) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}-${created.length}`;
    const res = await api("/api/categories", {
      method: "POST",
      token: admin.token,
      body: { name: `${label} ${suffix}`, slug: `${label.toLowerCase()}-${suffix}` }
    });
    assert.equal(res.status, 201, res.text);
    return res.json.category;
  }

  async function product(overrides = {}) {
    const { cat = steel, ...rest } = overrides;
    const res = await api("/api/products", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Discovery ${created.length}`,
        category: cat.name,
        categoryId: cat.id,
        mrpPrice: 500,
        sellingPrice: 400,
        stock: 5,
        ...rest
      }
    });
    assert.equal(res.status, 201, res.text);
    created.push(res.json.product.id);
    return res.json.product;
  }

  describe("suggestions", () => {
    it("returns nothing for a query shorter than two characters", async () => {
      await product({ name: "Aurora Bottle" });

      for (const q of ["", "a", "   "]) {
        const res = await api(`/api/products/suggestions?q=${encodeURIComponent(q)}`);
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(res.json.suggestions, []);
        assert.equal(res.json.count, 0);
      }

      const missing = await api("/api/products/suggestions");
      assert.equal(missing.status, 200);
      assert.deepEqual(missing.json.suggestions, []);
    });

    it("matches name substrings case-insensitively and returns only suggestion fields", async () => {
      const bottle = await product({ name: "Zephyr Steel Bottle" });
      await product({ name: "Zephyr Desk Lamp", category: lighting.name, categoryId: lighting.id });
      await product({ name: "Bamboo Serving Tray" });

      const lower = await api("/api/products/suggestions?q=zephyr");
      assert.equal(lower.status, 200, lower.text);
      assert.equal(lower.json.count, 2);
      assert.deepEqual(
        lower.json.suggestions.map((entry) => entry.name),
        ["Zephyr Desk Lamp", "Zephyr Steel Bottle"]
      );

      const upper = await api("/api/products/suggestions?q=ZEPHYR%20STEEL");
      assert.equal(upper.status, 200, upper.text);
      assert.equal(upper.json.count, 1);
      assert.deepEqual(upper.json.suggestions[0], {
        id: bottle.id,
        slug: bottle.slug,
        name: "Zephyr Steel Bottle",
        price: 400,
        image: ""
      });
    });

    it("treats LIKE metacharacters literally", async () => {
      const percent = await product({ name: "50% Off Steel Mug" });

      const exact = await api("/api/products/suggestions?q=0%25");
      assert.equal(exact.status, 200, exact.text);
      assert.equal(exact.json.count, 1);
      assert.equal(exact.json.suggestions[0].id, percent.id);

      // "%" alone is too short; "%%" must not act as "match everything".
      const wildcard = await api("/api/products/suggestions?q=%25%25");
      assert.equal(wildcard.status, 200, wildcard.text);
      assert.equal(wildcard.json.count, 0);

      // Underscore is a single-character LIKE wildcard and is stripped too.
      const underscore = await api("/api/products/suggestions?q=0__");
      assert.equal(underscore.status, 200, underscore.text);
      assert.equal(underscore.json.count, 0);
    });

    it("does not match the description, only the product name", async () => {
      await product({ name: "Midnight Travel Flask", description: "Aurora-grade insulation" });

      const byDescription = await api("/api/products/suggestions?q=aurora-grade");
      assert.equal(byDescription.status, 200, byDescription.text);
      assert.equal(byDescription.json.count, 0);
    });

    it("caps the list at eight suggestions", async () => {
      for (let index = 0; index < 10; index += 1) {
        await product({ name: `Capsule Item ${index}` });
      }

      const res = await api("/api/products/suggestions?q=Capsule");
      assert.equal(res.status, 200, res.text);
      assert.equal(res.json.count, 8);
      assert.ok(res.json.suggestions.length <= 8);
      // Name-ordered, deterministic.
      assert.deepEqual(
        res.json.suggestions.map((entry) => entry.name),
        ["Capsule Item 0", "Capsule Item 1", "Capsule Item 2", "Capsule Item 3", "Capsule Item 4", "Capsule Item 5", "Capsule Item 6", "Capsule Item 7"]
      );
    });
  });

  describe("related products", () => {
    it("returns same-category siblings, excluding the product, newest first", async () => {
      const cat = await freshCategory("related-one");
      const self = await product({ name: "Related Self", cat });
      const older = await product({ name: "Related Older", cat });
      const newer = await product({ name: "Related Newer", cat });
      // A different category must never leak in.
      await product({ name: "Related Other" });

      const res = await api(`/api/products/${self.id}/related?limit=10`);
      assert.equal(res.status, 200, res.text);
      const ids = res.json.products.map((entry) => entry.id);
      assert.deepEqual(ids, [newer.id, older.id]);
      assert.ok(
        res.json.products.every((entry) => entry.categoryId === cat.id),
        "only same-category siblings"
      );

      // Same result by slug.
      const bySlug = await api(`/api/products/${self.slug}/related?limit=10`);
      assert.equal(bySlug.status, 200, bySlug.text);
      assert.deepEqual(
        bySlug.json.products.map((entry) => entry.id),
        ids
      );
    });

    it("prefers in-stock siblings and only then fills with out-of-stock ones", async () => {
      const cat = await freshCategory("related-stock");
      const self = await product({ name: "Stock Self", cat });
      const soldOut = await product({ name: "Stock Sold Out", cat, stock: 0 });
      const available = await product({ name: "Stock Available", cat, stock: 3 });

      const res = await api(`/api/products/${self.id}/related?limit=2`);
      assert.equal(res.status, 200, res.text);
      assert.equal(res.json.count, 2);
      assert.deepEqual(
        res.json.products.map((entry) => entry.id),
        [available.id, soldOut.id]
      );

      const onlyInStock = await api(`/api/products/${self.id}/related?limit=1`);
      assert.equal(onlyInStock.json.products[0].id, available.id);
      assert.equal(onlyInStock.json.products[0].stock > 0, true);
    });

    it("defaults to four and caps the limit at twelve", async () => {
      const cat = await freshCategory("related-limit");
      const self = await product({ name: "Limit Self", cat });
      for (let index = 0; index < 14; index += 1) {
        await product({ name: `Limit Sibling ${index}`, cat });
      }

      const byDefault = await api(`/api/products/${self.id}/related`);
      assert.equal(byDefault.status, 200, byDefault.text);
      assert.equal(byDefault.json.count, 4);

      const capped = await api(`/api/products/${self.id}/related?limit=999`);
      assert.equal(capped.status, 200, capped.text);
      assert.equal(capped.json.count, 12);

      const bogus = await api(`/api/products/${self.id}/related?limit=abc`);
      assert.equal(bogus.status, 200, bogus.text);
      assert.equal(bogus.json.count, 4);
    });

    it("returns an empty list when a product has no siblings", async () => {
      const cat = await freshCategory("related-lonely");
      const lonely = await product({ name: "Lonely Discovery Product", cat });

      const res = await api(`/api/products/${lonely.id}/related`);
      assert.equal(res.status, 200, res.text);
      assert.equal(res.json.count, 0);
      assert.deepEqual(res.json.products, []);
    });

    it("404s for a missing product", async () => {
      const res = await api("/api/products/99999999/related");
      assert.equal(res.status, 404, res.text);
    });
  });
});
