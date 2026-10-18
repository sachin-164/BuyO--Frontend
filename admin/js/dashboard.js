// admin/js/dashboard.js — admin dashboard (Phase 10)
// EVERY number on this page is derived from live API responses:
//   - orders list        -> GET /api/admin/orders (fetched to completion,
//                           de-duplicated; the server's pagination.total counts
//                           joined rows — see shell.fetchAllOrders / report P10-1)
//   - products / out-of-stock -> GET /api/products pages (server totals are
//                           reliable here: the products query sets DISTINCT)
//   - categories         -> GET /api/categories
//   - order value        -> sum of grandTotal over non-cancelled fetched orders
// No chart, no customer count, no fabricated figures: the backend has no
// analytics or customer-listing endpoints (documented deferrals).
(function () {
  "use strict";
  if (!window.BuyOShell || !window.BuyOApi) return;

  var C = window.BuyOCatalog;
  var U = window.BuyOUi;

  BuyOShell.ready.then(start).catch(function (err) {
    /* "admin gate: …" errors are expected — the shell already rendered the
       gate/denied card. Anything else is a real bug in this page. */
    if (err && String(err.message || err).indexOf("admin gate") === 0) return;
    if (window.BuyOUi) window.BuyOUi.toast("Something went wrong on this page.", { type: "error" });
    if (console && console.error) console.error("[admin/dashboard]", err);
  });

  function statsSkeleton() {
    var html = "";
    for (var i = 0; i < 5; i++) {
      html +=
        '<div class="adm-stat" aria-hidden="true">' +
        '<div class="ui-skeleton" style="height: 12px; width: 55%;"></div>' +
        '<div class="ui-skeleton" style="height: 28px; width: 70%; margin-top: 10px;"></div>' +
        "</div>";
    }
    return html;
  }

  function recentSkeleton() {
    var html = '<div class="adm-card__body" aria-hidden="true">';
    for (var i = 0; i < 4; i++) {
      html += '<div class="ui-skeleton" style="height: 16px; width: ' + (90 - i * 8) + '%; margin-bottom: 12px;"></div>';
    }
    return html + "</div>";
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    } catch (e) {
      return "";
    }
  }

  // GET /api/products to completion (server pagination is DISTINCT-correct;
  // we still page through because out-of-stock is computed from every row).
  async function fetchAllProducts() {
    var all = [];
    var seen = {};
    var truncated = false;
    var total = 0;
    for (var page = 1; page <= 50; page++) {
      var res = await BuyOApi.get("/products?limit=100&page=" + page + "&sort=newest");
      if (!res.ok) {
        var err = new Error(res.message || "Could not load products.");
        err.status = res.status;
        throw err;
      }
      var rows = (res.data && res.data.products) || [];
      var pagination = (res.data && res.data.pagination) || {};
      if (typeof pagination.total === "number") total = pagination.total;
      for (var i = 0; i < rows.length; i++) {
        if (seen[rows[i].id]) continue;
        seen[rows[i].id] = true;
        all.push(rows[i]);
      }
      if (rows.length === 0 || !pagination.hasNext) break;
      if (page === 50) truncated = true;
    }
    return { products: all, total: total, truncated: truncated };
  }

  function statCard(label, value, note) {
    return (
      '<div class="adm-stat">' +
        '<p class="adm-stat__label">' + C.esc(label) + "</p>" +
        '<p class="adm-stat__value">' + value + "</p>" +
        (note ? '<p class="adm-stat__note">' + C.esc(note) + "</p>" : "") +
      "</div>"
    );
  }

  function renderStats(data) {
    var products = data.products;
    var orders = data.orders;

    var orderCount = orders.orders.length + (orders.truncated ? "+" : "");
    var value = orders.orders.reduce(function (sum, o) {
      return o.status === "cancelled" ? sum : sum + Number(o.grandTotal || 0);
    }, 0);
    var outOfStock = products.products.filter(function (p) {
      return Number(p.stock) === 0;
    }).length;

    var html = "";
    html += statCard("Orders", C.esc(String(orderCount)), orders.truncated ? "First 5,000 fetched" : "All statuses");
    html += statCard(
      "Order value",
      C.esc(C.formatPrice(value)),
      "Non-cancelled gross; COD collected on delivery"
    );
    html += statCard("Products", C.esc(String(products.total)), "Live catalog total");
    html += statCard(
      "Out of stock",
      C.esc(String(outOfStock + (products.truncated ? "+" : ""))),
      "Stock = 0 right now"
    );
    html += statCard("Categories", C.esc(String(data.categoriesCount)), "Assigned to catalog");

    document.querySelector("[data-stats]").innerHTML = html;
  }

  function renderRecent(orders) {
    var host = document.querySelector("[data-recent]");
    if (!host) return;
    var rows = orders.orders.slice(0, 5);

    if (!rows.length) {
      host.innerHTML = C.emptyState({
        title: "No orders yet",
        text: "When customers place orders they will appear here and on the Orders page.",
        action: '<a class="ui-btn ui-btn--primary" href="products.html">Manage products</a>'
      });
      return;
    }

    var html =
      '<div class="adm-table-wrap"><table class="adm-table">' +
      "<thead><tr>" +
      "<th>Order</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th><th><span class=\"visually-hidden\">Actions</span></th>" +
      "</tr></thead><tbody>";

    rows.forEach(function (order) {
      var user = order.user || {};
      html +=
        "<tr>" +
        '<td class="adm-num"><strong>' + C.esc(order.orderNumber) + "</strong></td>" +
        "<td>" + C.esc(user.name || "—") +
          '<span class="adm-cell-sub">' + C.esc(user.email || "") + "</span></td>" +
        '<td class="adm-num">' + C.esc(fmtDate(order.createdAt)) + "</td>" +
        '<td class="adm-num">' + C.esc(C.formatPrice(order.grandTotal)) + "</td>" +
        "<td>" + BuyOShell.statusBadge(order.status) + "</td>" +
        '<td><div class="adm-actions"><a class="adm-link" href="order-detail.html?id=' +
          encodeURIComponent(order.id) + '">Details</a></div></td>' +
        "</tr>";
    });

    html += "</tbody></table></div>";
    host.innerHTML = html;
  }

  function renderError(err) {
    var stats = document.querySelector("[data-stats]");
    if (stats) {
      stats.innerHTML =
        '<div class="adm-stat" style="grid-column: 1 / -1;">' +
        '<p class="adm-stat__label">Couldn’t load statistics</p>' +
        '<p class="adm-stat__note">' + C.esc((err && err.message) || "Unexpected error.") + "</p>" +
        '<div class="adm-actions-row"><button type="button" class="ui-btn ui-btn--primary ui-btn--sm" data-retry>Try again</button></div>' +
        "</div>";
      var retry = stats.querySelector("[data-retry]");
      if (retry) retry.addEventListener("click", function () {
        stats.innerHTML = statsSkeleton();
        load();
      });
    }
    var recent = document.querySelector("[data-recent]");
    if (recent && !(err && err.status === 403)) {
      recent.innerHTML = C.emptyState({
        icon: BuyOShell.icon("alert", 26),
        title: "Recent orders unavailable",
        text: (err && err.message) || "Something went wrong while loading orders."
      });
    }
  }

  async function load() {
    try {
      var results = await Promise.all([
        fetchAllProducts(),
        BuyOApi.get("/categories"),
        BuyOShell.fetchAllOrders(null)
      ]);
      var categories = results[1];
      if (!categories.ok) {
        throw new Error(categories.message || "Could not load categories.");
      }
      var categoriesCount =
        typeof categories.data.count === "number"
          ? categories.data.count
          : ((categories.data.categories || []).length);

      renderStats({
        products: results[0],
        categoriesCount: categoriesCount,
        orders: results[2]
      });
      renderRecent(results[2]);
    } catch (err) {
      if (err && (err.status === 401 || err.status === 403)) return; // shell handles auth
      renderError(err);
    }
  }

  function start() {
    document.querySelector("[data-stats]").innerHTML = statsSkeleton();
    document.querySelector("[data-recent]").innerHTML = recentSkeleton();
    load();
  }
})();
