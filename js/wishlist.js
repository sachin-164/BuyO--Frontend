// js/wishlist.js — server-backed wishlist page (Phase 9)
// Replaces the empty legacy container (the old page had no script at all).
// Real API surface:
//   GET    /api/wishlist              -> { count, items } (live product data)
//   DELETE /api/wishlist/:productId   -> remove
// Cards reuse BuyOCatalog.productCard (same look as home/categories); items
// whose product was deleted render as a non-link "unavailable" card with a
// working Remove. No dedicated reference screenshot exists (reported).
(function () {
  "use strict";

  var CATALOG = window.BuyOCatalog;
  if (!CATALOG || !window.BuyOApi) return;

  var els = {
    count: document.getElementById("wishlist-count"),
    guest: document.getElementById("wishlist-guest"),
    grid: document.getElementById("wishlist-grid")
  };

  function toast(message, type) {
    if (window.BuyOUi) BuyOUi.toast(message, { type: type || "info" });
  }

  function notifyWishlistUpdated() {
    try {
      document.dispatchEvent(new CustomEvent("buyo:wishlist-updated"));
    } catch (e) { /* degrade silently */ }
  }

  function show(view) {
    els.guest.hidden = view !== "guest";
    els.grid.hidden = view !== "grid";
    if (view !== "grid") els.count.textContent = "";
  }

  function setCount(n) {
    els.count.textContent = n === 0 ? "" : n === 1 ? "1 saved item" : n + " saved items";
  }

  function goneCard(item) {
    return (
      '<div class="ui-wish-gone">' +
      '<span class="ui-badge ui-badge--danger">No longer available</span>' +
      '<span class="ui-wish-gone__name">' + CATALOG.esc(item.name) + "</span>" +
      '<span class="ui-wish-gone__text">This product was removed from the catalog.</span>' +
      "</div>"
    );
  }

  function render(items) {
    if (!items.length) {
      els.grid.hidden = false;
      els.grid.style.display = "block";
      els.grid.innerHTML = CATALOG.emptyState({
        title: "Your wishlist is empty",
        text: "Tap the heart on any product to save it for later.",
        action: '<a class="ui-btn ui-btn--primary" href="products.html">Browse the catalog</a>'
      });
      setCount(0);
      return;
    }

    els.grid.style.display = "";
    els.grid.innerHTML = items
      .map(function (item) {
        var linkable = item.productId != null && !item.unavailable;
        var card = linkable
          ? CATALOG.productCard({
              id: item.productId,
              name: item.name,
              sellingPrice: item.price,
              image: item.image,
              stock: item.inStock ? 1 : 0
            })
          : goneCard(item);
        return (
          '<div class="ui-wish-item" data-product-id="' +
          (item.productId == null ? "" : item.productId) +
          '">' +
          card +
          '<div class="ui-wish-item__actions">' +
          '<button class="ui-btn ui-btn--ghost ui-btn--sm" type="button" data-wish-remove ' +
          'aria-label="Remove ' + CATALOG.esc(item.name) + ' from wishlist">Remove</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    setCount(items.length);
  }

  function renderSkeleton() {
    els.grid.hidden = false;
    els.grid.style.display = "";
    els.grid.innerHTML = CATALOG.skeletonCards(6);
    els.count.textContent = "Loading…";
  }

  async function load() {
    if (!window.BuyOApi.getToken()) {
      show("guest");
      return;
    }
    renderSkeleton();

    var res = await BuyOApi.get("/wishlist");
    if (res.status === 401) {
      show("guest");
      return;
    }
    if (!res.ok) {
      els.grid.style.display = "block";
      els.grid.innerHTML = CATALOG.emptyState({
        title: "Couldn't load your wishlist",
        text: res.message || "Something went wrong. Please try again.",
        action: '<button class="ui-btn ui-btn--primary" type="button" id="wishlist-retry">Try again</button>'
      });
      els.count.textContent = "";
      var retry = document.getElementById("wishlist-retry");
      if (retry) retry.addEventListener("click", load);
      return;
    }
    var items = (res.data && res.data.items) || [];
    render(items);
    notifyWishlistUpdated();
  }

  // Remove: DELETE /api/wishlist/:productId, then drop the card in place.
  els.grid.addEventListener("click", async function (event) {
    var btn = event.target.closest("[data-wish-remove]");
    if (!btn) return;
    var item = btn.closest("[data-product-id]");
    if (!item || item.getAttribute("data-busy") === "1") return;
    var productId = item.getAttribute("data-product-id");
    if (!productId) {
      // Server-side rows keyed by a product that no longer exists can't be
      // addressed by DELETE /wishlist/:productId — be honest instead of
      // firing a request that cannot match.
      toast("This entry has no product id anymore and can't be removed.", "error");
      return;
    }

    item.setAttribute("data-busy", "1");
    item.style.opacity = "0.6";

    var res = await BuyOApi.del("/wishlist/" + productId);
    if (res.ok) {
      toast((res.data && res.data.message) || "Removed from wishlist.", "success");
      await load(); // re-render with authoritative count
      return;
    }
    item.removeAttribute("data-busy");
    item.style.opacity = "";
    toast(res.message || "Couldn't remove the item.", "error");
    if (res.status === 401) show("guest");
  });

  document.addEventListener("buyo:signed-out", function () { show("guest"); });
  document.addEventListener("buyo:session-cleared", function () { show("guest"); });

  load();
})();
