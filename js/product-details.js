// js/product-details.js — product detail page (Phase 8 rewrite)
// Loads one product from the real API: GET /api/products/:identifier where the
// identifier is a numeric id OR a slug (both URL styles keep working:
// product-details.html?id=12 and product-details.html?id=some-slug, plus the
// legacy ?slug= form).
//
// Actions (existing backend behaviour, now with the JWT actually attached —
// the old page never sent the token, so these always failed with 401):
//   - Add to cart    -> POST /api/cart    { productId, qty: 1 }   (auth required)
//   - Add to wishlist -> POST /api/wishlist { productId }          (auth required)
// Without a session the buttons explain that sign-in is needed — nothing is
// faked. "Buy Now" was removed: it pointed to the empty checkout.html, and the
// checkout flow is Phase 9 work.
(function () {
  "use strict";

  var CATALOG = window.BuyOCatalog;
  if (!CATALOG || !window.BuyOApi) return;

  var params = new URLSearchParams(window.location.search);
  var identifier = (params.get("id") || params.get("slug") || "").trim();

  var statusEl = document.getElementById("detail-status");
  var detailEl = document.getElementById("detail");
  var cartBtn = document.getElementById("add-to-cart");
  var wishlistBtn = document.getElementById("add-to-wishlist");
  var authNote = document.getElementById("auth-note");

  var currentProduct = null;

  function setStatus(html) {
    statusEl.innerHTML = html;
    statusEl.hidden = !html;
    detailEl.hidden = !!html;
    var retry = statusEl.querySelector("[data-retry]");
    if (retry) retry.addEventListener("click", load);
  }

  function statusBlock(opts) {
    return (
      '<div class="ui-empty">' +
      '<span class="ui-empty__icon">' + CATALOG.boxIcon + "</span>" +
      '<h1 class="ui-empty__title">' + CATALOG.esc(opts.title) + "</h1>" +
      '<p class="ui-empty__text">' + CATALOG.esc(opts.text) + "</p>" +
      (opts.action || "") +
      "</div>"
    );
  }

  function backLink(label) {
    return (
      '<a class="ui-btn ui-btn--secondary" href="products.html">' +
      (label || "Back to products") +
      "</a>"
    );
  }

  // ---------- Session state for the action buttons ----------
  function syncAuthUi() {
    var signedIn = !!window.BuyOApi.getToken();
    authNote.hidden = signedIn;
  }

  document.addEventListener("buyo:session-cleared", syncAuthUi);
  document.addEventListener("buyo:signed-out", syncAuthUi);

  function requireSession(feature) {
    if (window.BuyOApi.getToken()) return true;
    syncAuthUi();
    if (window.BuyOUi) {
      BuyOUi.toast("Please sign in to " + feature + ".", { type: "error" });
    }
    authNote.scrollIntoView({ block: "nearest" });
    return false;
  }

  // ---------- Rendering ----------
  function renderBreadcrumb(product) {
    var crumb = document.getElementById("breadcrumb");
    var sep = document.getElementById("breadcrumb-sep");
    var link = document.getElementById("breadcrumb-category");
    var name =
      (product.Category && product.Category.name) || product.category || "";
    if (!name) {
      crumb.hidden = false; // Home / Products always shown
      return;
    }
    var key =
      (product.Category && (product.Category.slug || product.Category.name)) ||
      name;
    link.textContent = name;
    link.href = "categories.html?category=" + encodeURIComponent(key);
    link.hidden = false;
    sep.hidden = false;
    crumb.hidden = false;
  }

  function render(product) {
    currentProduct = product;

    // Success: remove the loading skeleton before showing the article, so the
    // status area never lingers above the loaded content.
    statusEl.innerHTML = "";
    statusEl.hidden = true;

    var name = String(product.name || "Product");
    var percent = CATALOG.discountPercent(product.mrpPrice, product.sellingPrice);
    var stock = Number(product.stock) || 0;
    var safeImage = CATALOG.safeImageUrl(product.image);

    document.title = name + " — BuyO";

    // Media: real image when one exists, honest letter-tile fallback otherwise.
    var media = document.getElementById("detail-media");
    if (safeImage) {
      var alt =
        (product.imageMeta && product.imageMeta.alt) || name;
      media.innerHTML =
        '<img src="' + CATALOG.esc(safeImage) + '" alt="' + CATALOG.esc(alt) + '">';
    } else {
      media.innerHTML =
        '<span class="ui-detail__fallback" aria-hidden="true">' +
        CATALOG.esc(name.charAt(0).toUpperCase()) +
        "</span>";
    }
    if (percent > 0) {
      media.insertAdjacentHTML(
        "beforeend",
        '<span class="ui-badge ui-badge--accent ui-detail__discount">-' +
          percent +
          "%</span>"
      );
    }

    // Category link.
    var categoryEl = document.getElementById("detail-category");
    var categoryName =
      (product.Category && product.Category.name) || product.category || "";
    if (categoryName) {
      var categoryKey =
        (product.Category &&
          (product.Category.slug || product.Category.name)) ||
        categoryName;
      categoryEl.textContent = categoryName;
      categoryEl.href =
        "categories.html?category=" + encodeURIComponent(categoryKey);
    } else {
      categoryEl.hidden = true;
    }

    document.getElementById("detail-name").textContent = name;
    document.getElementById("detail-price").textContent =
      CATALOG.formatPrice(product.sellingPrice);

    var mrpEl = document.getElementById("detail-mrp");
    if (percent > 0) {
      mrpEl.textContent = CATALOG.formatPrice(product.mrpPrice);
      mrpEl.hidden = false;
    }

    document.getElementById("detail-stock").innerHTML =
      stock > 0
        ? '<span class="ui-badge ui-badge--success">In stock</span>'
        : '<span class="ui-badge ui-badge--danger">Out of stock</span>';

    document.getElementById("detail-description").textContent =
      String(product.description || "").trim() ||
      "No description has been provided for this product.";

    // Out-of-stock: cart action is honestly disabled (the server would reject
    // it anyway); the wishlist does not depend on stock and stays available.
    cartBtn.disabled = !(stock > 0);

    renderBreadcrumb(product);
    syncAuthUi();
    detailEl.hidden = false;
  }

  // ---------- Loading ----------
  async function load() {
    if (!identifier) {
      setStatus(
        statusBlock({
          title: "No product specified",
          text: "This page needs a product id or slug, for example product-details.html?id=1.",
          action: backLink("Browse products")
        })
      );
      return;
    }

    // Skeleton while loading.
    statusEl.hidden = false;
    detailEl.hidden = true;
    statusEl.innerHTML =
      '<div class="ui-detail">' +
      '<div class="ui-skeleton" style="aspect-ratio: 1; border-radius: var(--radius-lg);"></div>' +
      '<div style="display: flex; flex-direction: column; gap: var(--space-3);">' +
      '<div class="ui-skeleton" style="height: 14px; width: 30%;"></div>' +
      '<div class="ui-skeleton" style="height: 30px; width: 80%;"></div>' +
      '<div class="ui-skeleton" style="height: 22px; width: 40%;"></div>' +
      '<div class="ui-skeleton" style="height: 90px; width: 100%; margin-top: var(--space-4);"></div>' +
      "</div>" +
      "</div>";

    // encodeURIComponent keeps slugs with spaces/special characters intact.
    var res = await BuyOApi.get(
      "/products/" + encodeURIComponent(identifier),
      { auth: "never" } // public endpoint — never attach the token
    );

    if (res.status === 404) {
      setStatus(
        statusBlock({
          title: "Product not found",
          text:
            "We couldn't find a product with that id or slug. It may have been removed, or the link may be wrong.",
          action: backLink()
        })
      );
      return;
    }

    if (!res.ok) {
      setStatus(
        statusBlock({
          title: "Couldn't load this product",
          text: res.message || "Something went wrong. Please try again.",
          action:
            '<button class="ui-btn ui-btn--primary" type="button" data-retry>Try again</button>'
        })
      );
      return;
    }

    render((res.data && res.data.product) || null);
  }

  // ---------- Actions ----------
  cartBtn.addEventListener("click", async function () {
    if (!currentProduct || !requireSession("add items to your cart")) return;
    cartBtn.setAttribute("aria-busy", "true");
    cartBtn.disabled = true;
    var res = await BuyOApi.post("/cart", {
      productId: currentProduct.id,
      qty: 1
    });
    cartBtn.removeAttribute("aria-busy");
    cartBtn.disabled = !(Number(currentProduct.stock) > 0);
    if (res.ok) {
      if (window.BuyOUi) {
        BuyOUi.toast(res.data && res.data.message ? res.data.message : "Added to cart.", {
          type: "success"
        });
      }
    } else if (window.BuyOUi) {
      BuyOUi.toast(res.message || "Couldn't add to cart.", { type: "error" });
    }
  });

  wishlistBtn.addEventListener("click", async function () {
    if (!currentProduct || !requireSession("save items to your wishlist")) return;
    wishlistBtn.setAttribute("aria-busy", "true");
    wishlistBtn.disabled = true;
    var res = await BuyOApi.post("/wishlist", { productId: currentProduct.id });
    wishlistBtn.removeAttribute("aria-busy");
    wishlistBtn.disabled = false;
    if (res.ok) {
      if (window.BuyOUi) {
        BuyOUi.toast(
          res.data && res.data.message ? res.data.message : "Added to wishlist.",
          { type: "success" }
        );
      }
    } else if (window.BuyOUi) {
      BuyOUi.toast(res.message || "Couldn't add to wishlist.", {
        type: "error"
      });
    }
  });

  load();
})();
