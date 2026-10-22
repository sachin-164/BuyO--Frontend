// test/productGallery.test.js — Phase D (checklist items 32–33)
//
// Ordered product gallery on top of the legacy Products.image column:
//   - Products.image is always mirrored from gallery row 0 (or cleared)
//   - PUT replaces the whole ordered set (reorder + alt + removal in one call)
//   - POST appends one image (JSON url, or a local multipart file)
//   - DELETE removes one image, re-indexes, and releases its file
//   - deleting a product cascades its rows and releases every file
//
// SAFETY: shared harness — scratch test DB only (buyoDB_ph2_test). Uploads go to
// backend/uploads through the real local driver and are released at the end.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const helpers = require("./helpers");

const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function uploadedName(reference) {
  return path.basename(String(reference || ""));
}

function fileExists(reference) {
  return fs.existsSync(path.join(UPLOADS_DIR, uploadedName(reference)));
}

describe("Product gallery (Phase D, items 32–33)", () => {
  let ctx;
  let admin;
  let customer;
  const createdIds = [];

  const api = (pathname, options) => helpers.api(ctx.baseUrl, pathname, options);

  async function createProduct(overrides = {}) {
    const res = await api("/api/products", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Gallery ${Date.now()}-${createdIds.length}`,
        category: "Gallery tests",
        mrpPrice: 400,
        sellingPrice: 300,
        stock: 5,
        ...overrides
      }
    });
    assert.equal(res.status, 201, res.text);
    createdIds.push(res.json.product.id);
    return res.json.product;
  }

  async function appendFile(productId, { alt, file = PNG, filename = "gallery.png", type = "image/png" } = {}) {
    const form = new FormData();
    form.set("image", new Blob([file], { type }), filename);
    if (alt !== undefined) form.set("alt", alt);
    const res = await fetch(`${ctx.baseUrl}/api/products/${productId}/images`, {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: form
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);
    customer = await helpers.createVerifiedUser(ctx.baseUrl, { name: "Gallery Customer" });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  });

  after(async () => {
    for (const id of createdIds.reverse()) {
      await api(`/api/products/${id}`, { method: "DELETE", token: admin.token });
    }
    await ctx.close();
  });

  it("appends a URL image and mirrors it into the primary column", async () => {
    const product = await createProduct();
    assert.equal(product.image, "");

    const first = await api(`/api/products/${product.id}/images`, {
      method: "POST",
      token: admin.token,
      body: { url: "https://cdn.example.test/gallery/one.png", alt: "Front view" }
    });
    assert.equal(first.status, 201, first.text);
    assert.equal(first.json.product.images.length, 1);
    assert.equal(first.json.product.images[0].url, "https://cdn.example.test/gallery/one.png");
    assert.equal(first.json.product.images[0].alt, "Front view");
    assert.equal(first.json.product.images[0].position, 0);
    // First image becomes the primary for compatibility.
    assert.equal(first.json.product.image, "https://cdn.example.test/gallery/one.png");
    assert.equal(first.json.product.imageMeta.alt, "Front view");

    const second = await api(`/api/products/${product.id}/images`, {
      method: "POST",
      token: admin.token,
      body: { url: "https://cdn.example.test/gallery/two.png" }
    });
    assert.equal(second.status, 201, second.text);
    assert.deepEqual(
      second.json.product.images.map((image) => image.position),
      [0, 1]
    );
    // Appending never steals the primary slot.
    assert.equal(second.json.product.image, "https://cdn.example.test/gallery/one.png");

    // The storefront detail endpoint exposes the ordered gallery.
    const detail = await api(`/api/products/${product.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(
      detail.json.product.images.map((image) => image.url),
      ["https://cdn.example.test/gallery/one.png", "https://cdn.example.test/gallery/two.png"]
    );
  });

  it("appends an uploaded file in local storage mode", async () => {
    const product = await createProduct();
    const res = await appendFile(product.id, { alt: "Uploaded angle" });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const image = res.json.product.images[0];
    assert.match(image.url, /^\/uploads\/\d+-[0-9a-f]+\.png$/);
    assert.ok(fileExists(image.url));
    assert.equal(res.json.product.image, image.url);
  });

  it("replaces and reorders the gallery in one request", async () => {
    const product = await createProduct();
    const a = await appendFile(product.id, { alt: "A" });
    const b = await appendFile(product.id, { file: Buffer.from("GIF89a-gallery", "ascii"), filename: "b.gif", type: "image/gif" });
    const urlA = a.json.product.images[0].url;
    const urlB = b.json.product.images[1].url;
    assert.ok(fileExists(urlA) && fileExists(urlB));

    const reordered = await api(`/api/products/${product.id}/images`, {
      method: "PUT",
      token: admin.token,
      body: {
        images: [
          { url: urlB, alt: "Now first" },
          { url: urlA }
        ]
      }
    });
    assert.equal(reordered.status, 200, reordered.text);
    assert.deepEqual(
      reordered.json.product.images.map((image) => ({ url: image.url, position: image.position })),
      [
        { url: urlB, position: 0 },
        { url: urlA, position: 1 }
      ]
    );
    // Reorder promotes a new primary without deleting either file.
    assert.equal(reordered.json.product.image, urlB);
    assert.equal(reordered.json.product.imageMeta.alt, "Now first");
    assert.ok(fileExists(urlA), "reordering must not delete files");
    assert.ok(fileExists(urlB));

    // Re-sending the same values is idempotent.
    const again = await api(`/api/products/${product.id}/images`, {
      method: "PUT",
      token: admin.token,
      body: {
        images: [
          { url: urlB, alt: "Now first" },
          { url: urlA }
        ]
      }
    });
    assert.equal(again.status, 200, again.text);
    assert.equal(again.json.product.images.length, 2);
  });

  it("releases the file of an image dropped from the gallery", async () => {
    const product = await createProduct();
    const a = await appendFile(product.id);
    const b = await appendFile(product.id, { file: Buffer.from("GIF89a-drop-me", "ascii"), filename: "drop.gif", type: "image/gif" });
    const urlA = a.json.product.images[0].url;
    const urlB = b.json.product.images[1].url;

    const pruned = await api(`/api/products/${product.id}/images`, {
      method: "PUT",
      token: admin.token,
      body: { images: [{ url: urlB }] }
    });
    assert.equal(pruned.status, 200, pruned.text);
    assert.equal(pruned.json.product.images.length, 1);
    assert.equal(pruned.json.product.image, urlB, "the remaining image becomes primary");
    assert.equal(fileExists(urlA), false, "the dropped file must be released");
    assert.ok(fileExists(urlB));
  });

  it("is idempotent when the same file is referenced by another product's gallery", async () => {
    const primary = await createProduct();
    const first = await appendFile(primary.id);
    const shared = first.json.product.images[0].url;

    const mirror = await createProduct();
    const mirrorAppend = await api(`/api/products/${mirror.id}/images`, {
      method: "POST",
      token: admin.token,
      body: { url: shared }
    });
    assert.equal(mirrorAppend.status, 201, mirrorAppend.text);

    // Dropping it from the first product must not delete the shared file.
    const cleared = await api(`/api/products/${primary.id}/images`, {
      method: "PUT",
      token: admin.token,
      body: { images: [] }
    });
    assert.equal(cleared.status, 200, cleared.text);
    assert.deepEqual(cleared.json.product.images, []);
    assert.equal(cleared.json.product.image, "");
    assert.ok(fileExists(shared), "another product still owns the file");
  });

  it("validates the replacement payload", async () => {
    const product = await createProduct();

    const notArray = await api(`/api/products/${product.id}/images`, {
      method: "PUT",
      token: admin.token,
      body: { images: "nope" }
    });
    assert.equal(notArray.status, 400, notArray.text);
    assert.match(notArray.text, /images must be an array/i);

    const duplicates = await api(`/api/products/${product.id}/images`, {
      method: "PUT",
      token: admin.token,
      body: { images: [{ url: "https://cdn.example.test/dupe.png" }, { url: "https://cdn.example.test/dupe.png" }] }
    });
    assert.equal(duplicates.status, 400, duplicates.text);

    const missingUrl = await api(`/api/products/${product.id}/images`, {
      method: "PUT",
      token: admin.token,
      body: { images: [{ alt: "no url" }] }
    });
    assert.equal(missingUrl.status, 400, missingUrl.text);
    assert.match(missingUrl.text, /url is required/i);

    const tooMany = await api(`/api/products/${product.id}/images`, {
      method: "PUT",
      token: admin.token,
      body: {
        images: Array.from({ length: 9 }, (_, index) => ({
          url: `https://cdn.example.test/many/${index}.png`
        }))
      }
    });
    assert.equal(tooMany.status, 400, tooMany.text);
    assert.match(tooMany.text, /at most 8/i);

    // Nothing was written by any of the rejected requests.
    const detail = await api(`/api/products/${product.id}`);
    assert.deepEqual(detail.json.product.images, []);
  });

  it("caps appends at eight images", async () => {
    const product = await createProduct();
    for (let index = 0; index < 8; index += 1) {
      const res = await api(`/api/products/${product.id}/images`, {
        method: "POST",
        token: admin.token,
        body: { url: `https://cdn.example.test/cap/${index}.png` }
      });
      assert.equal(res.status, 201, res.text);
    }
    const ninth = await api(`/api/products/${product.id}/images`, {
      method: "POST",
      token: admin.token,
      body: { url: "https://cdn.example.test/cap/overflow.png" }
    });
    assert.equal(ninth.status, 400, ninth.text);
    assert.match(ninth.text, /at most 8/i);
  });

  it("deletes one image, re-indexes and releases its file", async () => {
    const product = await createProduct();
    const a = await appendFile(product.id);
    const b = await appendFile(product.id, { file: Buffer.from("GIF89a-second", "ascii"), filename: "second.gif", type: "image/gif" });
    const c = await appendFile(product.id, { file: Buffer.from("GIF89a-third", "ascii"), filename: "third.gif", type: "image/gif" });
    const [urlA, urlB, urlC] = c.json.product.images.map((image) => image.url);
    assert.deepEqual([urlA, urlB, urlC], [
      a.json.product.images[0].url,
      b.json.product.images[1].url,
      c.json.product.images[2].url
    ]);

    const middleId = c.json.product.images[1].id;
    const removed = await api(`/api/products/${product.id}/images/${middleId}`, {
      method: "DELETE",
      token: admin.token
    });
    assert.equal(removed.status, 200, removed.text);
    assert.deepEqual(
      removed.json.product.images.map((image) => image.position),
      [0, 1]
    );
    assert.deepEqual(
      removed.json.product.images.map((image) => image.url),
      [urlA, urlC]
    );
    // Primary is unchanged because position 0 survived.
    assert.equal(removed.json.product.image, urlA);
    assert.equal(fileExists(urlB), false, "the removed file must be released");
    assert.ok(fileExists(urlA) && fileExists(urlC));

    const unknown = await api(`/api/products/${product.id}/images/${middleId}`, {
      method: "DELETE",
      token: admin.token
    });
    assert.equal(unknown.status, 404, unknown.text);
  });

  it("deleting the primary promotes the next image", async () => {
    const product = await createProduct();
    const a = await appendFile(product.id);
    const b = await appendFile(product.id, { file: Buffer.from("GIF89a-promote", "ascii"), filename: "promote.gif", type: "image/gif" });
    const primaryId = a.json.product.images[0].id;
    const urlA = a.json.product.images[0].url;
    const urlB = b.json.product.images[1].url;

    const removed = await api(`/api/products/${product.id}/images/${primaryId}`, {
      method: "DELETE",
      token: admin.token
    });
    assert.equal(removed.status, 200, removed.text);
    assert.equal(removed.json.product.image, urlB);
    assert.equal(removed.json.product.images[0].position, 0);
    assert.equal(fileExists(urlA), false);
  });

  it("keeps an existing gallery in sync when the legacy image field changes", async () => {
    const product = await createProduct();
    const appended = await appendFile(product.id, { alt: "Keep alt" });
    const originalUrl = appended.json.product.images[0].url;

    const updated = await api(`/api/products/${product.id}`, {
      method: "PUT",
      token: admin.token,
      body: { image: "https://cdn.example.test/legacy/new.png" }
    });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.json.product.image, "https://cdn.example.test/legacy/new.png");
    assert.equal(updated.json.product.images.length, 1);
    assert.equal(updated.json.product.images[0].url, "https://cdn.example.test/legacy/new.png");
    assert.equal(updated.json.product.images[0].alt, "Keep alt");
    assert.equal(fileExists(originalUrl), false, "the replaced upload must be released");

    // Clearing the legacy image drops the primary gallery row too.
    const cleared = await api(`/api/products/${product.id}`, {
      method: "PUT",
      token: admin.token,
      body: { image: "" }
    });
    assert.equal(cleared.status, 200, cleared.text);
    assert.equal(cleared.json.product.image, "");
    assert.deepEqual(cleared.json.product.images, []);
  });

  it("deleting a product cascades its gallery rows and files", async () => {
    const product = await createProduct();
    const a = await appendFile(product.id);
    const b = await appendFile(product.id, { file: Buffer.from("GIF89a-cascade", "ascii"), filename: "cascade.gif", type: "image/gif" });
    const urls = b.json.product.images.map((image) => image.url);
    for (const url of urls) assert.ok(fileExists(url));

    const removed = await api(`/api/products/${product.id}`, { method: "DELETE", token: admin.token });
    assert.equal(removed.status, 200, removed.text);
    createdIds.splice(createdIds.indexOf(product.id), 1);

    for (const url of urls) assert.equal(fileExists(url), false, `${url} should be released`);

    const gone = await api(`/api/products/${product.id}`);
    assert.equal(gone.status, 404, gone.text);
  });

  it("refuses gallery writes from non-admins", async () => {
    const product = await createProduct();

    const anonymous = await api(`/api/products/${product.id}/images`, {
      method: "PUT",
      body: { images: [] }
    });
    assert.equal(anonymous.status, 401, anonymous.text);

    const forbidden = await api(`/api/products/${product.id}/images`, {
      method: "PUT",
      token: customer.token,
      body: { images: [] }
    });
    assert.equal(forbidden.status, 403, forbidden.text);

    const forbiddenAppend = await api(`/api/products/${product.id}/images`, {
      method: "POST",
      token: customer.token,
      body: { url: "https://cdn.example.test/nope.png" }
    });
    assert.equal(forbiddenAppend.status, 403, forbiddenAppend.text);
  });

  it("returns 404 for the gallery of a missing product", async () => {
    const missing = await api("/api/products/99999999/images", {
      method: "PUT",
      token: admin.token,
      body: { images: [] }
    });
    assert.equal(missing.status, 404, missing.text);
  });
});
