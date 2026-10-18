// js/home.js — homepage catalog sections (Phase 8)
// Real data only:
//   - categories strip  <- GET /api/categories          (hidden when none)
//   - new arrivals      <- GET /api/products?sort=newest (hidden when empty)
//   - on sale           <- same fetch, filtered to products whose REAL
//                          mrpPrice is above sellingPrice (no invented deals)
//   - empty note        <- shown only when the catalog truly has 0 products
(function () {
  "use strict";

  var CATALOG = window.BuyOCatalog;
  if (!CATALOG || !window.BuyOApi) return;

  function show(id, on) {
    var el = document.getElementById(id);
    if (el) el.hidden = !on;
  }

  // ---------- Categories strip ----------
  async function loadCategories() {
    var res = await BuyOApi.get("/categories", { auth: "never" });
    var categories = (res.ok && res.data && res.data.categories) || [];
    if (!categories.length) {
      show("home-categories-section", false);
      return;
    }
    var host = document.getElementById("home-categories");
    host.innerHTML = categories
      .map(function (category) {
        var key = category.slug || category.name;
        var count = Number(category.productCount) || 0;
        return (
          '<a class="ui-chip" href="categories.html?category=' +
          encodeURIComponent(key) +
          '">' +
          CATALOG.esc(category.name) +
          (count > 0
            ? '<span class="ui-chip__count">' + count + "</span>"
            : "") +
          "</a>"
        );
      })
      .join("");
    show("home-categories-section", true);
  }

  // ---------- Product sections (arrivals + on sale share one fetch) ----------
  async function loadProducts() {
    var arrivalsGrid = document.getElementById("home-arrivals-grid");
    var dealsGrid = document.getElementById("home-deals-grid");

    arrivalsGrid.innerHTML = CATALOG.skeletonCards(8);
    show("home-arrivals-section", true);

    // 100 = the API maximum per request; enough for a homepage window.
    var res = await BuyOApi.get("/products?sort=newest&limit=100", {
      auth: "never"
    });

    if (!res.ok) {
      show("home-arrivals-section", false);
      if (window.BuyOUi) {
        BuyOUi.toast(
          "Couldn't load the catalog: " + (res.message || "please try again."),
          { type: "error" }
        );
      }
      return;
    }

    var data = res.data || {};
    var products = data.products || [];
    var total = (data.pagination && data.pagination.total) || products.length;

    if (!total) {
      // Nothing exists to show — hide the skeleton section too, so only the
      // honest empty-catalog note remains.
      show("home-arrivals-section", false);
      show("home-deals-section", false);
      show("home-empty-section", true);
      return;
    }

    var arrivals = products.slice(0, 8);
    arrivalsGrid.innerHTML = arrivals.map(CATALOG.productCard).join("");
    show("home-arrivals-section", true);

    var deals = products
      .filter(function (product) {
        return CATALOG.discountPercent(product.mrpPrice, product.sellingPrice) > 0;
      })
      .slice(0, 8);

    if (deals.length) {
      dealsGrid.innerHTML = deals.map(CATALOG.productCard).join("");
      show("home-deals-section", true);
    } else {
      show("home-deals-section", false);
    }
  }

  loadCategories();
  loadProducts();
})();
