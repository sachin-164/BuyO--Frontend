// admin/js/products.js — admin product list (Phase 10)
// Reference: design-references/admin_page.webp (Products list card, zebra
// table with sortable Name/Price headers, Filter + Add Product actions,
// Previous/pages/Next footer).
//
// Server-backed behaviour (GET /api/products):
//   search q, category, minPrice, maxPrice, inStock, sort, page, limit.
//   Name and Price headers sort via the server (name_asc/desc, price_asc/desc);
//   Category/Stock/Status are NOT sortable because the API has no such sort —
//   no fake affordances are rendered for them.
//   Pagination totals are trustworthy here (products query uses DISTINCT).
(function () {
  "use strict";
  if (!window.BuyOShell || !window.BuyOApi) return;

  var C = window.BuyOCatalog;

  var PAGE_SIZE = 10; // reference table shows ~10 rows per page
  var state = {
    page: 1,
    sort: "newest",
    q: "",
    category: "",
    stock: "",
    min: "",
    max: ""
  };
  var els = {};
  var knownCategories = [];
  var armTimer = null;

  BuyOShell.ready.then(start).catch(function (err) {
    /* "admin gate: …" errors are expected — the shell already rendered the
       gate/denied card. Anything else is a real bug in this page. */
    if (err && String(err.message || err).indexOf("admin gate") === 0) return;
    if (window.BuyOUi) window.BuyOUi.toast("Something went wrong on this page.", { type: "error" });
    if (console && console.error) console.error("[admin/products]", err);
  });

  /* ---------------- helpers ---------------- */

  function hasFilters() {
    return !!(state.q || state.category || state.stock || state.min || state.max);
  }

  function buildQuery() {
    var params = ["limit=" + PAGE_SIZE, "page=" + state.page, "sort=" + state.sort];
    if (state.q) params.push("q=" + encodeURIComponent(state.q));
    if (state.category) params.push("category=" + encodeURIComponent(state.category));
    if (state.stock) params.push("inStock=" + state.stock);
    if (state.min !== "" && state.min != null) params.push("minPrice=" + encodeURIComponent(state.min));
    if (state.max !== "" && state.max != null) params.push("maxPrice=" + encodeURIComponent(state.max));
    return "/products?" + params.join("&");
  }

  function sortHeader(label, key) {
    var activeKey = null;
    if (state.sort === "name_asc" || state.sort === "name_desc") activeKey = "name";
    if (state.sort === "price_asc" || state.sort === "price_desc") activeKey = "price";
    var isActive = activeKey === key;
    var dir = isActive && state.sort.slice(-4) === "_asc" ? "ascending" : "descending";
    return (
      '<th scope="col"' + (isActive ? ' aria-sort="' + dir + '"' : "") + ">" +
        '<button type="button" class="adm-th-sort" data-sort-key="' + key + '">' +
          esc(label) +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
          '<path d="M6 9l6 6 6-6"/></svg>' +
        "</button>" +
      "</th>"
    );
  }

  function esc(value) {
    return C.esc(value);
  }

  function thead() {
    return (
      "<thead><tr>" +
        sortHeader("Product Name", "name") +
        "<th scope=\"col\">Category</th>" +
        sortHeader("Price", "price") +
        "<th scope=\"col\">Stock</th>" +
        "<th scope=\"col\">Status</th>" +
        "<th scope=\"col\">Action</th>" +
      "</tr></thead>"
    );
  }

  function bodySkeleton() {
    var rows = "";
    for (var i = 0; i < 6; i++) {
      rows +=
        "<tr>" +
        '<td><div class="ui-skeleton" style="height: 18px; width: ' + (150 - i * 10) + 'px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 80px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 64px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 34px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 18px; width: 76px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 60px;"></div></td>' +
        "</tr>";
    }
    return '<div class="adm-table-wrap"><table class="adm-table">' + thead() + "<tbody>" + rows + "</tbody></table></div>";
  }

  function thumb(product) {
    var url = C.safeImageUrl(product.image);
    var fallback =
      '<span class="adm-thumb adm-thumb--fallback" aria-hidden="true">' +
      esc(String(product.name || "?").charAt(0).toUpperCase()) +
      "</span>";
    if (url) {
      return (
        '<img class="adm-thumb" src="' + esc(url) + '" alt="" loading="lazy" data-letter="' +
        esc(String(product.name || "?").charAt(0).toUpperCase()) + '">'
      );
    }
    return fallback;
  }

  // Broken/removed image files degrade to the letter tile (no broken-image icon).
  function attachImageFallbacks(root) {
    Array.prototype.forEach.call(root.querySelectorAll("img[data-letter]"), function (img) {
      img.addEventListener("error", function () {
        var span = document.createElement("span");
        span.className = "adm-thumb adm-thumb--fallback";
        span.setAttribute("aria-hidden", "true");
        span.textContent = img.getAttribute("data-letter") || "?";
        if (img.parentNode) img.parentNode.replaceChild(span, img);
      });
    });
  }

  function rowHtml(product) {
    var stock = Number(product.stock) || 0;
    var mrp = Number(product.mrpPrice) || 0;
    var selling = Number(product.sellingPrice) || 0;
    var categoryName = (product.Category && product.Category.name) || product.category || "—";

    return (
      "<tr>" +
        '<td><div class="adm-cell-name">' + thumb(product) +
          "<div><span class=\"adm-cell-name__text\">" + esc(product.name) + "</span>" +
          (product.slug ? '<span class="adm-cell-sub">' + esc(product.slug) + "</span>" : "") +
        "</div></div></td>" +
        "<td>" + esc(categoryName) + "</td>" +
        '<td class="adm-num">' + esc(C.formatPrice(selling)) +
          (mrp > selling ? '<span class="adm-cell-mrp">' + esc(C.formatPrice(mrp)) + "</span>" : "") +
        "</td>" +
        '<td class="adm-num">' + stock + "</td>" +
        "<td>" +
          (stock > 0
            ? '<span class="ui-badge ui-badge--success">In stock</span>'
            : '<span class="ui-badge ui-badge--danger">Out of stock</span>') +
        "</td>" +
        '<td><div class="adm-actions">' +
          '<a class="adm-link" href="product-form.html?id=' + encodeURIComponent(product.id) + '">Edit</a>' +
          '<button type="button" class="adm-icon-btn" data-delete-id="' + esc(product.id) +
            '" aria-label="Delete ' + esc(product.name) + '">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
            '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>' +
          "</button>" +
        "</div></td>" +
      "</tr>"
    );
  }

  function emptyHtml() {
    if (hasFilters()) {
      return C.emptyState({
        title: "No products match",
        text: "Try different search terms or clear the active filters.",
        action: '<button type="button" class="ui-btn ui-btn--secondary" data-clear-empty>Clear filters</button>'
      });
    }
    return C.emptyState({
      title: "No products yet",
      text: "The catalog is empty. Add the first product to start selling.",
      action: '<a class="ui-btn ui-btn--primary" href="product-form.html">Add Product</a>'
    });
  }

  function errorHtml(message) {
    return C.emptyState({
      icon: BuyOShell.icon("alert", 26),
      title: "Couldn’t load products",
      text: message || "Something went wrong while loading the catalog.",
      action: '<button type="button" class="ui-btn ui-btn--primary" data-retry>Try again</button>'
    });
  }

  /* ---------------- data flow ---------------- */

  function render(data) {
    var products = data.products || [];
    var pagination = data.pagination || {};
    var total = typeof pagination.total === "number" ? pagination.total : products.length;
    var totalPages = Math.max(1, pagination.totalPages || 1);

    els.count.textContent =
      total === 0
        ? hasFilters()
          ? "No matching products"
          : "No products yet"
        : total + (total === 1 ? " product" : " products") + (state.q ? " matching “" + state.q + "”" : "");

    els.table.innerHTML = products.length
      ? '<div class="adm-table-wrap"><table class="adm-table">' + thead() +
        "<tbody>" + products.map(rowHtml).join("") + "</tbody></table></div>"
      : emptyHtml();
    attachImageFallbacks(els.table);

    if (total > 0) {
      BuyOShell.renderPager(els.pager, {
        page: state.page,
        totalPages: totalPages,
        total: total,
        unit: "products",
        onPage: goPage
      });
    } else {
      els.pager.innerHTML = "";
    }
  }

  function goPage(page) {
    state.page = page;
    load();
    var card = document.querySelector(".adm-card");
    if (card) {
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }

  async function load() {
    els.table.innerHTML = bodySkeleton();
    els.pager.innerHTML = "";
    els.count.textContent = "Loading products…";

    var res = await BuyOApi.get(buildQuery());
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return; // shell gate takes over
      els.table.innerHTML = errorHtml(res.message);
      return;
    }
    render(res.data || {});
  }

  function resetFilters() {
    state.q = "";
    state.category = "";
    state.stock = "";
    state.min = "";
    state.max = "";
    state.page = 1;
    var input = document.getElementById("adm-search-input");
    if (input) input.value = "";
    document.getElementById("filter-category").value = "";
    document.getElementById("filter-stock").value = "";
    document.getElementById("filter-min").value = "";
    document.getElementById("filter-max").value = "";
    load();
  }

  async function populateCategories() {
    var res = await BuyOApi.get("/categories");
    if (!res.ok) return;
    knownCategories = (res.data && res.data.categories) || [];
    var select = document.getElementById("filter-category");
    if (!select) return;
    var html = '<option value="">All categories</option>';
    knownCategories.forEach(function (cat) {
      html += '<option value="' + C.esc(cat.name) + '">' + C.esc(cat.name) + "</option>";
    });
    // keep a currently-filtered category selectable even if it was deleted
    if (state.category && !knownCategories.some(function (c) { return c.name === state.category; })) {
      html += '<option value="' + C.esc(state.category) + '">' + C.esc(state.category) + " (missing)</option>";
    }
    select.innerHTML = html;
    select.value = state.category;
  }

  /* ---------------- events (bound once) ---------------- */

  function bind() {
    /* top-bar search (shell rendered it because data-search="true") */
    var searchForm = document.querySelector("[data-adm-search]");
    if (searchForm) {
      searchForm.addEventListener("submit", function (event) {
        event.preventDefault();
        state.q = document.getElementById("adm-search-input").value.trim();
        state.page = 1;
        load();
      });
    }

    /* Filter toggle + form */
    var toggle = document.querySelector("[data-filter-toggle]");
    if (toggle && els.filters) {
      toggle.addEventListener("click", function () {
        var open = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", open ? "false" : "true");
        els.filters.hidden = open;
        if (!open) {
          var first = els.filters.querySelector("select, input");
          if (first) first.focus();
        }
      });
      els.filters.addEventListener("submit", function (event) {
        event.preventDefault();
        var min = document.getElementById("filter-min").value.trim();
        var max = document.getElementById("filter-max").value.trim();
        if (min !== "" && max !== "" && Number(min) > Number(max)) {
          window.BuyOUi.toast("Minimum price must not exceed maximum price.", { type: "error" });
          return;
        }
        state.category = document.getElementById("filter-category").value;
        state.stock = document.getElementById("filter-stock").value;
        state.min = min;
        state.max = max;
        state.page = 1;
        load();
      });
      var clear = els.filters.querySelector("[data-clear]");
      if (clear) clear.addEventListener("click", resetFilters);
    }

    /* table: sort buttons, delete buttons, empty-state helpers (delegated) */
    document.getElementById("main").addEventListener("click", function (event) {
      var sortBtn = event.target.closest("[data-sort-key]");
      if (sortBtn) {
        var key = sortBtn.getAttribute("data-sort-key");
        var current = state.sort;
        var ascValue = key === "name" ? "name_asc" : "price_asc";
        var descValue = key === "name" ? "name_desc" : "price_desc";
        state.sort = current === ascValue ? descValue : ascValue;
        state.page = 1;
        load();
        return;
      }

      var deleteBtn = event.target.closest("[data-delete-id]");
      if (deleteBtn) {
        armOrDelete(deleteBtn);
        return;
      }

      if (event.target.closest("[data-clear-empty]")) resetFilters();

      if (event.target.closest("[data-retry]")) load();
    });
  }

  function armOrDelete(btn) {
    if (btn.getAttribute("data-armed") !== "1") {
      // first click arms; second click deletes (3s window, no native dialogs)
      Array.prototype.forEach.call(document.querySelectorAll('[data-armed="1"]'), disarm);
      btn.setAttribute("data-armed", "1");
      btn.setAttribute("aria-label", "Confirm deleting this product");
      btn.innerHTML = "Delete?";
      btn.style.width = "auto";
      btn.style.padding = "0 8px";
      btn.style.fontSize = "11px";
      btn.style.fontWeight = "600";
      if (armTimer) clearTimeout(armTimer);
      armTimer = setTimeout(function () { disarm(btn); }, 3000);
      return;
    }
    performDelete(btn);
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
    // aria-label is restored from the row on next render; keep it generic-safe here
    btn.setAttribute("aria-label", "Delete product");
  }

  async function performDelete(btn) {
    var id = btn.getAttribute("data-delete-id");
    btn.disabled = true;
    var res = await BuyOApi.del("/products/" + encodeURIComponent(id));
    btn.disabled = false;
    if (res.status === 401 || res.status === 403) return; // shell gate
    if (!res.ok) {
      window.BuyOUi.toast(res.message || "Could not delete this product.", { type: "error" });
      disarm(btn);
      return;
    }
    window.BuyOUi.toast("Product deleted.", { type: "success" });
    load();
  }

  function start() {
    els.table = document.querySelector("[data-table]");
    els.pager = document.querySelector("[data-pager]");
    els.count = document.querySelector("[data-count]");
    els.filters = document.querySelector("[data-filters]");
    bind();
    populateCategories();
    load();
  }
})();
