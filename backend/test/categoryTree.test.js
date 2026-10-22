// test/categoryTree.test.js — Phase G (checklist item 29)
//
// GET  /api/categories          flat list stays backward compatible + tree
// POST /api/categories          optional parentId, depth 3, cycle-free
// PUT  /api/categories/:id      move validation (self, descendant, depth)
// DELETE /api/categories/:id    children promoted to roots (never deleted)
//
// SAFETY: shared harness — scratch test DB only (buyoDB_ph2_test).

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");

describe("Category hierarchy (Phase G)", () => {
  let ctx;
  let admin;
  const createdCategories = [];
  const createdProducts = [];

  const api = (pathname, options) => helpers.api(ctx.baseUrl, pathname, options);

  async function createCategory(name, parentId) {
    const res = await api("/api/categories", {
      method: "POST",
      token: admin.token,
      body: { name, ...(parentId === undefined ? {} : { parentId }) }
    });
    assert.equal(res.status, 201, res.text);
    createdCategories.push(res.json.category.id);
    return res.json.category;
  }

  async function moveCategory(id, parentId) {
    return api(`/api/categories/${id}`, {
      method: "PUT",
      token: admin.token,
      body: { parentId }
    });
  }

  async function addProduct(category) {
    const res = await api("/api/products", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Tree Product ${createdProducts.length}`,
        category: category.name,
        categoryId: category.id,
        mrpPrice: 100,
        sellingPrice: 80,
        stock: 2
      }
    });
    assert.equal(res.status, 201, res.text);
    createdProducts.push(res.json.product.id);
    return res.json.product;
  }

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);
  });

  after(async () => {
    for (const id of createdProducts) {
      await api(`/api/products/${id}`, { method: "DELETE", token: admin.token });
    }
    for (const id of [...createdCategories].reverse()) {
      await api(`/api/categories/${id}`, { method: "DELETE", token: admin.token });
    }
    await ctx.close();
  });

  it("keeps the flat response backward compatible when nothing is nested", async () => {
    const empty = await api("/api/categories");
    assert.equal(empty.status, 200, empty.text);
    assert.deepEqual(empty.json.categories, []);
    assert.deepEqual(empty.json.tree, []);
    assert.equal(empty.json.maxDepth, 3);

    const root = await createCategory("Tree Root Alpha");
    const res = await api("/api/categories");
    const listed = res.json.categories.find((entry) => entry.id === root.id);

    // Existing fields are untouched; the new ones are additive.
    assert.equal(listed.name, "Tree Root Alpha");
    assert.equal(typeof listed.slug, "string");
    assert.equal(String(listed.taxRate), "0.00");
    assert.equal(listed.productCount, 0);
    assert.equal(listed.parentId, null);
    assert.equal(listed.depth, 1);
    assert.equal(listed.totalProductCount, 0);
    assert.equal("children" in listed, false, "flat rows never carry a children array");
    assert.equal(res.json.count, res.json.categories.length);
  });

  it("nests root -> child -> grandchild and rolls product counts up", async () => {
    const root = await createCategory("Tree Garden");
    const child = await createCategory("Tree Garden Tools", root.id);
    const grandchild = await createCategory("Tree Garden Hand Tools", child.id);
    await addProduct(child);

    const res = await api("/api/categories");
    assert.equal(res.status, 200, res.text);

    const node = res.json.tree.find((entry) => entry.id === root.id);
    assert.ok(node, "root present in the tree");
    assert.equal(node.depth, 1);
    assert.equal(node.children.length, 1);
    assert.equal(node.children[0].id, child.id);
    assert.equal(node.children[0].depth, 2);
    assert.equal(node.children[0].children[0].id, grandchild.id);
    assert.equal(node.children[0].children[0].depth, 3);

    // Direct count on the child, rolled-up count on the ancestors.
    assert.equal(node.productCount, 0);
    assert.equal(node.totalProductCount, 1);
    assert.equal(node.children[0].productCount, 1);
    assert.equal(node.children[0].totalProductCount, 1);

    const flatChild = res.json.categories.find((entry) => entry.id === child.id);
    assert.equal(flatChild.parentId, root.id);
    assert.equal(flatChild.depth, 2);
    assert.equal(flatChild.totalProductCount, 1);
  });

  it("refuses a fourth level and creates nothing", async () => {
    const root = await createCategory("Tree Depth Root");
    const child = await createCategory("Tree Depth Child", root.id);
    const grandchild = await createCategory("Tree Depth Grandchild", child.id);

    const before = (await api("/api/categories")).json.count;
    const res = await api("/api/categories", {
      method: "POST",
      token: admin.token,
      body: { name: "Tree Depth Great Grandchild", parentId: grandchild.id }
    });

    assert.equal(res.status, 400, res.text);
    assert.equal(res.json.code, "CATEGORY_DEPTH_EXCEEDED");
    assert.match(res.json.message, /at most 3 levels/);
    assert.equal((await api("/api/categories")).json.count, before, "no row was written");
  });

  it("rejects a category as its own parent", async () => {
    const root = await createCategory("Tree Self Parent");
    const res = await moveCategory(root.id, root.id);

    assert.equal(res.status, 400, res.text);
    assert.equal(res.json.code, "CATEGORY_CYCLE");
    assert.match(res.json.message, /own parent/);
  });

  it("rejects moving a category under its own descendant", async () => {
    const root = await createCategory("Tree Cycle Root");
    const child = await createCategory("Tree Cycle Child", root.id);
    const grandchild = await createCategory("Tree Cycle Grandchild", child.id);

    const res = await moveCategory(root.id, grandchild.id);
    assert.equal(res.status, 400, res.text);
    assert.equal(res.json.code, "CATEGORY_CYCLE");
    assert.match(res.json.message, /descendant/);

    // Nothing moved.
    const listed = (await api("/api/categories")).json.categories;
    assert.equal(listed.find((entry) => entry.id === root.id).parentId, null);
    assert.equal(listed.find((entry) => entry.id === child.id).parentId, root.id);
  });

  it("validates the whole subtree height when moving, not just the parent depth", async () => {
    const deepRoot = await createCategory("Tree Move Deep Root");
    const deepChild = await createCategory("Tree Move Deep Child", deepRoot.id);
    await createCategory("Tree Move Deep Grandchild", deepChild.id);

    const otherRoot = await createCategory("Tree Move Other Root");
    const otherChild = await createCategory("Tree Move Other Child", otherRoot.id);

    // deepChild already carries one generation, so it cannot sit under a
    // depth-2 node (that would create level 4).
    const tooDeep = await moveCategory(deepChild.id, otherChild.id);
    assert.equal(tooDeep.status, 400, tooDeep.text);
    assert.equal(tooDeep.json.code, "CATEGORY_DEPTH_EXCEEDED");

    // Under the depth-1 root it fits exactly (1 + 2 = 3).
    const legal = await moveCategory(deepChild.id, otherRoot.id);
    assert.equal(legal.status, 200, legal.text);
    assert.equal(legal.json.category.parentId, otherRoot.id);

    const tree = (await api("/api/categories")).json.tree;
    const movedRoot = tree.find((entry) => entry.id === otherRoot.id);
    const moved = movedRoot.children.find((entry) => entry.id === deepChild.id);
    assert.ok(moved, "moved subtree now hangs under the new parent");
    assert.equal(moved.children.length, 1);
    assert.equal(moved.children[0].depth, 3);
  });

  it("promotes a category to a root with an explicit null parent", async () => {
    const root = await createCategory("Tree Promote Root");
    const child = await createCategory("Tree Promote Child", root.id);

    const res = await moveCategory(child.id, null);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.category.parentId, null);

    const listed = (await api("/api/categories")).json.categories;
    assert.equal(listed.find((entry) => entry.id === child.id).depth, 1);
  });

  it("rejects a missing parent and a non-integer parent", async () => {
    const root = await createCategory("Tree Missing Parent");

    const missing = await moveCategory(root.id, 2147483000);
    assert.equal(missing.status, 400, missing.text);
    assert.equal(missing.json.code, "CATEGORY_PARENT_NOT_FOUND");

    const invalid = await api(`/api/categories/${root.id}`, {
      method: "PUT",
      token: admin.token,
      body: { parentId: "not-a-number" }
    });
    assert.equal(invalid.status, 400, invalid.text);
    assert.equal(invalid.json.message, "Validation failed");
  });

  it("promotes children to roots when their parent is deleted", async () => {
    const parent = await createCategory("Tree Delete Parent");
    const first = await createCategory("Tree Delete Child One", parent.id);
    const second = await createCategory("Tree Delete Child Two", parent.id);

    const res = await api(`/api/categories/${parent.id}`, {
      method: "DELETE",
      token: admin.token
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.reparentedChildren, 2);

    const listed = (await api("/api/categories")).json.categories;
    for (const child of [first, second]) {
      const entry = listed.find((row) => row.id === child.id);
      assert.equal(entry.parentId, null, "child promoted to root");
      assert.equal(entry.depth, 1);
    }
    assert.ok(!listed.some((entry) => entry.id === parent.id));
  });

  it("requires admin rights to change the hierarchy", async () => {
    const root = await createCategory("Tree Guard Root");
    const customer = await helpers.createVerifiedUser(ctx.baseUrl);

    const createRes = await api("/api/categories", {
      method: "POST",
      token: customer.token,
      body: { name: "Tree Forbidden", parentId: root.id }
    });
    assert.equal(createRes.status, 403, createRes.text);

    const moveRes = await api(`/api/categories/${root.id}`, {
      method: "PUT",
      token: customer.token,
      body: { parentId: null }
    });
    assert.equal(moveRes.status, 403, moveRes.text);
  });
});
