// admin/js/storage-upload.js — direct-to-storage upload orchestration (Phase 12).
//
// Used by admin/js/product-form.js when a file is chosen on product CREATE.
// Sequence (docs/storage-supabase.md §5):
//   1. ask the API to authorize ONE upload (POST /api/uploads/authorize)
//   2. PUT the image bytes DIRECTLY to storage (signed, short-lived URL — the
//      bytes never pass through the API function)
//   3. hand the resulting object path to the product create call; the server
//      verifies the stored object before saving the row.
//
// Local development is unchanged: the API answers 409 { code: "local-storage" }
// and this module returns { mode: "multipart" } so the caller keeps using the
// existing FormData path byte-for-byte.
//
// UMD: works as a browser global (BuyOStorageUpload) and as a CommonJS module
// (unit-tested in Node with a mocked fetch — clearly labeled MOCKED in tests).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BuyOStorageUpload = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function isLocalModeResponse(res) {
    return Boolean(res) && res.status === 409 && res.data && res.data.code === "local-storage";
  }

  function defaultPutBytes(signedUrl, file, contentType) {
    return fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file
    }).then(
      function (res) {
        return { ok: res.ok, status: res.status };
      },
      function () {
        return { ok: false, status: 0 }; // network failure — caller aborts, nothing is saved
      }
    );
  }

  // Returns:
  //   { mode: "multipart" }                    local storage — use FormData (existing path)
  //   { mode: "direct", objectPath }           put objectPath in the product payload's image field
  //   { mode: "error", message, status? }      abort — NO product create call may follow
  async function uploadProductImage(opts) {
    var apiPost = opts.apiPost;
    var putBytes = opts.putBytes || defaultPutBytes;
    var file = opts.file;
    if (!file) return { mode: "error", message: "No image file selected." };

    var auth;
    try {
      auth = await apiPost("/uploads/authorize", {
        contentType: file.type,
        size: file.size,
        filename: file.name
      });
    } catch (e) {
      return { mode: "error", message: "Could not reach the server to authorize the upload." };
    }
    if (isLocalModeResponse(auth)) return { mode: "multipart" };
    if (!auth || !auth.ok || !auth.data || !auth.data.objectPath) {
      return {
        mode: "error",
        status: auth ? auth.status : 0,
        message: (auth && auth.message) || "Could not authorize the image upload."
      };
    }

    var put = await putBytes(auth.data.signedUploadUrl, file, file.type);
    if (!put.ok) {
      return {
        mode: "error",
        status: put.status,
        message: "The image could not be uploaded to storage. Nothing was saved."
      };
    }
    return { mode: "direct", objectPath: auth.data.objectPath };
  }

  return { uploadProductImage: uploadProductImage, isLocalModeResponse: isLocalModeResponse };
});
