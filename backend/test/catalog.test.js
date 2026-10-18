// test/catalog.test.js
// Phase 4: catalog APIs — categories CRUD, product CRUD, search / filtering /
// sorting / pagination, id-or-slug lookup, admin-only enforcement, validation,
// and backward compatibility with the legacy free-text `category` field.
//
// SAFETY: uses the shared harness (test DB only, dropped + recreated).
// Every multi-product assertion is scoped by a unique `q=` token so tests stay
// independent of data created by earlier tests in this suite.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");

describe("Catalog APIs (Phase 4)", () => {
  let ctx;
  let admin;
  let user;

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);
    user = await helpers.createVerifiedUser(ctx.baseUrl);
  });

  after(async () => {
    await ctx.close();
  });

  const createCategory = (body) =>
    helpers.api(ctx.baseUrl, "/api/categories", { method: "POST", token: admin.token, body });
  const updateCategory = (id, body) =>
    helpers.api(ctx.baseUrl, `/api/categories/${id}`, { method: "PUT", token: admin.token, body });
  const deleteCategory = (id) =>
    helpers.api(ctx.baseUrl, `/api/categories/${id}`, { method: "DELETE", token: admin.token });
  const createProduct = (body) =>
    helpers.api(ctx.baseUrl, "/api/products", { method: "POST", token: admin.token, body });
  const updateProduct = (id, body) =>
    helpers.api(ctx.baseUrl, `/api/products/${id}`, { method: "PUT", token: admin.token, body });
  const deleteProduct = (id) =>
    helpers.api(ctx.baseUrl, `/api/products/${id}`, { method: "DELETE", token: admin.token });
  const listProducts = (queryString = "") =>
    helpers.api(ctx.baseUrl, `/api/products${queryString}`);

  // Minimal valid product payload (name/category vary per test).
  const baseProduct = (overrides = {}) => ({
    name: "Base Probe Item",
    category: "BaseCat",
    mrpPrice: 100,
    sellingPrice: 90,
    ...overrides
  });

  // ---------------------------------------------------------------- categories

  it("GET /api/categories is public and returns a stable shape", async () => {
    const res = await helpers.api(ctx.baseUrl, "/api/categories");
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.categories));
    assert.equal(res.json.count, res.json.categories.length);
  });

  it("admin creates a category (slug auto-generated, taxRate stored)", async () => {
    const res = await createCategory({ name: "Lifecycle Cat", description: "cat lifecycle", taxRate: 18 });
    assert.equal(res.status, 201);
    assert.equal(res.json.success, true);
    assert.equal(res.json.category.name, "Lifecycle Cat");
    assert.equal(res.json.category.slug, "lifecycle-cat");
    assert.equal(Number(res.json.category.taxRate), 18);

    const id = res.json.category.id;

    // Update: rename does NOT silently change the slug (explicit only)
    const upd = await updateCategory(id, { name: "Lifecycle Cat Renamed", taxRate: 5.5 });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.category.name, "Lifecycle Cat Renamed");
    assert.equal(upd.json.category.slug, "lifecycle-cat");
    assert.equal(Number(upd.json.category.taxRate), 5.5);

    // Explicit slug change works and must be unique
    const slugChange = await updateCategory(id, { slug: "lifecycle-cat-v2" });
    assert.equal(slugChange.status, 200);
    assert.equal(slugChange.json.category.slug, "lifecycle-cat-v2");

    const del = await deleteCategory(id);
    assert.equal(del.status, 200);
    assert.equal(del.json.success, true);

    const list = await helpers.api(ctx.baseUrl, "/api/categories");
    assert.ok(!list.json.categories.some((c) => c.id === id));
  });

  it("category creation validates name, slug and taxRate", async () => {
    assert.equal((await createCategory({})).status, 400); // missing name
    assert.equal((await createCategory({ name: "   " })).status, 400);
    assert.equal((await createCategory({ name: "Bad Slug Cat", slug: "Bad Slug!" })).status, 400);
    assert.equal((await createCategory({ name: "Neg Tax Cat", taxRate: -1 })).status, 400);
    assert.equal((await createCategory({ name: "Huge Tax Cat", taxRate: 1000 })).status, 400);

    // Duplicate name -> 409 (ci collation: "dupe cat" == "Dupe Cat")
    assert.equal((await createCategory({ name: "Dupe Cat" })).status, 201);
    const dup = await createCategory({ name: "dupe cat" });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.success, false);

    // Duplicate slug -> 409
    assert.equal((await createCategory({ name: "Slug Dup Cat", slug: "slug-dup-cat" })).status, 201);
    const slugDup = await createCategory({ name: "Slug Dup Cat 2", slug: "slug-dup-cat" });
    assert.equal(slugDup.status, 409);
  });

  it("category mutations reject anonymous and non-admin callers", async () => {
    assert.equal((await helpers.api(ctx.baseUrl, "/api/categories", { method: "POST", body: { name: "X" } })).status, 401);
    assert.equal((await helpers.api(ctx.baseUrl, "/api/categories", { method: "POST", token: user.token, body: { name: "X" } })).status, 403);
    assert.equal((await helpers.api(ctx.baseUrl, "/api/categories/1", { method: "PUT", body: { name: "X" } })).status, 401);
    assert.equal((await helpers.api(ctx.baseUrl, "/api/categories/1", { method: "PUT", token: user.token, body: { name: "X" } })).status, 403);
    assert.equal((await helpers.api(ctx.baseUrl, "/api/categories/1", { method: "DELETE" })).status, 401);
    assert.equal((await helpers.api(ctx.baseUrl, "/api/categories/1", { method: "DELETE", token: user.token })).status, 403);
  });

  it("GET /api/categories includes productCount for linked products", async () => {
    const cat = await createCategory({ name: "CountProbe Cat" });
    assert.equal(cat.status, 201);
    await createProduct(baseProduct({ name: "CountProbe One", category: "CountProbe Cat" }));
    await createProduct(baseProduct({ name: "CountProbe Two", category: "CountProbe Cat" }));

    const list = await helpers.api(ctx.baseUrl, "/api/categories");
    assert.equal(list.status, 200);
    const found = list.json.categories.find((c) => c.id === cat.json.category.id);
    assert.ok(found);
    assert.equal(found.productCount, 2); // auto-linked by exact legacy name
  });

  // ------------------------------------------------------------------ products

  it("product creation validates stock, prices, slug, categoryId and imageMeta", async () => {
    // Missing required fields
    assert.equal((await createProduct({})).status, 400);

    // Stock: must be an integer >= 0
    assert.equal((await createProduct(baseProduct({ name: "ValProbe Stock1", stock: -1 }))).status, 400);
    assert.equal((await createProduct(baseProduct({ name: "ValProbe Stock2", stock: 2.5 }))).status, 400);

    // Prices: selling may not exceed mrp
    const badPrices = await createProduct(baseProduct({ name: "ValProbe Price", mrpPrice: 100, sellingPrice: 200 }));
    assert.equal(badPrices.status, 400);

    // Category relationship: FK must exist
    const badFk = await createProduct(baseProduct({ name: "ValProbe Fk", categoryId: 999999 }));
    assert.equal(badFk.status, 400);
    assert.ok(badFk.json.errors.some((e) => e.includes("categoryId")));

    // Slug format
    assert.equal((await createProduct(baseProduct({ name: "ValProbe Slug", slug: "Not A Slug!" }))).status, 400);

    // imageMeta shape
    assert.equal((await createProduct(baseProduct({ name: "ValProbe Im1", imageMeta: { url: "x" } }))).status, 400);
    assert.equal((await createProduct(baseProduct({ name: "ValProbe Im2", imageMeta: { alt: "x".repeat(300) } }))).status, 400);
    assert.equal((await createProduct(baseProduct({ name: "ValProbe Im3", imageMeta: { width: -5 } }))).status, 400);
    assert.equal((await createProduct(baseProduct({ name: "ValProbe Im4", imageMeta: { width: "abc" } }))).status, 400);
  });

  it("admin creates a full product (slug, stock, imageMeta, categoryId) and it is retrievable by slug", async () => {
    const cat = await createCategory({ name: "FullProbe Cat", slug: "fullprobe-cat" });
    assert.equal(cat.status, 201);

    const res = await createProduct(baseProduct({
      name: "FullProbe Lamp",
      category: "FullProbe Cat",
      categoryId: cat.json.category.id,
      slug: "fullprobe-lamp",
      stock: 9,
      description: "A lamp for full payload probing",
      imageMeta: { alt: "FullProbe lamp image", width: 800, height: 600 }
    }));
    assert.equal(res.status, 201);
    assert.equal(res.json.product.slug, "fullprobe-lamp");
    assert.equal(res.json.product.stock, 9);
    assert.equal(Number(res.json.product.mrpPrice), 100);
    assert.deepEqual(res.json.product.imageMeta, { alt: "FullProbe lamp image", width: 800, height: 600 });
    assert.equal(res.json.product.categoryId, cat.json.category.id);

    const bySlug = await listProducts("/fullprobe-lamp");
    assert.equal(bySlug.status, 200);
    assert.equal(bySlug.json.product.name, "FullProbe Lamp");
    assert.equal(bySlug.json.product.Category.name, "FullProbe Cat"); // include works

    // Duplicate slug -> 409
    const dup = await createProduct(baseProduct({ name: "FullProbe Lamp Copy", slug: "fullprobe-lamp" }));
    assert.equal(dup.status, 409);
  });

  it("legacy category strings still work: auto-link on match, null FK otherwise", async () => {
    // Matched: category row exists with the exact legacy name -> auto-linked
    await createCategory({ name: "LegacyProbe Cat", slug: "legacyprobe-cat" });
    const linked = await createProduct(baseProduct({ name: "LegacyProbe Linked", category: "LegacyProbe Cat" }));
    assert.equal(linked.status, 201);
    assert.ok(linked.json.product.categoryId, "expected auto-link by exact legacy name");

    // Explicit null FK keeps the legacy string without a link (legacy-only shape)
    const legacyOnly = await createProduct(baseProduct({ name: "LegacyProbe Unlinked", category: "LegacyProbe Cat", categoryId: null }));
    assert.equal(legacyOnly.status, 201);
    assert.equal(legacyOnly.json.product.categoryId, null);
    assert.equal(legacyOnly.json.product.category, "LegacyProbe Cat");

    // Unmatched legacy string: no category row at all -> null FK, still listed
    const ghost = await createProduct(baseProduct({ name: "LegacyProbe Ghost", category: "GhostCategoryXyz" }));
    assert.equal(ghost.status, 201);
    assert.equal(ghost.json.product.categoryId, null);

    const list = await listProducts("?q=legacyprobe");
    assert.equal(list.status, 200);
    assert.equal(list.json.count, 3);
  });

  it("admin updates a product: stock, combined prices, explicit unlink and relink", async () => {
    const catA = await createCategory({ name: "UpdProbe CatA", slug: "updprobe-cata" });
    const catB = await createCategory({ name: "UpdProbe CatB", slug: "updprobe-catb" });
    const created = await createProduct(baseProduct({
      name: "UpdProbe Item",
      category: "UpdProbe CatA",
      mrpPrice: 500,
      sellingPrice: 400,
      stock: 3
    }));
    assert.equal(created.status, 201);
    const id = created.json.product.id;

    // Stock update
    const stockUpd = await updateProduct(id, { stock: 7 });
    assert.equal(stockUpd.status, 200);
    assert.equal(stockUpd.json.product.stock, 7);

    // Selling above FINAL mrp -> 400; both together -> 200
    assert.equal((await updateProduct(id, { sellingPrice: 600 })).status, 400);
    const both = await updateProduct(id, { mrpPrice: 800, sellingPrice: 750 });
    assert.equal(both.status, 200);
    assert.equal(Number(both.json.product.sellingPrice), 750);

    // Explicit unlink via categoryId: null (legacy string untouched)
    const unlinked = await updateProduct(id, { categoryId: null });
    assert.equal(unlinked.status, 200);
    assert.equal(unlinked.json.product.categoryId, null);
    assert.equal(unlinked.json.product.category, "UpdProbe CatA");

    // Changing the legacy string relinks by exact name
    const relinked = await updateProduct(id, { category: "UpdProbe CatB" });
    assert.equal(relinked.status, 200);
    assert.equal(relinked.json.product.categoryId, catB.json.category.id);

    // Invalid FK on update -> 400; empty body -> 400
    assert.equal((await updateProduct(id, { categoryId: 999999 })).status, 400);
    assert.equal((await updateProduct(id, {})).status, 400);
    assert.ok(catA.json.category.id); // sanity: used above via auto-link on create
  });

  it("search (q) filters by name/description, case-insensitively", async () => {
    await createProduct(baseProduct({ name: "Qsearcha Alphalamp", description: "luminous probe" }));
    await createProduct(baseProduct({ name: "Qsearcha Betagadget", description: "technical probe" }));

    const both = await listProducts("?q=qsearcha");
    assert.equal(both.json.count, 2);

    const one = await listProducts("?q=ALPHALAMP"); // case-insensitive substring
    assert.equal(one.json.count, 1);
    assert.equal(one.json.products[0].name, "Qsearcha Alphalamp");

    const byDescription = await listProducts("?q=luminous");
    assert.equal(byDescription.json.count, 1);

    const none = await listProducts("?q=nomatchtoken123");
    assert.equal(none.json.count, 0);
    assert.equal(none.json.success, true);
  });

  it("filtering: category (slug / id / legacy name), price range and stock", async () => {
    const cat = await createCategory({ name: "FilterProbe Cat", slug: "filterprobe-cat" });
    // Linked via explicit FK + legacy string kept
    const linked = await createProduct(baseProduct({
      name: "FilterProbe Linked", category: "FilterProbe Cat", categoryId: cat.json.category.id,
      mrpPrice: 150, sellingPrice: 100, stock: 4
    }));
    // Legacy-only row pointing at the same category name (no FK link)
    const legacy = await createProduct(baseProduct({
      name: "FilterProbe Legacy", category: "FilterProbe Cat", categoryId: null,
      mrpPrice: 250, sellingPrice: 200, stock: 0
    }));
    // Unrelated product, same search token
    const other = await createProduct(baseProduct({
      name: "FilterProbe Other", category: "OtherFilterCat",
      mrpPrice: 350, sellingPrice: 300, stock: 2
    }));
    assert.equal(linked.status, 201);
    assert.equal(legacy.status, 201);
    assert.equal(other.status, 201);

    // By slug: linked + legacy-name rows
    const bySlug = await listProducts(`?q=filterprobe&category=${encodeURIComponent("filterprobe-cat")}`);
    assert.equal(bySlug.json.count, 2);

    // By numeric id: same set
    const byId = await listProducts(`?q=filterprobe&category=${cat.json.category.id}`);
    assert.equal(byId.json.count, 2);

    // By legacy name
    const byLegacy = await listProducts(`?q=filterprobe&category=${encodeURIComponent("FilterProbe Cat")}`);
    assert.equal(byLegacy.json.count, 2);

    // Unknown category -> empty (valid response, no error)
    const unknown = await listProducts("?q=filterprobe&category=nowhere-cat");
    assert.equal(unknown.json.count, 0);

    // Price range on sellingPrice (100 / 200 / 300 in scope)
    const min = await listProducts("?q=filterprobe&minPrice=200");
    assert.equal(min.json.count, 2);
    const max = await listProducts("?q=filterprobe&maxPrice=200");
    assert.equal(max.json.count, 2);
    const range = await listProducts("?q=filterprobe&minPrice=150&maxPrice=250");
    assert.equal(range.json.count, 1);
    assert.equal(range.json.products[0].name, "FilterProbe Legacy");

    // Stock
    const inStock = await listProducts("?q=filterprobe&inStock=true");
    assert.equal(inStock.json.count, 2);
    const outOfStock = await listProducts("?q=filterprobe&inStock=false");
    assert.equal(outOfStock.json.count, 1);
    assert.equal(outOfStock.json.products[0].name, "FilterProbe Legacy");
  });

  it("sorting: price_asc and price_desc order by sellingPrice", async () => {
    await createProduct(baseProduct({ name: "SortProbe A", category: "SortCat", sellingPrice: 10 }));
    await createProduct(baseProduct({ name: "SortProbe B", category: "SortCat", sellingPrice: 30 }));
    await createProduct(baseProduct({ name: "SortProbe C", category: "SortCat", sellingPrice: 20 }));

    const asc = await listProducts("?q=sortprobe&sort=price_asc&limit=10");
    assert.deepEqual(asc.json.products.map((p) => Number(p.sellingPrice)), [10, 20, 30]);

    const desc = await listProducts("?q=sortprobe&sort=price_desc&limit=10");
    assert.deepEqual(desc.json.products.map((p) => Number(p.sellingPrice)), [30, 20, 10]);
  });

  it("pagination: stable, non-overlapping pages with correct metadata", async () => {
    for (let i = 1; i <= 5; i += 1) {
      await createProduct(baseProduct({ name: `PagiProbe Item ${i}`, category: "PagiCat", sellingPrice: i }));
    }

    const seen = [];
    for (let page = 1; page <= 3; page += 1) {
      const res = await listProducts(`?q=pagiprobe&sort=newest&limit=2&page=${page}`);
      assert.equal(res.status, 200);
      assert.equal(res.json.pagination.total, 5);
      assert.equal(res.json.pagination.totalPages, 3);
      assert.equal(res.json.pagination.limit, 2);
      assert.equal(res.json.pagination.page, page);
      assert.equal(res.json.count, res.json.products.length);
      seen.push(...res.json.products.map((p) => p.id));
    }
    assert.equal(seen.length, 5, "all rows appear exactly once across pages");
    assert.equal(new Set(seen).size, 5, "no duplicates across pages");

    const page1 = await listProducts("?q=pagiprobe&sort=newest&limit=2&page=1");
    assert.equal(page1.json.pagination.hasNext, true);
    assert.equal(page1.json.pagination.hasPrev, false);

    const page3 = await listProducts("?q=pagiprobe&sort=newest&limit=2&page=3");
    assert.equal(page3.json.count, 1);
    assert.equal(page3.json.pagination.hasNext, false);
    assert.equal(page3.json.pagination.hasPrev, true);

    // Beyond the last page: empty page, intact totals
    const page4 = await listProducts("?q=pagiprobe&limit=2&page=4");
    assert.equal(page4.status, 200);
    assert.equal(page4.json.count, 0);
    assert.deepEqual(page4.json.products, []);
    assert.equal(page4.json.pagination.total, 5);
    assert.equal(page4.json.pagination.hasNext, false);
  });

  it("default list keeps the legacy shape and sane pagination defaults", async () => {
    const res = await listProducts();
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(Array.isArray(res.json.products));
    assert.equal(res.json.count, res.json.products.length);
    assert.equal(res.json.pagination.page, 1);
    assert.equal(res.json.pagination.limit, 50);
    assert.equal(typeof res.json.pagination.total, "number");
  });

  it("invalid query parameters are rejected with 400", async () => {
    const bad = [
      "?sort=bogus",
      "?page=0",
      "?page=abc",
      "?limit=0",
      "?limit=101",
      "?minPrice=-5",
      "?minPrice=50&maxPrice=10",
      "?inStock=maybe"
    ];
    for (const qs of bad) {
      const res = await listProducts(qs);
      assert.equal(res.status, 400, `expected 400 for ${qs}`);
      assert.equal(res.json.message, "Validation failed");
    }
  });

  it("lookup by id and by slug; missing products return 404", async () => {
    const created = await createProduct(baseProduct({ name: "LookupProbe Gadget", slug: "lookupprobe-gadget" }));
    assert.equal(created.status, 201);
    const id = created.json.product.id;

    const byId = await listProducts(`/${id}`);
    assert.equal(byId.status, 200);
    assert.equal(byId.json.product.id, id);

    const bySlug = await listProducts("/lookupprobe-gadget");
    assert.equal(bySlug.status, 200);
    assert.equal(bySlug.json.product.id, id);

    const missingSlug = await listProducts("/no-such-slug-xyz");
    assert.equal(missingSlug.status, 404);
    assert.equal(missingSlug.json.success, false);

    const missingId = await listProducts("/99999999");
    assert.equal(missingId.status, 404);
  });

  it("product mutations reject anonymous and non-admin callers; admin delete works", async () => {
    const created = await createProduct(baseProduct({ name: "DelProbe Item", category: "DelCat" }));
    const id = created.json.product.id;

    assert.equal((await helpers.api(ctx.baseUrl, `/api/products/${id}`, { method: "PUT", body: { stock: 1 } })).status, 401);
    assert.equal((await helpers.api(ctx.baseUrl, `/api/products/${id}`, { method: "PUT", token: user.token, body: { stock: 1 } })).status, 403);
    assert.equal((await helpers.api(ctx.baseUrl, `/api/products/${id}`, { method: "DELETE" })).status, 401);
    assert.equal((await helpers.api(ctx.baseUrl, `/api/products/${id}`, { method: "DELETE", token: user.token })).status, 403);

    const del = await deleteProduct(id);
    assert.equal(del.status, 200);
    assert.equal(del.json.success, true);

    const after = await listProducts(`/${id}`);
    assert.equal(after.status, 404);

    const delAgain = await deleteProduct(id);
    assert.equal(delAgain.status, 404);
  });

  it("deleting a category preserves products and the legacy category field", async () => {
    const cat = await createCategory({ name: "DelProbe Cat", slug: "delprobe-cat" });
    const product = await createProduct(baseProduct({
      name: "DelProbe Product", category: "DelProbe Cat", categoryId: cat.json.category.id
    }));
    const productId = product.json.product.id;

    const del = await deleteCategory(cat.json.category.id);
    assert.equal(del.status, 200);
    assert.equal(del.json.affectedProducts, 1);

    // Product survives, unlinked (SET NULL), legacy string intact
    const after = await listProducts(`/${productId}`);
    assert.equal(after.status, 200);
    assert.equal(after.json.product.categoryId, null);
    assert.equal(after.json.product.category, "DelProbe Cat");

    // Legacy-only filter still finds it (no Categories row anymore)
    const filtered = await listProducts(`?category=${encodeURIComponent("DelProbe Cat")}`);
    assert.ok(filtered.json.products.some((p) => p.id === productId));
  });
});
