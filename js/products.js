// js/products.js — catalog listing + search results (Phase 7)
// Replaces the old hardcoded demo grid: this page now ALWAYS reflects the real
// catalog via GET /api/products (the same public API the header search targets
// with ?q=...). Supports:
//   products.html                     -> all products, newest first
//   products.html?q=laptop            -> text search (name/description LIKE)
//   products.html?category=Electronics-> category filter (id, slug, or name)
//   products.html?sort=price_asc      -> whitelisted server sort
// Legacy links using ?name= (from the old demo cards) are honoured as ?q=.
(function () {
  "use strict";

  var SORTS = [
    { value: "newest", label: "Newest first" },
    { value: "price_asc", label: "Price: low to high" },
    { value: "price_desc", label: "Price: high to low" },
    { value: "name_asc", label: "Name: A to Z" },
    { value: "name_desc", label: "Name: Z to A" }
  ];
  var SORT_VALUES = SORTS.map(function (s) {
    return s.value;
  }).concat(["oldest"]);

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[ch];
    });
  }

  function formatPrice(value) {
    var number = Number(value);
    if (!isFinite(number)) return "";
    return "₹" + number.toLocaleString("en-IN");
  }

  function discountPercent(mrp, selling) {
    var m = Number(mrp);
    var s = Number(selling);
    if (!isFinite(m) || !isFinite(s) || m <= s || m <= 0) return 0;
    return Math.round(((m - s) / m) * 100);
  }

  function productCard(product) {
    var percent = discountPercent(product.mrpPrice, product.sellingPrice);
    var image = String(product.image || "").trim();
    var safeImage = /^(\/uploads\/|https?:\/\/)/i.test(image) ? image : "";
    var name = String(product.name || "Product");
    var categoryName =
      (product.Category && product.Category.name) || product.category || "";
    var outOfStock = !(Number(product.stock) > 0);

    var media = safeImage
      ? '<img src="' + esc(safeImage) + '" alt="' + esc(name) + '" loading="lazy">'
      : '<span class="ui-product-card__fallback" aria-hidden="true">' +
        esc(name.charAt(0).toUpperCase()) +
        "</span>";

    var discountBadge =
      percent > 0
        ? '<span class="ui-badge ui-badge--accent ui-product-card__discount">-' +
          percent +
          "%</span>"
        : "";

    var stockBadge = outOfStock
      ? '<span class="ui-badge ui-badge--danger">Out of stock</span>'
      : "";

    var mrp =
      percent > 0
        ? '<span class="ui-product-card__mrp">' + esc(formatPrice(product.mrpPrice)) + "</span>"
        : "";

    return (
      '<a class="ui-product-card" href="product-details.html?id=' +
      encodeURIComponent(product.id) +
      '">' +
      '<span class="ui-product-card__media">' +
      media +
      discountBadge +
      "</span>" +
      '<span class="ui-product-card__body">' +
      (categoryName
        ? '<span class="ui-product-card__category">' + esc(categoryName) + "</span>"
        : "") +
      '<span class="ui-product-card__name">' + esc(name) + "</span>" +
      '<span class="ui-product-card__price-row">' +
      '<span class="ui-product-card__price">' + esc(formatPrice(product.sellingPrice)) + "</span>" +
      mrp +
      stockBadge +
      "</span>" +
      "</span>" +
      "</a>"
    );
  }

  function skeletonCards(count) {
    var html = "";
    for (var i = 0; i < count; i++) {
      html +=
        '<div class="ui-skeleton-card" aria-hidden="true">' +
        '<div class="ui-skeleton ui-skeleton-card__media"></div>' +
        '<div class="ui-skeleton-card__body">' +
        '<div class="ui-skeleton" style="height: 12px; width: 40%;"></div>' +
        '<div class="ui-skeleton" style="height: 14px; width: 85%;"></div>' +
        '<div class="ui-skeleton" style="height: 14px; width: 55%;"></div>' +
        "</div>" +
        "</div>";
    }
    return html;
  }

  function emptyState(opts) {
    return (
      '<div class="ui-empty" style="grid-column: 1 / -1;">' +
      '<span class="ui-empty__icon">' + opts.icon + "</span>" +
      '<h2 class="ui-empty__title">' + esc(opts.title) + "</h2>" +
      '<p class="ui-empty__text">' + esc(opts.text) + "</p>" +
      (opts.action || "") +
      "</div>"
    );
  }

  document.addEventListener("DOMContentLoaded", function () {
    var grid = document.getElementById("results");
    if (!grid || !window.BuyOApi) return;

    var titleEl = document.getElementById("results-title");
    var countEl = document.getElementById("results-count");
    var sortSelect = document.getElementById("sort-select");

    var params = new URLSearchParams(window.location.search);
    var q = (params.get("q") || params.get("name") || "").trim();
    var category = (params.get("category") || "").trim();
    var sort = params.get("sort") || "newest";
    if (SORT_VALUES.indexOf(sort) === -1) sort = "newest";

    if (sortSelect) {
      sortSelect.value = sort;
      sortSelect.addEventListener("change", function () {
        sort = sortSelect.value;
        // Keep the URL shareable/bookmarkable without reloading.
        var next = new URLSearchParams(window.location.search);
        next.set("sort", sort);
        window.history.replaceState(null, "", "?" + next.toString());
        load();
      });
    }

    if (titleEl) {
      titleEl.textContent = q
        ? 'Results for \u201C' + q + "\u201D"
        : category
        ? "Category: " + category
        : "All products";
    }
    document.title = (titleEl ? titleEl.textContent : "Products") + " \u2014 BuyO";

    function setCount(text) {
      if (countEl) countEl.textContent = text;
    }

    function clearSearchAction() {
      if (!q) return "";
      return (
        '<a class="ui-btn ui-btn--secondary" href="products.html">Clear search</a>'
      );
    }

    var boxSvg =
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 7 9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>';

    async function load() {
      var query = new URLSearchParams();
      if (q) query.set("q", q);
      if (category) query.set("category", category);
      query.set("sort", sort);
      query.set("limit", "50");

      grid.innerHTML = skeletonCards(8);
      setCount("Loading products\u2026");

      var res = await window.BuyOApi.get("/products?" + query.toString(), {
        auth: "never" // public catalog — never attach the token
      });

      if (!res.ok) {
        grid.innerHTML = emptyState({
          icon: boxSvg,
          title: "Couldn't load products",
          text: res.message || "Something went wrong while loading the catalog.",
          action:
            '<button class="ui-btn ui-btn--primary" type="button" data-retry>Try again</button>'
        });
        var retry = grid.querySelector("[data-retry]");
        if (retry) retry.addEventListener("click", load);
        setCount("");
        return;
      }

      var products = (res.data && res.data.products) || [];
      var total = (res.data && res.data.pagination && res.data.pagination.total) || products.length;

      if (!products.length) {
        grid.innerHTML = q
          ? emptyState({
              icon: boxSvg,
              title: "No matches",
              text:
                'Nothing in the catalog matches \u201C' +
                q +
                (category ? "\u201D in " + category : "\u201D") +
                ". Try a different search.",
              action: clearSearchAction()
            })
          : emptyState({
              icon: boxSvg,
              title: "The catalog is empty",
              text:
                "No products have been added yet. Once the store is stocked, everything will show up here.",
              action: ""
            });
        setCount(
          total === 1 ? "1 product" : total + " products"
        );
        return;
      }

      grid.innerHTML = products.map(productCard).join("");
      setCount(total === 1 ? "1 product" : total + " products");
    }

    load();
  });
})();
