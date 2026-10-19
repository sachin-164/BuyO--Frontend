// admin/js/product-form.js — add / edit products (Phase 10)
// Create: JSON POST, or multipart POST when a file is chosen (matches the
//         multer endpoint: 5 MB, image/* only).
// Edit:   JSON PUT only — the API documents image replacement via upload as
//         future work, so editing offers an image URL + Remove image button
//         (verified: PUT { image: "" } clears, imageMeta persists).
// Validation: mirrors the server rules client-side, then maps any server
//         400 { errors: [...] } payload back onto the fields (server wins).
(function () {
  "use strict";
  if (!window.BuyOShell || !window.BuyOApi) return;

  var C = window.BuyOCatalog;
  var U = window.BuyOUi;

  var FIELD_IDS = ["name", "category", "description", "mrpPrice", "sellingPrice", "stock", "slug", "image"];
  var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var MAX_FILE_BYTES = 5 * 1024 * 1024; // server multer limit

  var params = new URLSearchParams(window.location.search);
  var rawId = params.get("id");
  var isEdit = /^\d+$/.test(rawId || "");
  var productId = isEdit ? rawId : null;
  var knownCategories = []; // [{id, name}]
  var submitting = false;
  var imageCleared = false; // edit mode: user pressed Remove image

  var els = {};

  BuyOShell.ready.then(start).catch(function (err) {
    /* "admin gate: …" errors are expected — the shell already rendered the
       gate/denied card. Anything else is a real bug in this page. */
    if (err && String(err.message || err).indexOf("admin gate") === 0) return;
    if (window.BuyOUi) window.BuyOUi.toast("Something went wrong on this page.", { type: "error" });
    if (console && console.error) console.error("[admin/product-form]", err);
  });

  /* ---------------- helpers ---------------- */

  function fieldError(id, message) {
    var span = document.getElementById(id + "-error");
    if (span) span.textContent = message || "";
    var input = document.getElementById(id);
    if (input) {
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  function selectedCategory() {
    var select = document.getElementById("category");
    var value = select ? select.value : "";
    if (value === "__custom__") {
      return { category: val("category-custom"), categoryId: null, custom: true };
    }
    var found = knownCategories.filter(function (c) { return String(c.id) === value; })[0];
    if (!found) return { category: "", categoryId: null, custom: false };
    return { category: found.name, categoryId: found.id, custom: false };
  }

  function imageMode() {
    var checked = document.querySelector('input[name="imageMode"]:checked');
    return checked ? checked.value : "url";
  }

  function discountHint() {
    var mrp = parseFloat(val("mrpPrice"));
    var selling = parseFloat(val("sellingPrice"));
    var hint = els.discountHint;
    if (!hint) return;
    if (isFinite(mrp) && isFinite(selling) && mrp > 0 && selling < mrp) {
      var pct = Math.round(((mrp - selling) / mrp) * 100);
      hint.textContent = pct + "% below MRP";
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
  }

  function setImageWrapVisibility() {
    if (isEdit) {
      els.fileWrap.hidden = true;
      els.urlWrap.hidden = false;
      return;
    }
    var mode = imageMode();
    els.fileWrap.hidden = mode !== "file";
    els.urlWrap.hidden = mode !== "url";
  }

  function validate() {
    var ok = true;
    FIELD_IDS.forEach(function (id) { fieldError(id, ""); });

    var name = val("name");
    if (!name) { fieldError("name", "Product name is required."); ok = false; }
    else if (name.length > 200) { fieldError("name", "Product name must be 200 characters or fewer."); ok = false; }

    var cat = selectedCategory();
    if (!cat.category) {
      fieldError("category", cat.custom ? "Enter a category name or pick an existing category." : "Choose a category.");
      ok = false;
    } else if (cat.category.length > 100) {
      fieldError("category", "Category must be 100 characters or fewer.");
      ok = false;
    }

    var mrp = parseFloat(val("mrpPrice"));
    if (!isFinite(mrp) || mrp < 0.01 || mrp > 100000000) {
      fieldError("mrpPrice", "Enter an MRP between 0.01 and 100,000,000.");
      ok = false;
    }
    var selling = parseFloat(val("sellingPrice"));
    if (!isFinite(selling) || selling < 0.01 || selling > 100000000) {
      fieldError("sellingPrice", "Enter a selling price between 0.01 and 100,000,000.");
      ok = false;
    }

    var stock = val("stock") === "" ? "0" : val("stock");
    if (!/^\d+$/.test(stock)) {
      fieldError("stock", "Stock must be a whole number of 0 or more.");
      ok = false;
    }

    var slug = val("slug");
    if (slug && !SLUG_RE.test(slug)) {
      fieldError("slug", "Slug must contain only lowercase letters, numbers and hyphens.");
      ok = false;
    }

    var url = val("image-url");
    if (!isEdit && imageMode() === "url" && url && !/^(\/uploads\/|https?:\/\/)/i.test(url)) {
      fieldError("image", "Image URL must be an /uploads/ path or an http(s) link.");
      ok = false;
    }

    var fileInput = document.getElementById("image-file");
    var file = fileInput && fileInput.files && fileInput.files[0];
    if (!isEdit && imageMode() === "file" && file) {
      if (!/^image\//.test(file.type)) {
        fieldError("image", "Choose an image file (JPG, PNG, GIF or WebP).");
        ok = false;
      } else if (file.size > MAX_FILE_BYTES) {
        fieldError("image", "Image must be 5 MB or smaller.");
        ok = false;
      }
    }
    return ok;
  }

  function buildPayload() {
    var cat = selectedCategory();
    var payload = {
      name: val("name"),
      category: cat.category,
      description: val("description") || undefined,
      mrpPrice: parseFloat(val("mrpPrice")),
      sellingPrice: parseFloat(val("sellingPrice")),
      stock: parseInt(val("stock") || "0", 10),
      slug: val("slug") || undefined
    };
    if (cat.categoryId) payload.categoryId = cat.categoryId;

    var alt = val("image-alt");
    if (alt) payload.imageMeta = { alt: alt };

    if (isEdit) {
      if (imageCleared) payload.image = "";
      else {
        var url = val("image-url");
        if (url) payload.image = url;
      }
    } else {
      var fileEl = document.getElementById("image-file");
      var file = fileEl && fileEl.files && fileEl.files[0];
      if (imageMode() === "url" && val("image-url")) payload.image = val("image-url");
      payload._file = file || null; // stripped before JSON send; used for multipart
    }
    return payload;
  }

  function handleServerError(res) {
    var errs = res.data && res.data.errors;
    var unmatched = BuyOShell.mapErrors(res, FIELD_IDS);
    if (unmatched > 0 || !Array.isArray(errs) || !errs.length) {
      U.toast(res.message || "Could not save the product.", { type: "error" });
    }
  }

  /* ---------------- submit ---------------- */

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    BuyOShell.clearErrors(FIELD_IDS);
    if (!validate()) {
      var firstInvalid = document.querySelector('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    submitting = true;
    els.submit.disabled = true;
    var originalLabel = els.submit.textContent;
    els.submit.textContent = isEdit ? "Saving…" : "Adding…";

    try {
      var payload = buildPayload();
      var res;

      if (isEdit) {
        res = await BuyOApi.put("/products/" + encodeURIComponent(productId), payload);
      } else if (payload._file) {
        // Phase 12: hosted storage uses the direct-to-storage flow (authorize
        // -> bytes straight to storage -> server verifies before saving). The
        // server answers 409 code:"local-storage" in local mode, keeping this
        // existing multipart path unchanged for development.
        var upload = window.BuyOStorageUpload
          ? await window.BuyOStorageUpload.uploadProductImage({
              apiPost: function (p, body) { return BuyOApi.post(p, body); },
              file: payload._file
            })
          : { mode: "multipart" }; // helper missing -> legacy path (local dev)
        if (upload.mode === "error") {
          U.toast(upload.message, { type: "error" });
          return;
        }
        if (upload.mode === "direct") {
          delete payload._file;
          payload.image = upload.objectPath; // server verifies + stores the durable URL
          res = await BuyOApi.post("/products", payload);
        } else {
          var fd = new FormData();
          ["name", "category", "description", "mrpPrice", "sellingPrice", "stock", "slug", "image"].forEach(function (key) {
            if (payload[key] !== undefined) fd.append(key, String(payload[key]));
          });
          if (payload.categoryId) fd.append("categoryId", String(payload.categoryId));
          fd.append("image", payload._file);
          res = await BuyOApi.post("/products", fd);

          // multipart can't carry imageMeta JSON — follow up if alt text exists
          if (res.ok && payload.imageMeta && res.data && res.data.product) {
            var follow = await BuyOApi.put(
              "/products/" + encodeURIComponent(res.data.product.id),
              { imageMeta: payload.imageMeta }
            );
            if (!follow.ok) {
              U.toast("Product saved, but the image description could not be stored.", { type: "info" });
            }
          }
        }
      } else {
        delete payload._file;
        res = await BuyOApi.post("/products", payload);
      }

      if (res.status === 401 || res.status === 403) return; // shell gate

      if (!res.ok) {
        handleServerError(res);
        return;
      }

      U.toast(isEdit ? "Product updated." : "Product added.", { type: "success" });
      window.location.href = "products.html";
    } catch (e) {
      U.toast("Unexpected error while saving.", { type: "error" });
    } finally {
      submitting = false;
      els.submit.disabled = false;
      els.submit.textContent = originalLabel;
    }
  }

  /* ---------------- loading / wiring ---------------- */

  async function populateCategories(selectedId, selectedName) {
    var res = await BuyOApi.get("/categories");
    var select = document.getElementById("category");
    if (!res.ok) {
      select.innerHTML = '<option value="">Categories unavailable — reload to retry</option>';
      U.toast(res.message || "Could not load categories.", { type: "error" });
      return;
    }
    knownCategories = (res.data && res.data.categories) || [];
    var html = '<option value="">Choose a category…</option>';
    knownCategories.forEach(function (cat) {
      html += '<option value="' + C.esc(cat.id) + '">' + C.esc(cat.name) + "</option>";
    });
    html += '<option value="__custom__">Other (type below)</option>';
    select.innerHTML = html;

    if (isEdit) {
      if (selectedId && knownCategories.some(function (c) { return String(c.id) === String(selectedId); })) {
        select.value = String(selectedId);
      } else if (selectedName && knownCategories.some(function (c) { return c.name === selectedName; })) {
        var match = knownCategories.filter(function (c) { return c.name === selectedName; })[0];
        select.value = String(match.id);
      } else if (selectedName) {
        select.value = "__custom__";
        document.getElementById("category-custom").value = selectedName;
        els.customWrap.hidden = false;
      }
    }
  }

  function fill(product) {
    document.getElementById("name").value = product.name || "";
    document.getElementById("description").value = product.description || "";
    document.getElementById("mrpPrice").value = product.mrpPrice != null ? product.mrpPrice : "";
    document.getElementById("sellingPrice").value = product.sellingPrice != null ? product.sellingPrice : "";
    document.getElementById("stock").value = product.stock != null ? product.stock : 0;
    document.getElementById("slug").value = product.slug || "";
    document.getElementById("image-url").value = product.image || "";
    if (product.imageMeta && product.imageMeta.alt) {
      document.getElementById("image-alt").value = product.imageMeta.alt;
    }

    // preview
    var url = C.safeImageUrl(product.image);
    if (url) {
      els.previewImg.src = url;
      els.preview.hidden = false;
      els.previewImg.onerror = function () {
        els.preview.hidden = true; // missing file: URL field still shows the path
      };
    }

    discountHint();
    BuyOShell.setTitle("Edit product");
    els.formTitle.textContent = "Edit product";
    els.subtitle.textContent = "Update “" + product.name + "”. Fields marked * are required.";
    els.storefrontLink.hidden = false;
    els.storefrontLink.href = "../product-details.html?id=" + encodeURIComponent(product.id);
  }

  async function loadForEdit() {
    els.loading.hidden = false;
    els.submit.disabled = true;
    var res = await BuyOApi.get("/products/" + encodeURIComponent(productId));
    if (res.status === 401 || res.status === 403) return;
    if (!res.ok) {
      els.loading.hidden = true;
      U.toast(res.message || "Product not found.", { type: "error" });
      window.location.href = "products.html";
      return;
    }
    var product = res.data.product || {};
    await populateCategories(product.categoryId, product.category);
    fill(product);
    els.loading.hidden = true;
    els.submit.disabled = false;
  }

  function bind() {
    els.form.addEventListener("submit", submit);

    // discount hint on price edits
    ["mrpPrice", "sellingPrice"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", discountHint);
    });

    // category select -> custom input toggle
    document.getElementById("category").addEventListener("change", function () {
      els.customWrap.hidden = this.value !== "__custom__";
      if (!els.customWrap.hidden) document.getElementById("category-custom").focus();
    });

    // image mode radios (create only)
    Array.prototype.forEach.call(document.querySelectorAll('input[name="imageMode"]'), function (radio) {
      radio.addEventListener("change", setImageWrapVisibility);
    });

    // remove image (edit only)
    if (els.removeImage) {
      els.removeImage.addEventListener("click", function () {
        imageCleared = true;
        els.preview.hidden = true;
        document.getElementById("image-url").value = "";
        els.urlHint.textContent = "Image will be removed when you save.";
        U.toast("Image marked for removal — save to apply.", { type: "info" });
      });
    }
  }

  function start() {
    els.form = document.querySelector("[data-product-form]");
    els.submit = document.querySelector("[data-submit]");
    els.loading = document.querySelector("[data-loading]");
    els.formTitle = document.querySelector("[data-form-title]");
    els.subtitle = document.querySelector("[data-form-subtitle]");
    els.discountHint = document.querySelector("[data-discount-hint]");
    els.customWrap = document.querySelector("[data-custom-wrap]");
    els.fileWrap = document.querySelector("[data-image-file-wrap]");
    els.urlWrap = document.querySelector("[data-image-url-wrap]");
    els.preview = document.querySelector("[data-preview]");
    els.previewImg = document.querySelector("[data-preview-img]");
    els.removeImage = document.querySelector("[data-remove-image]");
    els.storefrontLink = document.querySelector("[data-storefront-link]");
    els.urlHint = document.querySelector("[data-url-hint]");

    if (isEdit) {
      BuyOShell.setTitle("Edit product");
      els.formTitle.textContent = "Edit product";
      // Upload radios are meaningless while editing (PUT accepts URLs only).
      var modeRow = document.querySelector("[data-image-mode]");
      if (modeRow) modeRow.hidden = true;
      var fileWrap = els.fileWrap;
      if (fileWrap) fileWrap.hidden = true;
      els.urlWrap.hidden = false;
      var urlHint = els.urlHint;
      if (urlHint) urlHint.textContent = "Editing accepts image URLs (uploading a new file happens when the product is first created).";
    } else {
      setImageWrapVisibility();
    }

    bind();
    if (isEdit) loadForEdit();
    else {
      setImageWrapVisibility();
      populateCategories(null, null);
    }
  }
})();
