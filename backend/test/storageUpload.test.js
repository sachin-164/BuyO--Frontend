// test/storageUpload.test.js — Phase 12: direct-to-storage upload API.
//
// The app boots with STORAGE_DRIVER=supabase and a MOCKED Supabase storage
// client (test/mockSupabaseStorage.js, injected via the adapter's test seam).
// NO real SDK client is constructed, NO network request happens, and NO
// Supabase project is contacted. Every "storage" behavior asserted here is
// MOCKED; real remote upload remains unverified (docs/storage-phase12.md).
process.env.NODE_ENV = "test";
process.env.STORAGE_DRIVER = "supabase";
process.env.SUPABASE_URL = "https://unit-test-project.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key-not-a-secret";
process.env.UPLOAD_AUTH_TTL_MS = "600000"; // 10 min default; the expiry test lowers it temporarily

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const helpers = require("./helpers");
const imageStore = require("../lib/imageStore");
const { uploadLedger, UploadLedger } = require("../lib/uploadLedger");
const { createMockSupabase } = require("./mockSupabaseStorage");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let ctx;
let admin;
let admin2;
let mock;

async function makeSecondAdmin(baseUrl) {
  const u = await helpers.createVerifiedUser(baseUrl);
  const User = require("../models/user");
  await User.update({ role: "admin" }, { where: { email: u.email } });
  return u;
}

async function authorize(overrides = {}, token = admin.token) {
  return helpers.api(ctx.baseUrl, "/api/uploads/authorize", {
    method: "POST",
    body: { contentType: "image/png", size: PNG.length, filename: "shot.png", ...overrides },
    token
  });
}

async function createProduct(image, extra = {}, token = admin.token) {
  return helpers.api(ctx.baseUrl, "/api/products", {
    method: "POST",
    body: { name: "Storage Lamp", category: "storage", mrpPrice: 100, sellingPrice: 90, image, ...extra },
    token
  });
}

before(async () => {
  mock = createMockSupabase();
  imageStore.__setSupabaseClientForTests(mock.client); // MOCK seam — no real SDK
  ctx = await helpers.startTestApp();
  admin = await helpers.createAdminUser(ctx.baseUrl);
  admin2 = await makeSecondAdmin(ctx.baseUrl);
});

after(async () => {
  // Clear before closing the pool: after-hook order is LIFO for nested hooks,
  // and ctx.close() shuts the Sequelize pool down.
  await uploadLedger.clear();
  await ctx.close();
  imageStore.__resetImageStoreForTests();
});

test("authorize: unauthenticated and non-admin requests are rejected", async () => {
  const anon = await authorize({}, null);
  assert.equal(anon.status, 401);

  const customer = await helpers.createVerifiedUser(ctx.baseUrl);
  const asCustomer = await authorize({}, customer.token);
  assert.equal(asCustomer.status, 403);
  assert.equal(mock.calls.signed.length, 0, "no authorization may be minted for non-admins");
});

test("authorize: disallowed MIME type is refused without minting an upload URL", async () => {
  const before = mock.calls.signed.length;
  const res = await authorize({ contentType: "text/html" });
  assert.equal(res.status, 400, res.text);
  assert.ok(res.json.errors.some((e) => /contentType/.test(e)));
  assert.equal(mock.calls.signed.length, before, "no signed upload for rejected types");
});

test("authorize: oversized and zero/negative sizes are refused", async () => {
  const tooBig = await authorize({ size: 5 * 1024 * 1024 + 1 });
  assert.equal(tooBig.status, 400);
  assert.ok(tooBig.json.errors.some((e) => /at most/.test(e)), "limit must be named");
  assert.equal((await authorize({ size: 0 })).status, 400);
  assert.equal((await authorize({ size: -5 })).status, 400);
});

test("authorize: unsafe original filenames are refused (never used for naming anyway)", async () => {
  for (const filename of ["../../evil.png", "a\\b.png", "x\u0000.png", "."]) {
    const res = await authorize({ filename });
    assert.equal(res.status, 400, `filename ${JSON.stringify(filename)} must be refused`);
  }
});

test("authorize: success returns a short-lived single-path authorization (MOCKED SDK)", async () => {
  const res = await authorize();
  assert.equal(res.status, 201, res.text);
  assert.match(res.json.objectPath, /^products\/\d{13}-[0-9a-f]{16}\.png$/, "server-generated name only");
  assert.ok(res.json.signedUploadUrl.startsWith("https://"), "short-lived upload URL handed to the client");
  assert.ok(res.json.publicUrl.endsWith(res.json.objectPath));
  assert.ok(new Date(res.json.expiresAt).getTime() > Date.now(), "expiry in the future");
  assert.ok(!res.text.includes(SERVICE_KEY), "service-role key must never appear in responses");
  assert.equal(res.json.maxBytes, 5 * 1024 * 1024);
});

test("full flow: authorize -> upload bytes -> create product stores the durable URL (MOCKED SDK)", async () => {
  const auth = await authorize();
  assert.equal(auth.status, 201);
  mock.seed(auth.json.objectPath, PNG, "image/png"); // simulated admin-client PUT to storage

  const created = await createProduct(auth.json.objectPath);
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.product.image, auth.json.publicUrl, "DB stores the durable public URL");
  assert.ok(mock.calls.downloads >= 1, "server must verify the stored object before saving");
  assert.ok(!created.text.includes(SERVICE_KEY));
});

test("storage failure before product creation -> 502, no row written (MOCKED SDK)", async () => {
  const Product = require("../models/product");
  const before = await Product.count();

  const auth = await authorize();
  mock.seed(auth.json.objectPath, PNG, "image/png");
  mock.objects.get(auth.json.objectPath).infoError = { message: "storage hiccup", statusCode: 500 };

  const created = await createProduct(auth.json.objectPath);
  assert.equal(created.status, 502, created.text);
  assert.equal(await Product.count(), before, "no product row may be created when verification fails");
});

test("MIME spoofing through storage: HTML bytes under image/png -> 400 and object removed (MOCKED)", async () => {
  const Product = require("../models/product");
  const before = await Product.count();

  const auth = await authorize();
  mock.seed(auth.json.objectPath, Buffer.from("<html><script>alert(1)</script>"), "image/png");

  const created = await createProduct(auth.json.objectPath);
  assert.equal(created.status, 400, created.text);
  assert.ok(/verification/i.test(created.json.message));
  assert.ok(!mock.objects.has(auth.json.objectPath), "spoofed object must be deleted");
  assert.equal(await Product.count(), before);
});

test("restricted authorization: uploaded bytes differing in size from the authorization -> 400", async () => {
  const auth = await authorize({ size: 4 });
  mock.seed(auth.json.objectPath, Buffer.concat([PNG, PNG]), "image/png"); // 8 bytes != authorized 4
  const created = await createProduct(auth.json.objectPath);
  assert.equal(created.status, 400);
  assert.ok(!mock.objects.has(auth.json.objectPath), "mismatched object must be deleted");
});

test("upload authorization expiry -> 410", async () => {
  process.env.UPLOAD_AUTH_TTL_MS = "1000"; // minimum allowed
  try {
    const auth = await authorize();
    assert.equal(auth.status, 201);
    mock.seed(auth.json.objectPath, PNG, "image/png");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const created = await createProduct(auth.json.objectPath);
    assert.equal(created.status, 410, created.text);
  } finally {
    process.env.UPLOAD_AUTH_TTL_MS = "600000";
  }
});

test("unknown and replayed authorizations are refused", async () => {
  const unknown = await createProduct("products/1700000000000-0000000000000000.png");
  assert.equal(unknown.status, 400);
  assert.ok(/not found or already used/.test(unknown.json.message));

  const auth = await authorize();
  mock.seed(auth.json.objectPath, PNG, "image/png");
  const first = await createProduct(auth.json.objectPath);
  assert.equal(first.status, 201, first.text);
  const replay = await createProduct(auth.json.objectPath);
  assert.equal(replay.status, 400, "single-use: the same authorization cannot be replayed");
});

test("one admin cannot consume another admin's upload authorization", async () => {
  const auth = await authorize();
  mock.seed(auth.json.objectPath, PNG, "image/png");
  const stolen = await createProduct(auth.json.objectPath, {}, admin2.token);
  assert.equal(stolen.status, 403, stolen.text);
});

test("durable ledger is shared across instances, single-use, expiry-aware and bounded", async () => {
  const ledgerA = new UploadLedger();
  const ledgerB = new UploadLedger();
  await ledgerA.clear();

  const base = {
    adminId: admin.user.id,
    mimetype: "image/png",
    size: PNG.length,
    ttlMs: 60000
  };

  // Instance A authorizes; instance B consumes. This is the exact Vercel
  // failure mode the old per-process Map could not handle.
  const put = await ledgerA.put("products/1700000000999-aaaaaaaaaaaaaaaa.png", base);
  assert.equal(put.status, "ok");
  const across = await ledgerB.take("products/1700000000999-aaaaaaaaaaaaaaaa.png", admin.user.id);
  assert.equal(across.status, "ok");
  assert.equal(across.entry.mimetype, "image/png");
  assert.equal(across.entry.size, PNG.length);
  assert.equal(
    (await ledgerA.take("products/1700000000999-aaaaaaaaaaaaaaaa.png", admin.user.id)).status,
    "missing",
    "single-use: replay is refused across instances too"
  );

  // A failed (wrong-admin) attempt still consumes the row.
  await ledgerA.put("products/1700000001000-bbbbbbbbbbbbbbbb.png", base);
  assert.equal(
    (await ledgerB.take("products/1700000001000-bbbbbbbbbbbbbbbb.png", admin2.user.id)).status,
    "forbidden"
  );
  assert.equal(
    (await ledgerA.take("products/1700000001000-bbbbbbbbbbbbbbbb.png", admin.user.id)).status,
    "missing"
  );

  // Expired rows are classified and removed.
  await ledgerA.put("products/1700000001001-cccccccccccccccc.png", {
    ...base,
    ttlMs: 1000,
    now: Date.now() - 5000
  });
  assert.equal(
    (await ledgerB.take("products/1700000001001-cccccccccccccccc.png", admin.user.id)).status,
    "expired"
  );

  // Bounded growth: expired rows are pruned; the cap then refuses new work.
  const bounded = new UploadLedger({ maxEntries: 1 });
  await bounded.clear();
  await bounded.put("products/1700000001002-dddddddddddddddd.png", { ...base, ttlMs: 1, now: Date.now() - 100 });
  assert.equal((await bounded.put("products/1700000001003-eeeeeeeeeeeeeeee.png", base)).status, "ok");
  assert.equal((await bounded.put("products/1700000001004-ffffffffffffffff.png", base)).status, "full");
  await bounded.clear();
});

test("invalid object paths are refused before any storage or ledger touch", async () => {
  for (const image of ["products/../../etc/passwd", "products/x", "products/", "Products/1700000000000-abcdef0123456789.png"]) {
    const res = await createProduct(image);
    assert.equal(res.status, 400, `path ${JSON.stringify(image)} must be refused`);
  }
});

test("database failure after verified upload -> 500 and the object is removed (orphan handling, MOCKED)", async () => {
  const Product = require("../models/product");
  const auth = await authorize();
  mock.seed(auth.json.objectPath, PNG, "image/png");

  const originalCreate = Product.create;
  Product.create = async () => {
    throw new Error("injected db failure (Phase 12 orphan test)");
  };
  try {
    const created = await createProduct(auth.json.objectPath);
    assert.equal(created.status, 500, created.text);
  } finally {
    Product.create = originalCreate;
  }
  assert.ok(mock.calls.removed.includes(auth.json.objectPath), "just-uploaded object must be removed on DB failure");
  assert.ok(!mock.objects.has(auth.json.objectPath));
});

test("hosted mode: multipart uploads are rejected with no file left behind", async () => {
  const uploadsDir = path.join(__dirname, "..", "uploads");
  const before = new Set(fs.readdirSync(uploadsDir));

  const form = new FormData();
  form.append("name", "Hosted Multipart");
  form.append("category", "storage");
  form.append("mrpPrice", "100");
  form.append("sellingPrice", "90");
  form.append("image", new Blob([PNG], { type: "image/png" }), "hosted.png");
  const res = await fetch(ctx.baseUrl + "/api/products", {
    method: "POST",
    headers: { Authorization: `Bearer ${admin.token}` },
    body: form
  });
  const json = await res.json();
  assert.equal(res.status, 409, JSON.stringify(json));
  assert.equal(json.code, "multipart-disabled");

  const leaked = fs.readdirSync(uploadsDir).filter((f) => !before.has(f));
  assert.deepEqual(leaked, [], `hosted mode must not write uploads to disk: ${leaked.join(", ")}`);
});

test("hosted mode: new /uploads/ references are refused; legacy records stay untouched", async () => {
  const refused = await createProduct("/uploads/new-ephemeral.png");
  assert.equal(refused.status, 400, "hosted mode must not accept NEW ephemeral references");

  // A pre-existing legacy record (written directly, as in the old deployment)
  // must keep its reference through the API.
  const Product = require("../models/product");
  const legacy = await Product.create({
    name: "Legacy Storage Lamp",
    category: "storage",
    mrpPrice: 100,
    sellingPrice: 90,
    image: "/uploads/legacy-prior.png",
    slug: `legacy-storage-${Date.now()}`,
    stock: 0
  });
  const fetched = await helpers.api(ctx.baseUrl, `/api/products/${legacy.id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.product.image, "/uploads/legacy-prior.png", "existing references must survive unchanged");
  await legacy.destroy();
});

test("external http(s) image URLs still pass through (existing feature)", async () => {
  const res = await createProduct("https://cdn.example.com/product.png");
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.product.image, "https://cdn.example.com/product.png");
});

test("update flow: verified pending upload replaces the image; unverified bucket URLs are refused", async () => {
  const Product = require("../models/product");
  const product = await Product.create({
    name: "Storage Update Lamp",
    category: "storage",
    mrpPrice: 100,
    sellingPrice: 90,
    image: "",
    slug: `storage-update-${Date.now()}`,
    stock: 0
  });

  // Unverified own-bucket URL -> 400 (no ledger authorization proof)
  const unverified = await helpers.api(ctx.baseUrl, `/api/products/${product.id}`, {
    method: "PUT",
    body: { image: `${process.env.SUPABASE_URL}/storage/v1/object/public/product-images/products/1700000000099-abcdef0123456789.png` },
    token: admin.token
  });
  assert.equal(unverified.status, 400, unverified.text);

  // Re-sending the product's CURRENT image value is a no-op (no ledger needed)
  const same = await helpers.api(ctx.baseUrl, `/api/products/${product.id}`, {
    method: "PUT",
    body: { image: product.image },
    token: admin.token
  });
  assert.equal(same.status, 200, same.text);

  // Verified pending upload -> durable URL stored
  const auth = await authorize();
  mock.seed(auth.json.objectPath, PNG, "image/png");
  const updated = await helpers.api(ctx.baseUrl, `/api/products/${product.id}`, {
    method: "PUT",
    body: { image: auth.json.objectPath },
    token: admin.token
  });
  assert.equal(updated.status, 200, updated.text);
  assert.equal(updated.json.product.image, auth.json.publicUrl);
  await product.destroy();
});

test("the real Supabase SDK is never constructed in this suite", () => {
  assert.equal(imageStore.__getSdkCreationCountForTests(), 0, "every storage call here must go through the MOCK");
});
