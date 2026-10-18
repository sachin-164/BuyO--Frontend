// js/cart.js — server-authoritative cart page (Phase 9 rewrite)
// Replaces the old localStorage cart (hardcoded counts, invented tax) with the
// real API:
//   GET    /api/cart         -> { count, items, totals, totalsNotice }
//   PUT    /api/cart/:id     -> { qty }      (1..99, capped by stock)
//   DELETE /api/cart/:id     -> remove line
// Totals (subtotal / per-category GST preview / grand total) are always the
// server's numbers — nothing is computed client-side.
// Layout follows design-references/cart.png: step indicator, line items with
// quantity steppers, right-hand Order Summary card. No coupon field (no coupon
// feature exists), no shipping/estimated-delivery rows (no such data in v1).
(function () {
  "use strict";

  var CATALOG = window.BuyOCatalog;
  if (!CATALOG || !window.BuyOApi) return;

  var MAX_LINE_QTY = 99; // mirrors server MAX_LINE_QTY

  var els = {
    count: document.getElementById("cart-count"),
    guest: document.getElementById("cart-guest"),
    empty: document.getElementById("cart-empty"),
    body: document.getElementById("cart-body"),
    lines: document.getElementById("cart-lines"),
    summaryRows: document.getElementById("summary-rows"),
    summaryNotice: document.getElementById("summary-notice"),
    proceed: document.getElementById("proceed-checkout")
  };

  var state = { cart: null };

  function show(view) {
    els.guest.hidden = view !== "guest";
    els.empty.hidden = view !== "empty";
    els.body.hidden = view !== "body";
    if (view !== "body") els.count.textContent = "";
  }

  function notifyCartUpdated() {
    try {
      document.dispatchEvent(new CustomEvent("buyo:cart-updated"));
    } catch (e) {
      /* degrade silently */
    }
  }

  function toast(message, type) {
    if (window.BuyOUi) BuyOUi.toast(message, { type: type || "info" });
  }

  // ---------- Rendering ----------
  function renderLines(cart) {
    els.lines.innerHTML = cart.items
      .map(function (item) {
        var media;
        var safeImage = CATALOG.safeImageUrl(item.image);
        if (item.unavailable) {
          media =
            '<span class="ui-cart-line__fallback" aria-hidden="true">?</span>';
        } else if (safeImage) {
          media =
            '<img src="' +
            CATALOG.esc(safeImage) +
            '" alt="' +
            CATALOG.esc(item.name) +
            '" loading="lazy">';
        } else {
          media =
            '<span class="ui-cart-line__fallback" aria-hidden="true">' +
            CATALOG.esc(String(item.name || "?").charAt(0).toUpperCase()) +
            "</span>";
        }

        var nameHtml = item.productId
          ? '<a class="ui-cart-line__name" href="product-details.html?id=' +
            encodeURIComponent(item.productId) +
            '">' +
            CATALOG.esc(item.name) +
            "</a>"
          : '<span class="ui-cart-line__name">' +
            CATALOG.esc(item.name) +
            "</span>";

        var note = "";
        if (item.unavailable) {
          note =
            '<p class="ui-cart-line__note"><span class="ui-badge ui-badge--danger">No longer available</span></p>';
        } else if (item.stockExceeded) {
          note =
            '<p class="ui-cart-line__note"><span class="ui-badge ui-badge--warning">Only ' +
            Number(item.stock) +
            " left in stock</span></p>";
        }

        var qtyBlock;
        if (item.unavailable) {
          qtyBlock = '<span class="ui-qty__value" aria-hidden="true">—</span>';
        } else {
          var maxQty = Math.max(
            1,
            Math.min(MAX_LINE_QTY, Number(item.stock) || MAX_LINE_QTY)
          );
          qtyBlock =
            '<div class="ui-qty">' +
            '<button class="ui-qty-btn" type="button" data-qty-dec aria-label="Decrease quantity of ' +
            CATALOG.esc(item.name) +
            '"' +
            (item.qty <= 1 ? " disabled" : "") +
            ">−</button>" +
            '<span class="ui-qty__value" aria-label="Quantity">' +
            item.qty +
            "</span>" +
            '<button class="ui-qty-btn" type="button" data-qty-inc aria-label="Increase quantity of ' +
            CATALOG.esc(item.name) +
            '"' +
            (item.qty >= maxQty ? " disabled" : "") +
            ">+</button>" +
            "</div>";
        }

        var priceHtml =
          '<span class="ui-cart-line__price"><span>' +
          CATALOG.formatPrice(item.lineTotal) +
          "</span>" +
          (!item.unavailable && item.qty > 1
            ? '<span class="ui-cart-line__unit">' +
              CATALOG.formatPrice(item.price) +
              " each</span>"
            : "") +
          "</span>";

        return (
          '<div class="ui-cart-line" data-line-id="' +
          item.id +
          '" data-product-id="' +
          (item.productId == null ? "" : item.productId) +
          '">' +
          '<span class="ui-cart-line__media">' +
          media +
          "</span>" +
          "<div>" +
          nameHtml +
          priceHtml +
          note +
          '<div class="ui-cart-line__controls">' +
          qtyBlock +
          "</div>" +
          "</div>" +
          '<button class="ui-cart-line__remove" type="button" data-remove aria-label="Remove ' +
          CATALOG.esc(item.name) +
          ' from cart">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M10 11v6M14 11v6"/></svg>' +
          "</button>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderSummary(cart) {
    var totals = cart.totals || {};
    var tax = totals.tax || { total: 0, byCategory: [] };

    function row(label, value, extraClass) {
      return (
        '<div class="ui-summary__row' +
        (extraClass ? " " + extraClass : "") +
        '">' +
        "<dt>" +
        CATALOG.esc(label) +
        "</dt>" +
        '<dd class="ui-summary__value">' +
        value +
        "</dd>" +
        "</div>"
      );
    }

    els.summaryRows.innerHTML =
      row("Sub Total", CATALOG.formatPrice(totals.subtotal)) +
      row(
        "Tax (GST)",
        CATALOG.formatPrice(tax.total) +
          (tax.byCategory && tax.byCategory.length && tax.byCategory.some(function (g) { return g.taxRate > 0; })
            ? ""
            : "")
      ) +
      row("Total", CATALOG.formatPrice(totals.grandTotal), "ui-summary__row--total");

    els.summaryNotice.textContent = cart.totalsNotice || "";
    els.summaryNotice.hidden = !cart.totalsNotice;
  }

  function renderSkeleton() {
    els.lines.innerHTML = CATALOG.skeletonCards(2).replace(
      /class="ui-skeleton-card"/g,
      'class="ui-skeleton-card" style="border: 0;"'
    );
    els.summaryRows.innerHTML =
      '<div class="ui-skeleton" style="height: 14px; width: 70%; margin-block: 6px;"></div>' +
      '<div class="ui-skeleton" style="height: 14px; width: 60%; margin-block: 6px;"></div>' +
      '<div class="ui-skeleton" style="height: 20px; width: 80%; margin-block: 10px;"></div>';
  }

  function applyCart(cart) {
    state.cart = cart;
    els.count.textContent =
      cart.count === 1 ? "1 item" : cart.count + " items";
    if (!cart.count) {
      show("empty");
      notifyCartUpdated();
      return;
    }
    renderLines(cart);
    renderSummary(cart);
    show("body");
    notifyCartUpdated();
  }

  // ---------- Loading ----------
  async function load() {
    if (!window.BuyOApi.getToken()) {
      show("guest");
      return;
    }
    renderSkeleton();
    show("body");
    els.count.textContent = "Loading…";

    var res = await BuyOApi.get("/cart");
    if (res.status === 401) {
      // Session rejected — api.js cleared it; show the honest guest state.
      show("guest");
      return;
    }
    if (!res.ok) {
      els.lines.innerHTML = CATALOG.emptyState({
        title: "Couldn't load your cart",
        text: res.message || "Something went wrong. Please try again.",
        action:
          '<button class="ui-btn ui-btn--primary" type="button" data-retry>Try again</button>'
      });
      var retry = els.lines.querySelector("[data-retry]");
      if (retry) retry.addEventListener("click", load);
      els.count.textContent = "";
      els.summaryRows.innerHTML = "";
      els.summaryNotice.hidden = true;
      return;
    }
    applyCart((res.data && res.data.count !== undefined && res.data) || null);
  }

  // ---------- Line mutations ----------
  async function setQty(lineEl, qty) {
    var lineId = lineEl.getAttribute("data-line-id");
    lineEl.classList.add("ui-cart-line--busy");
    var res = await BuyOApi.put("/cart/" + lineId, { qty: qty });
    if (res.ok) {
      applyCart(res.data);
    } else {
      lineEl.classList.remove("ui-cart-line--busy");
      toast(res.message || "Couldn't update quantity.", "error");
      if (res.status === 401) show("guest");
    }
  }

  async function removeLine(lineEl) {
    var lineId = lineEl.getAttribute("data-line-id");
    lineEl.classList.add("ui-cart-line--busy");
    var res = await BuyOApi.del("/cart/" + lineId);
    if (res.ok) {
      toast(res.data && res.data.message ? res.data.message : "Item removed.", "success");
      applyCart(res.data);
    } else {
      lineEl.classList.remove("ui-cart-line--busy");
      toast(res.message || "Couldn't remove the item.", "error");
      if (res.status === 401) show("guest");
    }
  }

  els.lines.addEventListener("click", function (event) {
    var lineEl = event.target.closest("[data-line-id]");
    if (!lineEl || lineEl.classList.contains("ui-cart-line--busy")) return;
    var line = state.cart && state.cart.items.find(function (item) {
      return String(item.id) === lineEl.getAttribute("data-line-id");
    });
    if (!line) return;

    if (event.target.closest("[data-remove]")) {
      removeLine(lineEl);
      return;
    }
    if (event.target.closest("[data-qty-inc]")) {
      var next = line.qty + 1;
      var cap = Math.min(MAX_LINE_QTY, Number(line.stock) || MAX_LINE_QTY);
      if (next > cap) {
        toast("Only " + line.stock + " left in stock for this item.", "info");
        return;
      }
      setQty(lineEl, next);
      return;
    }
    if (event.target.closest("[data-qty-dec]")) {
      if (line.qty > 1) setQty(lineEl, line.qty - 1);
    }
  });

  els.proceed.addEventListener("click", function () {
    window.location.href = "checkout.html";
  });

  // A sign-out while the cart is open drops back to the guest state.
  document.addEventListener("buyo:signed-out", function () {
    show("guest");
  });
  document.addEventListener("buyo:session-cleared", function () {
    show("guest");
  });

  load();
})();
