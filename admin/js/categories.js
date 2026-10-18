// admin/js/categories.js — category management (Phase 10)
// Endpoints: GET /api/categories (public, includes productCount),
//            POST/PUT/DELETE /api/categories (requireAuth + requireAdmin).
// Delete is always allowed by the server: it clears the products' categoryId
// link and returns { affectedProducts } — the UI states that up front and
// reports the real count in the success toast.
(function () {
  "use strict";
  if (!window.BuyOShell || !window.BuyOApi) return;

  var C = window.BuyOCatalog;
  var U = window.BuyOUi;

  var FIELD_IDS = ["name", "slug", "description", "taxRate"];
  var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  var els = {};
  var editingId = null;
  var submitting = false;
  var armTimer = null;

  BuyOShell.ready.then(start).catch(function (err) {
    /* "admin gate: …" errors are expected — the shell already rendered the
       gate/denied card. Anything else is a real bug in this page. */
    if (err && String(err.message || err).indexOf("admin gate") === 0) return;
    if (window.BuyOUi) window.BuyOUi.toast("Something went wrong on this page.", { type: "error" });
    if (console && console.error) console.error("[admin/categories]", err);
  });

  function esc(v) { return C.esc(v); }

  function fmtTax(value) {
    var n = Number(value);
    if (!isFinite(n)) return "—";
    return (Math.round(n * 100) / 100) + "%";
  }

  /* ---------------- render ---------------- */

  function skeleton() {
    var rows = "";
    for (var i = 0; i < 5; i++) {
      rows +=
        "<tr>" +
        '<td><div class="ui-skeleton" style="height: 16px; width: 130px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 90px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 44px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 30px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 120px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 70px;"></div></td>' +
        "</tr>";
    }
    return '<div class="adm-table-wrap"><table class="adm-table">' + head() + "<tbody>" + rows + "</tbody></table></div>";
  }

  function head() {
    return (
      "<thead><tr>" +
      '<th scope="col">Name</th>' +
      '<th scope="col">Slug</th>' +
      '<th scope="col">GST %</th>' +
      '<th scope="col">Products</th>' +
      '<th scope="col">Description</th>' +
      '<th scope="col">Action</th>' +
      "</tr></thead>"
    );
  }

  function rowHtml(cat) {
    var description = String(cat.description || "");
    var shown = description.length > 60 ? description.slice(0, 57) + "…" : description;
    return (
      "<tr>" +
      '<td><strong>' + esc(cat.name) + "</strong></td>" +
      '<td><span class="adm-mono">' + esc(cat.slug || "—") + "</span></td>" +
      '<td class="adm-num">' + esc(fmtTax(cat.taxRate)) + "</td>" +
      '<td class="adm-num">' + (Number(cat.productCount) || 0) + "</td>" +
      "<td>" +
        (shown
          ? '<span class="adm-cell-sub" style="margin-top: 0;" title="' + esc(description) + '">' + esc(shown) + "</span>"
          : '<span class="adm-cell-sub" style="margin-top: 0;">—</span>') +
      "</td>" +
      '<td><div class="adm-actions">' +
        '<button type="button" class="adm-link" data-edit-id="' + esc(cat.id) + '">Edit</button>' +
        '<button type="button" class="adm-icon-btn" data-delete-id="' + esc(cat.id) +
          '" aria-label="Delete ' + esc(cat.name) + '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
          '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>' +
        "</button>" +
      "</div></td>" +
      "</tr>"
    );
  }

  function render(categories) {
    if (!categories.length) {
      els.table.innerHTML = C.emptyState({
        title: "No categories yet",
        text: "Group products into categories to power filters and GST rates.",
        action: '<button type="button" class="ui-btn ui-btn--primary" data-add-empty>Add Category</button>'
      });
      els.count.textContent = "No categories yet";
      return;
    }
    els.count.textContent =
      categories.length + (categories.length === 1 ? " category" : " categories") +
      " · " + categories.reduce(function (s, c) { return s + (Number(c.productCount) || 0); }, 0) + " product links";
    els.table.innerHTML =
      '<div class="adm-table-wrap"><table class="adm-table">' + head() +
      "<tbody>" + categories.map(rowHtml).join("") + "</tbody></table></div>";
  }

  function showError(message) {
    els.table.innerHTML = C.emptyState({
      icon: BuyOShell.icon("alert", 26),
      title: "Couldn’t load categories",
      text: message || "Something went wrong.",
      action: '<button type="button" class="ui-btn ui-btn--primary" data-retry>Try again</button>'
    });
    els.count.textContent = "Categories unavailable";
  }

  async function load() {
    els.table.innerHTML = skeleton();
    els.count.textContent = "Loading categories…";
    var res = await BuyOApi.get("/categories");
    if (res.status === 401 || res.status === 403) return;
    if (!res.ok) { showError(res.message); return; }
    lastCategories = (res.data && res.data.categories) || [];
    render(lastCategories);
  }

  var lastCategories = [];

  /* ---------------- modal form ---------------- */

  function clearFormErrors() {
    BuyOShell.clearErrors(FIELD_IDS);
  }

  function openAdd() {
    editingId = null;
    clearFormErrors();
    els.form.reset();
    document.getElementById("taxRate").value = "0";
    els.modalTitle.textContent = "Add category";
    els.submit.textContent = "Save category";
    U.openModal(els.modal);
    document.getElementById("name").focus();
  }

  function openEdit(cat) {
    editingId = cat.id;
    clearFormErrors();
    els.form.reset();
    document.getElementById("name").value = cat.name || "";
    document.getElementById("slug").value = cat.slug || "";
    document.getElementById("description").value = cat.description || "";
    document.getElementById("taxRate").value = cat.taxRate != null ? Number(cat.taxRate) : "0";
    els.modalTitle.textContent = "Edit category";
    els.submit.textContent = "Save changes";
    U.openModal(els.modal);
    document.getElementById("name").focus();
  }

  function validate() {
    clearFormErrors();
    var ok = true;
    var name = document.getElementById("name").value.trim();
    if (!name) { markError("name", "Category name is required."); ok = false; }
    else if (name.length > 100) { markError("name", "Name must be 100 characters or fewer."); ok = false; }

    var slug = document.getElementById("slug").value.trim();
    if (slug && !SLUG_RE.test(slug)) {
      markError("slug", "Slug must contain only lowercase letters, numbers and hyphens.");
      ok = false;
    }

    var description = document.getElementById("description").value.trim();
    if (description.length > 2000) {
      markError("description", "Description must be 2000 characters or fewer.");
      ok = false;
    }

    var tax = document.getElementById("taxRate").value;
    if (tax !== "" && (isNaN(parseFloat(tax)) || parseFloat(tax) < 0 || parseFloat(tax) > 999.99)) {
      markError("taxRate", "GST must be between 0 and 999.99.");
      ok = false;
    }
    return ok;
  }

  function markError(id, message) {
    var span = document.getElementById(id + "-error");
    if (span) span.textContent = message;
    var input = document.getElementById(id);
    if (input) input.setAttribute("aria-invalid", "true");
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    if (!validate()) return;

    submitting = true;
    els.submit.disabled = true;

    var tax = document.getElementById("taxRate").value;
    var payload = {
      name: document.getElementById("name").value.trim(),
      slug: document.getElementById("slug").value.trim() || undefined,
      description: document.getElementById("description").value.trim() || undefined,
      taxRate: tax === "" ? undefined : parseFloat(tax)
    };

    var res = editingId
      ? await BuyOApi.put("/categories/" + encodeURIComponent(editingId), payload)
      : await BuyOApi.post("/categories", payload);

    submitting = false;
    els.submit.disabled = false;

    if (res.status === 401 || res.status === 403) return;
    if (!res.ok) {
      var errs = res.data && res.data.errors;
      var unmatched = BuyOShell.mapErrors(res, FIELD_IDS);
      if (unmatched > 0 || !Array.isArray(errs) || !errs.length) {
        U.toast(res.message || "Could not save the category.", { type: "error" });
      }
      return;
    }

    U.closeModal(els.modal);
    U.toast(editingId ? "Category updated." : "Category added.", { type: "success" });
    editingId = null;
    load();
  }

  /* ---------------- delete (two-step, no native dialogs) ---------------- */

  function armDelete(btn) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-armed="1"]'), disarm);
    btn.setAttribute("data-armed", "1");
    btn.setAttribute("aria-label", "Confirm deleting this category");
    btn.innerHTML = "Delete?";
    btn.style.width = "auto";
    btn.style.padding = "0 8px";
    btn.style.fontSize = "11px";
    btn.style.fontWeight = "600";
    if (armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(function () { disarm(btn); }, 3000);
  }

  function disarm(btn) {
    if (!btn || btn.getAttribute("data-armed") !== "1") return;
    btn.removeAttribute("data-armed");
    btn.style.width = "";
    btn.style.padding = "";
    btn.style.fontSize = "";
    btn.style.fontWeight = "";
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>';
    btn.setAttribute("aria-label", "Delete category");
  }

  async function performDelete(btn) {
    var id = btn.getAttribute("data-delete-id");
    btn.disabled = true;
    var res = await BuyOApi.del("/categories/" + encodeURIComponent(id));
    btn.disabled = false;
    if (res.status === 401 || res.status === 403) return;
    if (!res.ok) {
      U.toast(res.message || "Could not delete this category.", { type: "error" });
      disarm(btn);
      return;
    }
    var affected = res.data && typeof res.data.affectedProducts === "number" ? res.data.affectedProducts : 0;
    U.toast(
      affected > 0
        ? "Category deleted — " + affected + (affected === 1 ? " product" : " products") + " unlinked."
        : "Category deleted.",
      { type: "success" }
    );
    load();
  }

  /* ---------------- events ---------------- */

  function bind() {
    els.addBtn.addEventListener("click", openAdd);
    els.form.addEventListener("submit", submit);

    document.getElementById("main").addEventListener("click", function (event) {
      var addEmpty = event.target.closest("[data-add-empty]");
      if (addEmpty) { openAdd(); return; }

      var editBtn = event.target.closest("[data-edit-id]");
      if (editBtn) {
        var id = editBtn.getAttribute("data-edit-id");
        var cat = (lastCategories || []).filter(function (c) { return String(c.id) === String(id); })[0];
        if (cat) openEdit(cat);
        return;
      }

      var delBtn = event.target.closest("[data-delete-id]");
      if (delBtn) {
        if (delBtn.getAttribute("data-armed") !== "1") armDelete(delBtn);
        else performDelete(delBtn);
        return;
      }

      if (event.target.closest("[data-retry]")) load();
    });
  }

  async function start() {
    els.table = document.querySelector("[data-table]");
    els.count = document.querySelector("[data-count]");
    els.modal = document.getElementById("category-modal");
    els.form = document.querySelector("[data-category-form]");
    els.modalTitle = document.querySelector("[data-modal-title]");
    els.submit = document.querySelector("[data-cat-submit]");
    els.addBtn = document.querySelector("[data-add-category]");

    bind();
    load();
  }
})();
