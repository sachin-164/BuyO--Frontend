// js/categories.js — category browsing with real data (Phase 8)
// Replaces the old hardcoded category grid. Reads ?category= (accepts a slug,
// a name, or a numeric id — the API resolves all three) and renders:
//   - selectable chips from GET /api/categories (All + each real category)
//   - a product grid from GET /api/products?category=... with loading,
//     error, and empty states.
// Chip clicks update the URL with history.pushState — no full reload.
(function () {
  "use strict";

  var CATALOG = window.BuyOCatalog;
  if (!CATALOG || !window.BuyOApi) return;

  var state = {
    categories: [],
    selected: "" // "" = all; otherwise slug or name of the selected category
  };

  var chipsHost = document.getElementById("category-chips");
  var grid = document.getElementById("results");
  var countEl = document.getElementById("results-count");
  var heading = document.getElementById("results-heading");
  var pageTitle = document.getElementById("page-title");

  function readParam() {
    return (new URLSearchParams(window.location.search).get("category") || "").trim();
  }

  function selectedCategory() {
    if (!state.selected) return null;
    var needle = state.selected.toLowerCase();
    return (
      state.categories.find(function (category) {
        return (
          String(category.slug || "").toLowerCase() === needle ||
          String(category.name || "").toLowerCase() === needle ||
          String(category.id) === state.selected
        );
      }) || null
    );
  }

  function renderChips() {
    if (!state.categories.length) {
      chipsHost.innerHTML = ""; // no categories in the store — nothing to pick
      return;
    }
    var active = selectedCategory();
    var all =
      '<button class="ui-chip" type="button" data-category="" aria-pressed="' +
      String(!active) +
      '">All</button>';
    chipsHost.innerHTML =
      all +
      state.categories
        .map(function (category) {
          var key = category.slug || category.name;
          var isActive = active && active.id === category.id;
          return (
            '<button class="ui-chip" type="button" data-category="' +
            CATALOG.esc(key) +
            '" aria-pressed="' +
            String(!!isActive) +
            '">' +
            CATALOG.esc(category.name) +
            '<span class="ui-chip__count">' +
            Number(category.productCount) +
            "</span>" +
            "</button>"
          );
        })
        .join("");
  }

  function renderHeading() {
    var active = selectedCategory();
    var label = active ? active.name : "All products";
    heading.textContent = label;
    pageTitle.textContent = active ? "Category: " + active.name : "Shop by category";
    document.title = label + " — BuyO";
  }

  async function loadProducts() {
    var query = new URLSearchParams();
    if (state.selected) query.set("category", state.selected);
    query.set("sort", "newest");
    query.set("limit", "50");

    grid.innerHTML = CATALOG.skeletonCards(8);
    countEl.textContent = "Loading products…";

    var res = await BuyOApi.get("/products?" + query.toString(), {
      auth: "never"
    });

    if (!res.ok) {
      grid.innerHTML = CATALOG.emptyState({
        title: "Couldn't load products",
        text: res.message || "Something went wrong while loading the catalog.",
        action:
          '<button class="ui-btn ui-btn--primary" type="button" data-retry>Try again</button>'
      });
      var retry = grid.querySelector("[data-retry]");
      if (retry) retry.addEventListener("click", loadProducts);
      countEl.textContent = "";
      return;
    }

    var products = (res.data && res.data.products) || [];
    var total = (res.data && res.data.pagination && res.data.pagination.total) || products.length;
    countEl.textContent = total === 1 ? "1 product" : total + " products";

    if (!products.length) {
      var active = selectedCategory();
      grid.innerHTML = CATALOG.emptyState({
        title: "Nothing here yet",
        text: active
          ? "No products have been added to " + active.name + " yet."
          : "No products have been added to the catalog yet.",
        action: active
          ? '<button class="ui-btn ui-btn--secondary" type="button" data-show-all>Show all products</button>'
          : ""
      });
      var showAll = grid.querySelector("[data-show-all]");
      if (showAll) {
        showAll.addEventListener("click", function () {
          selectCategory("");
        });
      }
      return;
    }

    grid.innerHTML = products.map(CATALOG.productCard).join("");
  }

  function selectCategory(key) {
    state.selected = key;
    var url = new URL(window.location.href);
    if (key) url.searchParams.set("category", key);
    else url.searchParams.delete("category");
    window.history.pushState({ category: key }, "", url);
    renderChips();
    renderHeading();
    loadProducts();
  }

  chipsHost.addEventListener("click", function (event) {
    var chip = event.target.closest("[data-category]");
    if (!chip) return;
    selectCategory(chip.getAttribute("data-category") || "");
  });

  // Back/forward buttons re-render without a reload.
  window.addEventListener("popstate", function () {
    state.selected = readParam();
    renderChips();
    renderHeading();
    loadProducts();
  });

  async function init() {
    state.selected = readParam();

    var res = await BuyOApi.get("/categories", { auth: "never" });
    state.categories = (res.ok && res.data && res.data.categories) || [];

    // A category param that matches nothing real still filters the API
    // (the backend falls back to a legacy free-text category match), so we
    // keep it selected even when it is not in the chips list.
    renderChips();
    renderHeading();
    loadProducts();
  }

  init();
})();
