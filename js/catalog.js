// js/catalog.js — shared catalog rendering helpers (Phase 8)
// Single source of truth for product cards / skeletons / empty states, used by
// index, categories, and products pages. Loaded AFTER js/api.js.
// Everything here renders REAL API data only — no placeholders or samples.
(function (global) {
  "use strict";

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

  // Discount is derived (mrp vs selling) — it is never stored on the product.
  function discountPercent(mrp, selling) {
    var m = Number(mrp);
    var s = Number(selling);
    if (!isFinite(m) || !isFinite(s) || m <= s || m <= 0) return 0;
    return Math.round(((m - s) / m) * 100);
  }

  // Images may be absolute URLs or /uploads/<file> from the admin upload API.
  // Anything else (empty, relative demo paths, javascript: etc.) gets the
  // letter-tile fallback instead of a broken image.
  function safeImageUrl(value) {
    var image = String(value || "").trim();
    return /^(\/uploads\/|https?:\/\/)/i.test(image) ? image : "";
  }

  // Empty-state icon: a neutral package glyph (inline SVG, no dependencies).
  var boxIcon =
    '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 7 9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>';

  // Product card: the entire card is one link to product-details.html?id=<id>
  // (numeric ids and slugs both work — the detail API accepts either).
  function productCard(product) {
    var percent = discountPercent(product.mrpPrice, product.sellingPrice);
    var name = String(product.name || "Product");
    var safeImage = safeImageUrl(product.image);
    var altText =
      (product.imageMeta && product.imageMeta.alt) || name;
    var categoryName =
      (product.Category && product.Category.name) || product.category || "";
    var outOfStock = !(Number(product.stock) > 0);

    var media = safeImage
      ? '<img src="' + esc(safeImage) + '" alt="' + esc(altText) + '" loading="lazy">'
      : '<span class="ui-product-card__fallback" aria-hidden="true">' +
        esc(name.charAt(0).toUpperCase()) +
        "</span>";

    var discountBadge =
      percent > 0
        ? '<span class="ui-badge ui-badge--accent ui-product-card__discount">-' +
          percent +
          "%</span>"
        : "";

    var mrp =
      percent > 0
        ? '<span class="ui-product-card__mrp">' + esc(formatPrice(product.mrpPrice)) + "</span>"
        : "";

    var stockBadge = outOfStock
      ? '<span class="ui-badge ui-badge--danger">Out of stock</span>'
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

  // opts: { icon, title, text, action? (HTML string) }
  function emptyState(opts) {
    return (
      '<div class="ui-empty" style="grid-column: 1 / -1;">' +
      '<span class="ui-empty__icon">' + (opts.icon || boxIcon) + "</span>" +
      '<h2 class="ui-empty__title">' + esc(opts.title) + "</h2>" +
      '<p class="ui-empty__text">' + esc(opts.text) + "</p>" +
      (opts.action || "") +
      "</div>"
    );
  }

  global.BuyOCatalog = {
    esc: esc,
    formatPrice: formatPrice,
    discountPercent: discountPercent,
    safeImageUrl: safeImageUrl,
    boxIcon: boxIcon,
    productCard: productCard,
    skeletonCards: skeletonCards,
    emptyState: emptyState
  };
})(window);
