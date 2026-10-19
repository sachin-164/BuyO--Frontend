// test/adminUploadFlow.test.js — Phase 12: admin/js/storage-upload.js.
// MOCKED network: apiPost/putBytes are injected fakes — no server, no storage,
// no browser. This pins the CLIENT orchestration logic only; real browser
// behavior against real storage remains unverified (docs/storage-phase12.md).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const storageUpload = require("../../admin/js/storage-upload.js");

const FILE = { type: "image/png", size: 4, name: "shot.png" };

test("local mode: 409 code local-storage falls back to multipart (no byte upload attempted)", async () => {
  const calls = [];
  const res = await storageUpload.uploadProductImage({
    file: FILE,
    apiPost: async (p, body) => {
      calls.push({ p, body });
      return { ok: false, status: 409, data: { code: "local-storage", message: "local" } };
    },
    putBytes: async () => {
      calls.push({ putBytes: true });
      return { ok: true, status: 200 };
    }
  });
  assert.deepEqual(res, { mode: "multipart" });
  assert.equal(calls.length, 1, "only the authorize probe may happen before falling back");
  assert.equal(calls[0].p, "/uploads/authorize");
  assert.deepEqual(calls[0].body, { contentType: "image/png", size: 4, filename: "shot.png" });
});

test("direct flow (MOCKED): authorize -> PUT bytes to the signed URL -> object path returned", async () => {
  const order = [];
  const res = await storageUpload.uploadProductImage({
    file: FILE,
    apiPost: async (p, body) => {
      order.push("authorize:" + p);
      assert.deepEqual(body, { contentType: "image/png", size: 4, filename: "shot.png" });
      return {
        ok: true,
        status: 201,
        data: { objectPath: "products/1700000000000-abcdef0123456789.png", signedUploadUrl: "https://mock-storage.invalid/sign/1" }
      };
    },
    putBytes: async (signedUrl, file, contentType) => {
      order.push("put:" + signedUrl);
      assert.equal(signedUrl, "https://mock-storage.invalid/sign/1");
      assert.equal(file, FILE);
      assert.equal(contentType, "image/png");
      return { ok: true, status: 200 };
    }
  });
  assert.deepEqual(order, [
    "authorize:/uploads/authorize",
    "put:https://mock-storage.invalid/sign/1"
  ]);
  assert.equal(res.mode, "direct");
  assert.equal(res.objectPath, "products/1700000000000-abcdef0123456789.png");
});

test("authorize failure -> error mode, no byte upload, message surfaced", async () => {
  let putCalled = false;
  const res = await storageUpload.uploadProductImage({
    file: FILE,
    apiPost: async () => ({ ok: false, status: 400, message: "Validation failed" }),
    putBytes: async () => {
      putCalled = true;
      return { ok: true, status: 200 };
    }
  });
  assert.equal(res.mode, "error");
  assert.equal(res.status, 400);
  assert.equal(res.message, "Validation failed");
  assert.equal(putCalled, false, "no bytes may be uploaded without authorization");
});

test("storage PUT failure -> error mode; the caller must not create the product", async () => {
  const res = await storageUpload.uploadProductImage({
    file: FILE,
    apiPost: async () => ({
      ok: true,
      status: 201,
      data: { objectPath: "products/1700000000000-abcdef0123456789.png", signedUploadUrl: "https://mock-storage.invalid/sign/2" }
    }),
    putBytes: async () => ({ ok: false, status: 500 })
  });
  assert.equal(res.mode, "error");
  assert.ok(/Nothing was saved/.test(res.message));
  assert.equal(res.objectPath, undefined, "error results must not carry an objectPath");
});

test("network exceptions on authorize become error mode (never a crash)", async () => {
  const res = await storageUpload.uploadProductImage({
    file: FILE,
    apiPost: async () => {
      throw new Error("offline");
    }
  });
  assert.equal(res.mode, "error");
});

test("missing file is an error", async () => {
  const res = await storageUpload.uploadProductImage({
    file: null,
    apiPost: async () => ({ ok: true, status: 201, data: {} })
  });
  assert.equal(res.mode, "error");
});
