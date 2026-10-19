// test/mockSupabaseStorage.js — MOCKED @supabase/supabase-js storage client.
// Clearly-labeled in-memory fake: it records every call and stores bytes in a
// Map. The Phase 12 storage tests inject it through the adapter's test seam
// (imageStore.__setSupabaseClientForTests) so NO real SDK client is
// constructed, NO network request happens, and NO Supabase project is ever
// contacted. Behavior covered here is MOCKED, not verified against Supabase.
"use strict";

function createMockSupabase() {
  const objects = new Map(); // objectPath -> { buffer, mimetype, infoError? }
  const calls = { signed: [], removed: [], info: 0, downloads: 0, uploads: [] };
  let downloadOverride = null; // fn(objectPath) -> Buffer (checksum-failure tests)

  const bucket = {
    async createSignedUploadUrl(p) {
      calls.signed.push(p);
      return {
        data: {
          signedUrl: `https://mock-storage.invalid/object/upload/sign/${encodeURIComponent(p)}?token=tok-${calls.signed.length}`,
          token: `tok-${calls.signed.length}`,
          path: p
        },
        error: null
      };
    },
    async upload(p, buffer, opts) {
      calls.uploads.push({
        path: p,
        size: buffer.length,
        contentType: opts && opts.contentType,
        checksum: opts && opts.checksum,
        upsert: Boolean(opts && opts.upsert)
      });
      objects.set(p, { buffer, mimetype: (opts && opts.contentType) || "application/octet-stream" });
      return { data: { path: p }, error: null };
    },
    async info(p) {
      calls.info += 1;
      const obj = objects.get(p);
      if (!obj) return { data: null, error: { message: "Object not found", statusCode: 404 } };
      if (obj.infoError) return { data: null, error: obj.infoError };
      return { data: { name: p, metadata: { mimetype: obj.mimetype, size: obj.buffer.length } }, error: null };
    },
    async download(p) {
      calls.downloads += 1;
      if (downloadOverride) return { data: new Blob([downloadOverride(p)]), error: null };
      const obj = objects.get(p);
      if (!obj) return { data: null, error: { message: "Object not found", statusCode: 404 } };
      return { data: new Blob([obj.buffer]), error: null };
    },
    async remove(paths) {
      calls.removed.push(...paths);
      paths.forEach((p) => objects.delete(p));
      return { data: paths, error: null };
    }
  };

  return {
    client: { storage: { from: () => bucket } },
    objects,
    calls,
    setDownloadOverride(fn) {
      downloadOverride = fn;
    },
    seed(objectPath, buffer, mimetype) {
      objects.set(objectPath, { buffer, mimetype });
    }
  };
}

module.exports = { createMockSupabase };
