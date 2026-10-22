// test/productImageReplace.test.js — Phase D (checklist item 6)
//
// PUT /api/products/:id now accepts multipart, so an existing product's image
// can be replaced on a local-disk deployment (hosted deployments keep using the
// signed-upload flow). Covered here:
//   - replacement writes the new file and deletes the old one AFTER commit
//   - a shared reference is never deleted out from under another product
//   - spoofed/unsupported files are rejected and leave nothing behind
//   - non-admins never reach multer
//   - removing an image or deleting a product releases the file
//
// SAFETY: shared harness — scratch test DB only (buyoDB_ph2_test). Uploads are
// written to backend/uploads (the real local driver) and cleaned up by
// releasing each product at the end of the run.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const helpers = require("./helpers");

const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const GIF = Buffer.from("GIF89a-fake-but-valid-header", "ascii");

function uploadedName(reference) {
  return path.basename(String(reference || ""));
}

function fileExists(reference) {
  return fs.existsSync(path.join(UPLOADS_DIR, uploadedName(reference)));
}

async function multipart(baseUrl, pathname, token, { fields = {}, file, filename = "shot.png", type = "image/png" } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  if (file) form.set("image", new Blob([file], { type }), filename);

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(baseUrl + pathname, { method: "PUT", headers, body: form });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON error body
  }
  return { status: res.status, text, json };
}

describe("Product image replacement (Phase D)", () => {
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
        name: `Image replace ${Date.now()}-${createdIds.length}`,
        category: "Image tests",
        mrpPrice: 200,
        sellingPrice: 150,
        stock: 4,
        ...overrides
      }
    });
    assert.equal(res.status, 201, res.text);
    createdIds.push(res.json.product.id);
    return res.json.product;
  }

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);
    customer = await helpers.createVerifiedUser(ctx.baseUrl, { name: "Not An Admin" });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  });

  after(async () => {
    // Destroying via the API releases each image (shared references survive
    // until the last product is gone).
    for (const id of createdIds.reverse()) {
      await api(`/api/products/${id}`, { method: "DELETE", token: admin.token });
    }
    await ctx.close();
  });

  it("replaces the image, keeps other fields and deletes the old file", async () => {
    const product = await createProduct({ description: "Keep me", stock: 9 });

    const first = await multipart(ctx.baseUrl, `/api/products/${product.id}`, admin.token, { file: PNG });
    assert.equal(first.status, 200, first.text);
    const firstImage = first.json.product.image;
    assert.match(firstImage, /^\/uploads\/\d+-[0-9a-f]+\.png$/);
    assert.ok(fileExists(firstImage), "first upload must exist on disk");
    assert.equal(first.json.product.name, product.name);
    assert.equal(first.json.product.description, "Keep me");
    assert.equal(first.json.product.stock, 9);

    const second = await multipart(ctx.baseUrl, `/api/products/${product.id}`, admin.token, {
      file: GIF,
      filename: "second.gif",
      type: "image/gif"
    });
    assert.equal(second.status, 200, second.text);
    const secondImage = second.json.product.image;
    assert.notEqual(secondImage, firstImage);
    assert.ok(fileExists(secondImage), "replacement must exist on disk");
    assert.equal(fileExists(firstImage), false, "the replaced file must be gone");

    // The storefront product endpoint serves the new reference.
    const detail = await api(`/api/products/${product.id}`);
    assert.equal(detail.json.product.image, secondImage);
  });

  it("never deletes a file another product still references", async () => {
    const primary = await createProduct();
    const seeded = await multipart(ctx.baseUrl, `/api/products/${primary.id}`, admin.token, { file: PNG });
    assert.equal(seeded.status, 200, seeded.text);
    const shared = seeded.json.product.image;
    assert.ok(fileExists(shared));

    // Second product deliberately points at the same local file (allowed in
    // local mode, same as any other existing /uploads/ reference).
    const mirror = await createProduct({ image: shared });
    assert.equal(mirror.image, shared);

    const replaced = await multipart(ctx.baseUrl, `/api/products/${primary.id}`, admin.token, {
      file: GIF,
      filename: "new.gif",
      type: "image/gif"
    });
    assert.equal(replaced.status, 200, replaced.text);

    assert.ok(fileExists(shared), "a shared image must survive one product's replacement");

    // Once the mirror lets go too, the file can be released.
    const cleared = await api(`/api/products/${mirror.id}`, {
      method: "PUT",
      token: admin.token,
      body: { image: "" }
    });
    assert.equal(cleared.status, 200, cleared.text);
    assert.equal(cleared.json.product.image, "");
    assert.equal(fileExists(shared), false, "the last reference released the file");
  });

  it("rejects a spoofed image and leaves the product and disk untouched", async () => {
    const product = await createProduct();
    const before = await multipart(ctx.baseUrl, `/api/products/${product.id}`, admin.token, { file: PNG });
    assert.equal(before.status, 200, before.text);
    const originalImage = before.json.product.image;

    const beforeFiles = new Set(fs.readdirSync(UPLOADS_DIR));
    const spoofed = await multipart(ctx.baseUrl, `/api/products/${product.id}`, admin.token, {
      file: Buffer.from("<html><script>alert(1)</script>", "utf8"),
      filename: "evil.png",
      type: "image/png"
    });
    assert.equal(spoofed.status, 400, spoofed.text);
    assert.match(spoofed.text, /not a valid image/i);

    const detail = await api(`/api/products/${product.id}`);
    assert.equal(detail.json.product.image, originalImage, "the product row must be unchanged");

    const leaked = fs.readdirSync(UPLOADS_DIR).filter((name) => !beforeFiles.has(name));
    assert.deepEqual(leaked, [], `rejected bytes must not stay on disk: ${leaked.join(", ")}`);
  });

  it("rejects an unsupported file type instead of silently ignoring it", async () => {
    const product = await createProduct();
    const res = await multipart(ctx.baseUrl, `/api/products/${product.id}`, admin.token, {
      file: Buffer.from("plain text", "utf8"),
      filename: "notes.txt",
      type: "text/plain"
    });
    assert.equal(res.status, 400, res.text);
    assert.match(res.text, /Unsupported image type/i);

    const detail = await api(`/api/products/${product.id}`);
    assert.equal(detail.json.product.image, "");
  });

  it("rejects invalid imageMeta JSON sent through a form", async () => {
    const product = await createProduct();
    const beforeFiles = new Set(fs.readdirSync(UPLOADS_DIR));

    const res = await multipart(ctx.baseUrl, `/api/products/${product.id}`, admin.token, {
      file: PNG,
      fields: { imageMeta: "{not json" }
    });
    assert.equal(res.status, 400, res.text);
    assert.match(res.text, /imageMeta must be valid JSON/i);

    const leaked = fs.readdirSync(UPLOADS_DIR).filter((name) => !beforeFiles.has(name));
    assert.deepEqual(leaked, [], "a validation failure must remove the upload");
  });

  it("accepts alt text alongside the file in one request", async () => {
    const product = await createProduct();
    const res = await multipart(ctx.baseUrl, `/api/products/${product.id}`, admin.token, {
      file: PNG,
      fields: { imageMeta: { alt: "A blue bottle on a white background" } }
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.product.imageMeta.alt, "A blue bottle on a white background");
  });

  it("refuses non-admins before multer can write anything", async () => {
    const product = await createProduct();
    const beforeFiles = new Set(fs.readdirSync(UPLOADS_DIR));

    const anonymous = await multipart(ctx.baseUrl, `/api/products/${product.id}`, null, { file: PNG });
    assert.equal(anonymous.status, 401, anonymous.text);

    const forbidden = await multipart(ctx.baseUrl, `/api/products/${product.id}`, customer.token, { file: PNG });
    assert.equal(forbidden.status, 403, forbidden.text);

    const leaked = fs.readdirSync(UPLOADS_DIR).filter((name) => !beforeFiles.has(name));
    assert.deepEqual(leaked, [], "unauthorised requests must not write uploads");
  });

  it("removing an image through JSON deletes the file", async () => {
    const product = await createProduct();
    const uploaded = await multipart(ctx.baseUrl, `/api/products/${product.id}`, admin.token, { file: PNG });
    const image = uploaded.json.product.image;
    assert.ok(fileExists(image));

    const removed = await api(`/api/products/${product.id}`, {
      method: "PUT",
      token: admin.token,
      body: { image: "" }
    });
    assert.equal(removed.status, 200, removed.text);
    assert.equal(removed.json.product.image, "");
    assert.equal(fileExists(image), false);
  });

  it("deleting a product releases its unshared image", async () => {
    const product = await createProduct();
    const uploaded = await multipart(ctx.baseUrl, `/api/products/${product.id}`, admin.token, { file: PNG });
    const image = uploaded.json.product.image;
    assert.ok(fileExists(image));

    const removed = await api(`/api/products/${product.id}`, { method: "DELETE", token: admin.token });
    assert.equal(removed.status, 200, removed.text);
    createdIds.splice(createdIds.indexOf(product.id), 1);
    assert.equal(fileExists(image), false);
  });
});
