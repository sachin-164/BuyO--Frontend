// lib/imageStore.js — product-image storage adapter (Phase 12).
//
// One interface, two drivers (docs/storage-supabase.md §2):
//   local    — dev default: existing /uploads disk behavior, byte-identical.
//   supabase — Supabase Storage via @supabase/supabase-js (lazy-loaded,
//              disabled unless explicitly configured, MOCK-injectable for tests).
//
// SAFETY CONTRACT:
//   * Hosted environments (VERCEL set, or NODE_ENV=production) REFUSE to
//     default to local disk — STORAGE_DRIVER must be set explicitly there.
//   * STORAGE_DRIVER=supabase without SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//     throws (fail fast, no silent fallback to ephemeral disk).
//   * The service-role key stays server-side only: it is never echoed in
//     error messages, logs, or any HTTP response built from this module.
//   * No DB connection and no network call happens at require/boot time.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ---- shared image constants (single source of truth; productRoutes imports
// these too so the multipart path and the direct-upload path can never drift) ----

const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp"
};

// Minimum discriminating magic-byte prefixes, so tiny synthetic test fixtures
// (e.g. a 4-byte PNG header) still validate — same behavior as Phase 11.
const IMAGE_SIGNATURES = {
  "image/png": (bytes) => bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  "image/jpeg": (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/gif": (bytes) => bytes.length >= 4 && bytes.toString("ascii", 0, 4).startsWith("GIF8"),
  "image/webp": (bytes) =>
    bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
};

function verifyImageBuffer(buffer, mimetype) {
  const matches = IMAGE_SIGNATURES[mimetype];
  if (!matches || !buffer || buffer.length < 4) return false;
  return matches(buffer);
}

// Server-generated object name only — the client-supplied original name never
// reaches storage (timestamp + random hex + extension derived from the
// ALLOWED mimetype, identical format to the historical multer naming).
function generateImageName(mimetype, now = Date.now()) {
  const ext = ALLOWED_IMAGE_TYPES[mimetype] || ".img";
  return `${now}-${crypto.randomBytes(8).toString("hex")}${ext}`;
}

// ---- configuration ----

const DEFAULT_BUCKET = "product-images";
const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // preserves the current 5 MB cap
const MIN_IMAGE_BYTES = 1024;
const MAX_IMAGE_BYTES_CAP = 25 * 1024 * 1024;
const DEFAULT_UPLOAD_AUTH_TTL_MS = 10 * 60 * 1000;
const MIN_UPLOAD_AUTH_TTL_MS = 1000;
const MAX_UPLOAD_AUTH_TTL_MS = 60 * 60 * 1000;

// The only object-path shape this server ever mints or accepts for pending
// uploads: "products/<safe-single-segment>". No "/" beyond the prefix and no
// leading dot, so traversal ("products/../../x") is rejected by shape alone.
const PENDING_PATH_SHAPE = /^products\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

function isHostedEnv(env) {
  return Boolean(env.VERCEL) || String(env.NODE_ENV || "").toLowerCase() === "production";
}

// STORAGE_DRIVER unset: local only off-hosted; hosted must choose explicitly.
function resolveStorageDriver(env = process.env) {
  const raw = String(env.STORAGE_DRIVER || "").trim().toLowerCase();
  if (raw === "") {
    if (isHostedEnv(env)) {
      throw new Error(
        "STORAGE_DRIVER must be set explicitly in hosted/production environments " +
          '(refusing to default to ephemeral local-disk storage): set "supabase" ' +
          "(with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) or \"local\" only on a deployment with persistent disk"
      );
    }
    return "local";
  }
  if (raw !== "local" && raw !== "supabase") {
    throw new Error(`Unsupported STORAGE_DRIVER "${raw}" (expected "local" or "supabase")`);
  }
  if (raw === "supabase") {
    // Messages name the variable, never its value.
    if (!String(env.SUPABASE_URL || "").trim()) {
      throw new Error("STORAGE_DRIVER=supabase requires SUPABASE_URL (no silent fallback to local disk)");
    }
    if (!String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) {
      throw new Error("STORAGE_DRIVER=supabase requires SUPABASE_SERVICE_ROLE_KEY (server-side only; no silent fallback)");
    }
  }
  return raw;
}

function resolveBoundedInt(raw, { fallback, min, max }) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback; // documented: garbage -> default
  return Math.min(max, Math.max(min, n));
}

function validateSupabaseOrigin(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL (https://<project-ref>.supabase.co)");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("SUPABASE_URL must use http(s)");
  }
  return url.origin;
}

function resolveStorageConfig(env = process.env) {
  const driver = resolveStorageDriver(env);
  const bucket = String(env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/.test(bucket)) {
    throw new Error("SUPABASE_STORAGE_BUCKET must be 2-63 characters of letters, digits, dot, underscore or hyphen");
  }
  return {
    driver,
    bucket,
    maxImageBytes: resolveBoundedInt(env.MAX_IMAGE_BYTES, {
      fallback: DEFAULT_MAX_IMAGE_BYTES,
      min: MIN_IMAGE_BYTES,
      max: MAX_IMAGE_BYTES_CAP
    }),
    uploadAuthTtlMs: resolveBoundedInt(env.UPLOAD_AUTH_TTL_MS, {
      fallback: DEFAULT_UPLOAD_AUTH_TTL_MS,
      min: MIN_UPLOAD_AUTH_TTL_MS,
      max: MAX_UPLOAD_AUTH_TTL_MS
    }),
    supabaseOrigin: driver === "supabase" ? validateSupabaseOrigin(env.SUPABASE_URL) : undefined,
    serviceRoleKey: driver === "supabase" ? String(env.SUPABASE_SERVICE_ROLE_KEY) : undefined,
    localUploadDir: path.join(__dirname, "..", "uploads")
  };
}

function resolveUploadAuthTtlMs(env = process.env) {
  return resolveStorageConfig(env).uploadAuthTtlMs;
}

// Size limit without driver resolution — usable in offline tooling (the
// migration script runs inventory without any storage configuration).
function resolveMaxImageBytes(env = process.env) {
  return resolveBoundedInt(env.MAX_IMAGE_BYTES, {
    fallback: DEFAULT_MAX_IMAGE_BYTES,
    min: MIN_IMAGE_BYTES,
    max: MAX_IMAGE_BYTES_CAP
  });
}

// ---- errors ----

// Verification failures are classified so the caller can decide between
// "delete the bad object" (invalid-content) and "leave it alone, might be
// transient" (storage-error → 502, orphan sweep safety net).
function verifyError(kind, message) {
  const err = new Error(message);
  err.verifyKind = kind; // "not-found" | "invalid-content" | "storage-error"
  return err;
}

function isNotFoundStorageError(err) {
  const status = err && (err.statusCode !== undefined ? err.statusCode : err.status);
  return status === 404 || /not\s*found/i.test(String((err && err.message) || ""));
}

// ---- Supabase driver (MOCK-injectable; SDK lazy-loaded) ----

let realSupabaseClient = null;
let injectedSupabaseClientForTests = null; // TEST-ONLY seam (clearly labeled)
let sdkCreationCount = 0;

// TEST-ONLY: inject a fake @supabase/supabase-js-shaped client. Tests that use
// this MUST label the covered behavior as mocked (no remote call is made).
function __setSupabaseClientForTests(client) {
  injectedSupabaseClientForTests = client;
}

// TEST-ONLY: number of REAL SDK client constructions (proves refusals happen
// before any SDK/network contact).
function __getSdkCreationCountForTests() {
  return sdkCreationCount;
}

function __resetImageStoreForTests() {
  realSupabaseClient = null;
  injectedSupabaseClientForTests = null;
  sdkCreationCount = 0;
}

function supabaseClient(config) {
  if (injectedSupabaseClientForTests) return injectedSupabaseClientForTests;
  if (realSupabaseClient) return realSupabaseClient;
  let createClient;
  try {
    ({ createClient } = require("@supabase/supabase-js"));
  } catch {
    throw new Error("@supabase/supabase-js is required for STORAGE_DRIVER=supabase (npm install @supabase/supabase-js)");
  }
  realSupabaseClient = createClient(config.supabaseOrigin, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  sdkCreationCount += 1;
  return realSupabaseClient;
}

function createSupabaseAdapter(config) {
  const bucket = () => supabaseClient(config).storage.from(config.bucket);

  return {
    driver: "supabase",
    config,

    publicUrlFor(objectPath) {
      return `${config.supabaseOrigin}/storage/v1/object/public/${encodeURIComponent(config.bucket)}/${objectPath}`;
    },

    isOwnReference(value) {
      const prefix = `${config.supabaseOrigin}/storage/v1/object/public/${config.bucket}/`;
      return typeof value === "string" && value.startsWith(prefix);
    },

    objectPathFromOwnReference(value) {
      const prefix = `${config.supabaseOrigin}/storage/v1/object/public/${config.bucket}/`;
      return String(value).slice(prefix.length);
    },

    // Short-lived, single-use upload authorization for ONE validated path.
    async createSignedUpload({ objectPath }) {
      const { data, error } = await bucket().createSignedUploadUrl(objectPath);
      if (error || !data || !data.signedUrl) {
        throw new Error(`createSignedUploadUrl failed: ${error ? error.message : "no data returned"}`);
      }
      return { signedUrl: data.signedUrl, token: data.token, path: data.path || objectPath };
    },

    // Server-side verification of a STORED object: metadata (mimetype + size,
    // as recorded by storage) must equal what was authorized, and the actual
    // bytes must pass the magic-byte check for the AUTHORIZED type.
    async verifyStoredObject({ path: objectPath, expected }) {
      let info;
      try {
        const result = await bucket().info(objectPath);
        if (result.error) throw result.error;
        info = result.data;
      } catch (err) {
        throw verifyError(isNotFoundStorageError(err) ? "not-found" : "storage-error", err.message);
      }
      const meta = info && info.metadata;
      if (!meta || typeof meta.mimetype !== "string" || !Number.isFinite(meta.size)) {
        throw verifyError("storage-error", "object metadata missing mimetype/size");
      }
      if (!ALLOWED_IMAGE_TYPES[meta.mimetype]) {
        throw verifyError("invalid-content", "stored mimetype is not allowed");
      }
      if (meta.size < 1 || meta.size > config.maxImageBytes) {
        throw verifyError("invalid-content", "stored size out of bounds");
      }
      if (expected) {
        if (meta.mimetype !== expected.mimetype) {
          throw verifyError("invalid-content", "stored mimetype differs from the authorized type");
        }
        if (meta.size !== expected.size) {
          throw verifyError("invalid-content", "stored size differs from the authorized size");
        }
      }
      let blob;
      try {
        const result = await bucket().download(objectPath);
        if (result.error) throw result.error;
        blob = result.data;
      } catch (err) {
        throw verifyError("storage-error", err.message);
      }
      const buffer = Buffer.from(await blob.arrayBuffer());
      if (buffer.length !== meta.size) {
        throw verifyError("invalid-content", "downloaded bytes do not match reported size");
      }
      if (!verifyImageBuffer(buffer, meta.mimetype)) {
        throw verifyError("invalid-content", "magic-byte check failed for stored content");
      }
      return { size: meta.size, mimetype: meta.mimetype };
    },

    // Best-effort (used for orphan compensation); failures are logged, never thrown.
    async removeImage({ path: objectPath }) {
      try {
        const { error } = await bucket().remove([objectPath]);
        if (error) {
          console.error("⚠️ best-effort storage removal failed:", error.message);
          return false;
        }
        return true;
      } catch (err) {
        console.error("⚠️ best-effort storage removal failed:", err.message);
        return false;
      }
    },

    // Migration-tool primitives (scripts/storage-migrate.js).
    async uploadBuffer({ objectPath, buffer, contentType, sha256Base64 }) {
      const { error } = await bucket().upload(objectPath, buffer, {
        contentType,
        upsert: true, // re-running with identical bytes is idempotent
        ...(sha256Base64 ? { checksum: sha256Base64 } : {})
      });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },

    async downloadBuffer({ objectPath }) {
      const { data, error } = await bucket().download(objectPath);
      if (error) throw new Error(`storage download failed: ${error.message}`);
      return Buffer.from(await data.arrayBuffer());
    }
  };
}

// ---- local driver (existing behavior, unchanged) ----

function createLocalAdapter(config) {
  return {
    driver: "local",
    config,

    publicUrlFor(objectPath) {
      return `/uploads/${path.basename(String(objectPath || ""))}`;
    },

    isOwnReference(value) {
      return typeof value === "string" && value.startsWith("/uploads/");
    },

    objectPathFromOwnReference(value) {
      return path.basename(String(value || ""));
    },

    async saveImage({ buffer, mimetype }) {
      const name = generateImageName(mimetype);
      fs.mkdirSync(config.localUploadDir, { recursive: true });
      fs.writeFileSync(path.join(config.localUploadDir, name), buffer);
      return { reference: `/uploads/${name}`, publicUrl: `/uploads/${name}` };
    },

    // basename() confines deletion to the uploads dir — a traversal-shaped
    // reference can at worst delete an unrelated basename inside it.
    async removeImage({ reference }) {
      const name = path.basename(String(reference || ""));
      if (!name) return false;
      fs.rmSync(path.join(config.localUploadDir, name), { force: true });
      return true;
    },

    // Direct upload exists only for hosted storage; local keeps multipart.
    async createSignedUpload() {
      const err = new Error("Direct upload is unavailable with STORAGE_DRIVER=local");
      err.code = "local-storage";
      throw err;
    },

    async verifyStoredObject() {
      const err = new Error("Direct upload is unavailable with STORAGE_DRIVER=local");
      err.code = "local-storage";
      throw err;
    }
  };
}

// ---- store singleton (config-keyed; env changes are picked up per call) ----

let cachedStore = null;
let cachedConfigKey = null;

function getImageStore(env = process.env) {
  const config = resolveStorageConfig(env);
  const key = JSON.stringify([
    config.driver,
    config.bucket,
    config.supabaseOrigin,
    config.maxImageBytes,
    config.localUploadDir
  ]);
  if (cachedStore && cachedConfigKey === key) return cachedStore;
  cachedStore = config.driver === "supabase" ? createSupabaseAdapter(config) : createLocalAdapter(config);
  cachedConfigKey = key;
  return cachedStore;
}

// ---- product-image resolution (used by productController) ----
//
// Local driver: byte-identical passthrough (existing behavior preserved).
// Supabase driver, `image` values are classified as:
//   ""                          -> "" (clearing allowed)
//   /uploads/...                -> 400 (never write NEW ephemeral refs in hosted mode)
//   products/<safe-segment>     -> pending direct upload: ledger + verify + consume
//   our own public bucket URL   -> same as pending (must have a ledger entry)
//   other http(s)://...        -> external URL passthrough (existing feature)
//   anything else              -> 400 invalid reference
//
// Throws errors carrying { status, publicMessage, exposeToClient }.

function storageClientError(status, publicMessage) {
  const err = new Error(publicMessage);
  err.status = status;
  err.publicMessage = publicMessage;
  err.exposeToClient = true;
  return err;
}

function storageUnavailableError() {
  // Config problems are server faults: 503, no internal details exposed.
  return storageClientError(503, "Storage is not configured");
}

// Best-effort compensation after a DB write failed post-verification.
async function bestEffortRemoveImage(objectPath) {
  try {
    const store = getImageStore();
    if (store.driver === "supabase") await store.removeImage({ path: objectPath });
  } catch (err) {
    console.error("⚠️ best-effort upload cleanup failed:", err.message);
  }
}

async function resolveProductImageValue(raw, adminId) {
  const value = raw || "";
  let store;
  try {
    store = getImageStore();
  } catch {
    throw storageUnavailableError();
  }
  if (store.driver !== "supabase") return { value, cleanupPath: null };
  if (!value) return { value: "", cleanupPath: null };
  if (value.startsWith("/uploads/")) {
    throw storageClientError(
      400,
      "Local /uploads/ image references are not accepted while hosted storage is enabled; upload through the direct upload flow"
    );
  }

  let objectPath = null;
  if (value.startsWith("products/")) {
    if (!PENDING_PATH_SHAPE.test(value)) throw storageClientError(400, "Invalid object path");
    objectPath = value;
  } else if (store.isOwnReference(value)) {
    objectPath = store.objectPathFromOwnReference(value);
    if (!PENDING_PATH_SHAPE.test(objectPath)) throw storageClientError(400, "Invalid object path");
  } else if (/^https?:\/\//i.test(value)) {
    return { value, cleanupPath: null }; // external URL passthrough (existing feature)
  } else {
    throw storageClientError(400, "Invalid image reference");
  }

  // Single-use authorization proof. Consume BEFORE verification so a path can
  // never be replayed, even if verification fails transiently.
  const { uploadLedger } = require("./uploadLedger");
  const taken = uploadLedger.take(objectPath, adminId);
  if (taken.status === "missing") throw storageClientError(400, "Upload authorization not found or already used");
  if (taken.status === "expired") throw storageClientError(410, "Upload authorization expired; upload the image again");
  if (taken.status === "forbidden") throw storageClientError(403, "Upload authorization is not valid for this admin");

  try {
    await store.verifyStoredObject({ path: objectPath, expected: taken.entry });
  } catch (err) {
    if (err.verifyKind === "invalid-content") {
      // The object exists but is wrong (spoofed type, wrong size): delete it
      // so a bad upload never lingers as an orphan.
      await store.removeImage({ path: objectPath });
      throw storageClientError(400, "Uploaded image failed verification (content, type or size mismatch)");
    }
    if (err.verifyKind === "not-found") {
      throw storageClientError(400, "No uploaded object found for this path; upload the image first");
    }
    console.error("❌ storage verification failed:", err.message);
    throw storageClientError(502, "Storage verification failed; try again");
  }

  return { value: store.publicUrlFor(objectPath), cleanupPath: objectPath };
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  IMAGE_SIGNATURES,
  PENDING_PATH_SHAPE,
  DEFAULT_BUCKET,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_UPLOAD_AUTH_TTL_MS,
  verifyImageBuffer,
  generateImageName,
  isHostedEnv,
  resolveStorageDriver,
  resolveStorageConfig,
  resolveUploadAuthTtlMs,
  resolveMaxImageBytes,
  getImageStore,
  resolveProductImageValue,
  bestEffortRemoveImage,
  storageClientError,
  __setSupabaseClientForTests,
  __getSdkCreationCountForTests,
  __resetImageStoreForTests
};
