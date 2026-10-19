// test/storageAdapter.test.js — Phase 12: storage adapter unit tests.
// Pure function/adapter tests — NO app boot, NO database, NO network.
// Supabase-driver behavior here uses the clearly-labeled MOCK client seam.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  ALLOWED_IMAGE_TYPES,
  PENDING_PATH_SHAPE,
  verifyImageBuffer,
  generateImageName,
  isHostedEnv,
  resolveStorageDriver,
  resolveStorageConfig,
  resolveMaxImageBytes,
  getImageStore,
  resolveProductImageValue,
  __setSupabaseClientForTests,
  __resetImageStoreForTests,
  __getSdkCreationCountForTests
} = require("../lib/imageStore");
const { UploadLedger } = require("../lib/uploadLedger");
const { createMockSupabase } = require("./mockSupabaseStorage");

const SUPA_ENV = {
  STORAGE_DRIVER: "supabase",
  SUPABASE_URL: "https://unit-test-project.supabase.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "mock-service-key-not-a-secret"
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("Storage adapter: driver resolution and hosted no-fallback rules", () => {
  it("defaults to local off-hosted; hosted envs must configure explicitly", () => {
    assert.equal(resolveStorageDriver({}), "local");
    assert.equal(isHostedEnv({ VERCEL: "1" }), true);
    assert.equal(isHostedEnv({ NODE_ENV: "production" }), true);
    assert.throws(() => resolveStorageDriver({ VERCEL: "1" }), /STORAGE_DRIVER must be set explicitly/);
    assert.throws(() => resolveStorageDriver({ NODE_ENV: "production" }), /ephemeral local-disk/);
  });

  it("supabase driver without config throws (no silent fallback)", () => {
    assert.throws(() => resolveStorageDriver({ STORAGE_DRIVER: "supabase" }), /requires SUPABASE_URL/);
    assert.throws(
      () => resolveStorageDriver({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "https://x.supabase.co" }),
      /requires SUPABASE_SERVICE_ROLE_KEY/
    );
    assert.throws(() => resolveStorageDriver({ STORAGE_DRIVER: "gcs" }), /Unsupported STORAGE_DRIVER/);
    assert.equal(resolveStorageDriver({ STORAGE_DRIVER: "local", VERCEL: "1" }), "local", "explicit local is honored");
    assert.equal(resolveStorageDriver(SUPA_ENV), "supabase");
  });

  it("config errors never echo credential values", () => {
    try {
      resolveStorageDriver({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "https://x.supabase.co" });
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(!err.message.includes("supabase.co"), "message must not echo configured values");
    }
  });

  it("size/TTL limits are configurable and clamped", () => {
    assert.equal(resolveMaxImageBytes({}), 5 * 1024 * 1024, "default preserved: 5 MB");
    assert.equal(resolveMaxImageBytes({ MAX_IMAGE_BYTES: "1048576" }), 1048576);
    assert.equal(resolveMaxImageBytes({ MAX_IMAGE_BYTES: "100" }), 1024, "min clamp 1 KB");
    assert.equal(resolveMaxImageBytes({ MAX_IMAGE_BYTES: "999999999" }), 25 * 1024 * 1024, "max clamp 25 MB");
    assert.equal(resolveMaxImageBytes({ MAX_IMAGE_BYTES: "garbage" }), 5 * 1024 * 1024, "garbage -> default");

    const cfg = resolveStorageConfig({ UPLOAD_AUTH_TTL_MS: "10" });
    assert.equal(cfg.uploadAuthTtlMs, 1000, "TTL min clamp 1 s");
    assert.equal(resolveStorageConfig({ UPLOAD_AUTH_TTL_MS: "nope" }).uploadAuthTtlMs, 10 * 60 * 1000);
    assert.equal(resolveStorageConfig({}).bucket, "product-images");
    assert.throws(() => resolveStorageConfig({ SUPABASE_STORAGE_BUCKET: "a/b" }), /SUPABASE_STORAGE_BUCKET/);
    assert.throws(() => resolveStorageConfig({ ...SUPA_ENV, SUPABASE_URL: "not a url" }), /SUPABASE_URL/);
  });
});

describe("Storage adapter: shared image signature helpers", () => {
  it("validates magic bytes for all allowed types (and rejects others)", () => {
    assert.equal(verifyImageBuffer(PNG, "image/png"), true);
    assert.equal(verifyImageBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"), true);
    assert.equal(verifyImageBuffer(Buffer.from("GIF89a...."), "image/gif"), true);
    assert.equal(verifyImageBuffer(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]), "image/webp"), true);
    assert.equal(verifyImageBuffer(Buffer.from("<html><script>"), "image/png"), false, "spoofed content fails");
    assert.equal(verifyImageBuffer(PNG, "text/html"), false, "non-image type never validates");
    assert.equal(verifyImageBuffer(Buffer.from([1, 2]), "image/png"), false, "too-short buffer fails");
  });

  it("generates server-only object names (timestamp-random.ext)", () => {
    const name = generateImageName("image/png");
    assert.match(name, /^\d{13}-[0-9a-f]{16}\.png$/);
    assert.match(generateImageName("application/octet-stream"), /\.img$/, "unknown type gets inert extension");
    assert.equal(Object.keys(ALLOWED_IMAGE_TYPES).length, 4);
  });

  it("pending path shape blocks traversal", () => {
    assert.equal(PENDING_PATH_SHAPE.test("products/1700000000000-abcdef0123456789.png"), true);
    assert.equal(PENDING_PATH_SHAPE.test("products/../../etc/passwd"), false);
    assert.equal(PENDING_PATH_SHAPE.test("products/a/b.png"), false);
    assert.equal(PENDING_PATH_SHAPE.test("products/.hidden"), false);
    assert.equal(PENDING_PATH_SHAPE.test("other/1700000000000-abcdef0123456789.png"), false);
  });
});

describe("Storage adapter: local driver (existing behavior preserved)", () => {
  it("saveImage writes into backend/uploads and returns /uploads/ references", async () => {
    const store = getImageStore({});
    assert.equal(store.driver, "local");
    const saved = await store.saveImage({ buffer: PNG, mimetype: "image/png" });
    assert.match(saved.reference, /^\/uploads\/\d{13}-[0-9a-f]{16}\.png$/);
    const file = path.join(__dirname, "..", "uploads", path.basename(saved.reference));
    assert.ok(fs.existsSync(file), "file must exist in backend/uploads");
    assert.deepEqual(fs.readFileSync(file), PNG);
    await store.removeImage({ reference: saved.reference });
    assert.ok(!fs.existsSync(file));
  });

  it("removeImage confines deletion to the uploads dir (traversal-safe)", async () => {
    const store = getImageStore({});
    const name = `unit-traversal-${Date.now()}.png`;
    const file = path.join(__dirname, "..", "uploads", name);
    fs.writeFileSync(file, PNG);
    await store.removeImage({ reference: `/uploads/../../${name}` }); // basename only
    assert.ok(!fs.existsSync(file), "basename confinement must still delete the intended file");
  });

  it("local driver: resolveProductImageValue is a byte-identical passthrough", async () => {
    __resetImageStoreForTests();
    process.env.STORAGE_DRIVER = "";
    try {
      for (const value of ["", "/uploads/anything.png", "products/pending.png", "https://x.example/a.png", "garbage-string"]) {
        const resolved = await resolveProductImageValue(value, 1);
        assert.deepEqual(resolved, { value, cleanupPath: null }, `local passthrough broke for ${JSON.stringify(value)}`);
      }
    } finally {
      delete process.env.STORAGE_DRIVER;
      __resetImageStoreForTests();
    }
  });
});

describe("Storage adapter: supabase driver resolution (MOCKED SDK)", () => {
  it("resolves pending uploads through ledger + verification; rejects unverified references", async () => {
    __resetImageStoreForTests();
    const mock = createMockSupabase();
    __setSupabaseClientForTests(mock.client);

    process.env.STORAGE_DRIVER = "supabase";
    process.env.SUPABASE_URL = SUPA_ENV.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SUPA_ENV.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const store = getImageStore();
      assert.equal(store.driver, "supabase");
      assert.equal(__getSdkCreationCountForTests(), 0, "mock injection must prevent real SDK construction");

      const objectPath = "products/1700000000000-abcdef0123456789.png";

      // No ledger entry -> 400 (authorization proof missing)
      await assert.rejects(
        () => resolveProductImageValue(objectPath, 1),
        (err) => err.status === 400 && /not found or already used/.test(err.publicMessage)
      );

      // Ledger entry + valid stored object -> public URL + cleanup path
      const { uploadLedger } = require("../lib/uploadLedger");
      uploadLedger.clear();
      uploadLedger.put(objectPath, { adminId: 1, mimetype: "image/png", size: PNG.length, ttlMs: 60000 });
      mock.seed(objectPath, PNG, "image/png");
      const resolved = await resolveProductImageValue(objectPath, 1);
      assert.equal(resolved.value, `${SUPA_ENV.SUPABASE_URL}/storage/v1/object/public/product-images/${objectPath}`);
      assert.equal(resolved.cleanupPath, objectPath);
      assert.ok(mock.calls.info >= 1, "verification must query object metadata");

      // Replay of the same path -> consumed, 400
      await assert.rejects(() => resolveProductImageValue(objectPath, 1), (err) => err.status === 400);

      // Expired authorization -> 410 (backdated put, no sleeping)
      const expiredPath = "products/1700000000001-babcdef0123456789.png";
      uploadLedger.put(expiredPath, { adminId: 1, mimetype: "image/png", size: 4, ttlMs: 1000, now: Date.now() - 5000 });
      await assert.rejects(() => resolveProductImageValue(expiredPath, 1), (err) => err.status === 410);

      // Another admin's authorization -> 403
      const foreignPath = "products/1700000000002-cabcdef0123456789.png";
      uploadLedger.put(foreignPath, { adminId: 2, mimetype: "image/png", size: 4, ttlMs: 60000 });
      await assert.rejects(() => resolveProductImageValue(foreignPath, 1), (err) => err.status === 403);

      // Invalid shape -> 400 before any ledger/storage touch
      await assert.rejects(() => resolveProductImageValue("products/../../x", 1), (err) => err.status === 400);

      // New /uploads/ writes refused in hosted mode (no ephemeral refs)
      await assert.rejects(() => resolveProductImageValue("/uploads/x.png", 1), (err) => err.status === 400);

      // External URLs pass through unchanged (existing feature)
      const ext = await resolveProductImageValue("https://cdn.example.com/a.png", 1);
      assert.deepEqual(ext, { value: "https://cdn.example.com/a.png", cleanupPath: null });
    } finally {
      delete process.env.STORAGE_DRIVER;
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      __resetImageStoreForTests();
    }
  });

  it("classifies verification failures: bad content removed, storage errors -> 502", async () => {
    __resetImageStoreForTests();
    const mock = createMockSupabase();
    __setSupabaseClientForTests(mock.client);
    const { uploadLedger } = require("../lib/uploadLedger");

    process.env.STORAGE_DRIVER = "supabase";
    process.env.SUPABASE_URL = SUPA_ENV.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SUPA_ENV.SUPABASE_SERVICE_ROLE_KEY;
    try {
      // Spoofed content (HTML stored under an image/png authorization)
      const spoofed = "products/1700000000010-abcdef0123456789.png";
      uploadLedger.put(spoofed, { adminId: 1, mimetype: "image/png", size: 20, ttlMs: 60000 });
      mock.seed(spoofed, Buffer.from("<html><script>x"), "image/png");
      await assert.rejects(() => resolveProductImageValue(spoofed, 1), (err) => err.status === 400);
      assert.ok(!mock.objects.has(spoofed), "invalid-content object must be removed (orphan control)");
      assert.ok(mock.calls.removed.includes(spoofed));

      // Authorized size mismatch (restricted authorization)
      const wrongSize = "products/1700000000011-abcdef0123456789.png";
      uploadLedger.put(wrongSize, { adminId: 1, mimetype: "image/png", size: 999, ttlMs: 60000 });
      mock.seed(wrongSize, PNG, "image/png");
      await assert.rejects(() => resolveProductImageValue(wrongSize, 1), (err) => err.status === 400);

      // Object never uploaded -> 400 not-found
      const neverUploaded = "products/1700000000012-abcdef0123456789.png";
      uploadLedger.put(neverUploaded, { adminId: 1, mimetype: "image/png", size: 4, ttlMs: 60000 });
      await assert.rejects(() => resolveProductImageValue(neverUploaded, 1), (err) => err.status === 400);

      // Transient storage failure -> 502, object left alone (no destructive guess)
      const storageBroken = "products/1700000000013-abcdef0123456789.png";
      uploadLedger.put(storageBroken, { adminId: 1, mimetype: "image/png", size: 4, ttlMs: 60000 });
      mock.seed(storageBroken, PNG, "image/png");
      mock.objects.get(storageBroken).infoError = { message: "internal error" };
      await assert.rejects(() => resolveProductImageValue(storageBroken, 1), (err) => err.status === 502);
      assert.ok(mock.objects.has(storageBroken), "storage-error must NOT delete the object");
    } finally {
      delete process.env.STORAGE_DRIVER;
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      uploadLedger.clear();
      __resetImageStoreForTests();
    }
  });

  it("incomplete supabase config surfaces as 503 (never a disk fallback)", async () => {
    __resetImageStoreForTests();
    process.env.STORAGE_DRIVER = "supabase";
    delete process.env.SUPABASE_URL; // misconfigured
    try {
      await assert.rejects(() => resolveProductImageValue("products/1700000000020-abcdef0123456789.png", 1), (err) => err.status === 503);
    } finally {
      delete process.env.STORAGE_DRIVER;
      __resetImageStoreForTests();
    }
  });
});

describe("Upload ledger (single-use authorization)", () => {
  it("consumes entries atomically and refuses reuse after any outcome", () => {
    const ledger = new UploadLedger({ maxEntries: 2 });
    const base = { adminId: 1, mimetype: "image/png", size: 4, ttlMs: 1000 };

    assert.equal(ledger.put("products/a.png", base).status, "ok");
    const taken = ledger.take("products/a.png", 1);
    assert.equal(taken.status, "ok");
    assert.equal(taken.entry.adminId, 1);
    assert.equal(taken.entry.mimetype, "image/png");
    assert.equal(ledger.take("products/a.png", 1).status, "missing", "single-use: replay is refused");
  });

  it("classifies expired and foreign authorizations (and still consumes)", () => {
    const ledger = new UploadLedger();
    const base = { adminId: 7, mimetype: "image/png", size: 4, ttlMs: 1000 };
    ledger.put("products/b.png", { ...base, now: Date.now() - 5000 });
    assert.equal(ledger.take("products/b.png", 7).status, "expired");

    ledger.put("products/c.png", base);
    assert.equal(ledger.take("products/c.png", 8).status, "forbidden");
    assert.equal(ledger.take("products/c.png", 7).status, "missing", "failed attempt must not leave a reusable entry");
  });

  it("prunes expired entries and refuses unbounded growth", () => {
    const ledger = new UploadLedger({ maxEntries: 1 });
    const base = { adminId: 1, mimetype: "image/png", size: 4, ttlMs: 1 };
    ledger.put("products/d.png", { ...base, now: Date.now() - 100 });
    assert.equal(ledger.put("products/e.png", base).status, "ok", "expired entry is pruned first");
    assert.equal(ledger.put("products/f.png", base).status, "full", "cap refuses new authorizations");
    ledger.clear();
    assert.equal(ledger.size, 0);
  });
});
