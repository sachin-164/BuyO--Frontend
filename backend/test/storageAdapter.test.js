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
  it("refuses unsafe references and passes external URLs through", async () => {
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

      // Invalid shape -> 400 before any ledger/storage touch.
      await assert.rejects(() => resolveProductImageValue("products/../../x", 1), (err) => err.status === 400);

      // New /uploads/ writes refused in hosted mode (no ephemeral refs).
      await assert.rejects(() => resolveProductImageValue("/uploads/x.png", 1), (err) => err.status === 400);

      // External URLs pass through unchanged (existing feature).
      const ext = await resolveProductImageValue("https://cdn.example.com/a.png", 1);
      assert.deepEqual(ext, { value: "https://cdn.example.com/a.png", cleanupPath: null });

      // The durable ledger + real-object path (missing/replay/expiry/foreign,
      // bad signatures, size mismatch, transient 502) is covered end-to-end by
      // test/storageUpload.test.js against the scratch database.
    } finally {
      delete process.env.STORAGE_DRIVER;
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
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
