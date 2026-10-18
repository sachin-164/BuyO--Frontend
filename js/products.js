// js/products.js — catalog listing + search results (Phase 7, refactored P8)
// This page ALWAYS reflects the real catalog via GET /api/products (the same
// public API the header search targets with ?q=...). Supports:
//   products.html                     -> all products, newest first
//   products.html?q=laptop            -> text search (name/description LIKE)
//   products.html?category=Electronics-> category filter (id, slug, or name)
//   products.html?sort=price_asc      -> whitelisted server sort
// Legacy links using ?name= (from the old demo cards) are honoured as ?q=.
// Card/skeleton/empty-state rendering lives in js/catalog.js (shared with the
// homepage and categories page).
(function () {
  "use strict";

  var CATALOG = window.BuyOCatalog;
  if (!CATALOG || !window.BuyOApi) return;

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

  document.addEventListener("DOMContentLoaded", function () {
    var grid = document.getElementById("results");
    if (!grid) return;

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

    async function load() {
      var query = new URLSearchParams();
      if (q) query.set("q", q);
      if (category) query.set("category", category);
      query.set("sort", sort);
      query.set("limit", "50");

      grid.innerHTML = CATALOG.skeletonCards(8);
      setCount("Loading products\u2026");

      var res = await BuyOApi.get("/products?" + query.toString(), {
        auth: "never" // public catalog — never attach the token
      });

      if (!res.ok) {
        grid.innerHTML = CATALOG.emptyState({
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
          ? CATALOG.emptyState({
              title: "No matches",
              text:
                'Nothing in the catalog matches \u201C' +
                q +
                (category ? "\u201D in " + category : "\u201D") +
                ". Try a different search.",
              action: clearSearchAction()
            })
          : CATALOG.emptyState({
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

      grid.innerHTML = products.map(CATALOG.productCard).join("");
      setCount(total === 1 ? "1 product" : total + " products");
    }

    load();
  });
})();
